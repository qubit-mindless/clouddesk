"""Panel administratora: /api/users – lista, nowe konto, zmiana roli i blokada, reset hasła."""

import logging

import pytest
from sqlalchemy import select

from app.core.security import hash_password
from app.models import User, UserRole
from app.schemas.user import UserUpdate
from app.services.errors import ConflictError
from app.services.user_service import LAST_ADMIN, UserService
from tests.conftest import PASSWORD, email

USER_FIELDS = {"id", "email", "login", "fullName", "role", "isActive", "createdAt"}
SELF_LOCKOUT = {"detail": "Nie możesz odebrać sobie roli administratora ani zablokować własnego konta."}
NEW_USER = {"email": "nowa.osoba@firma.pl", "fullName": "Nowa Osoba", "role": "TECHNICIAN"}


def user_id(db, login: str) -> int:
    with db() as session:
        return session.scalars(select(User.id).where(User.email == email(login))).one()


def add_user(db, login: str, role: UserRole, *, active: bool = True, name: str | None = None) -> int:
    with db() as session:
        user = User(
            email=email(login),
            full_name=name or login,
            role=role,
            is_active=active,
            password_hash=hash_password(PASSWORD),
        )
        session.add(user)
        session.commit()
        return user.id


def login_status(anonymous, address: str, password: str) -> int:
    return anonymous.post("/api/auth/login", json={"email": address, "password": password}).status_code


def assert_no_password_hash(res) -> None:
    assert "passwordhash" not in res.text.lower() and "password_hash" not in res.text.lower()
    assert "$argon2" not in res.text


# --- uprawnienia ---------------------------------------------------------------------------------

ENDPOINTS = [
    ("get", "/api/users", None),
    ("post", "/api/users", NEW_USER),
    ("patch", "/api/users/1", {"fullName": "Ktoś Inny"}),
    ("post", "/api/users/1/reset-password", {}),
]


@pytest.mark.parametrize(("method", "path", "body"), ENDPOINTS)
@pytest.mark.parametrize("login", ["tech.jan", "anna.k"])
def test_only_admin_manages_accounts(login_as, method, path, body, login):
    client = login_as(login)
    res = client.request(method, path, json=body)
    assert res.status_code == 403
    assert res.json() == {"detail": "Zarządzanie kontami jest dostępne tylko dla administratora."}


@pytest.mark.parametrize("login", ["tech.jan", "anna.k"])
def test_role_checked_before_body_validation(login_as, login):
    # Technik ani zgłaszający nie dowiedzą się nawet, jakie pola są poprawne.
    assert login_as(login).patch("/api/users/1", json={}).status_code == 403
    assert login_as(login).post("/api/users", json={"x": 1}).status_code == 403


@pytest.mark.parametrize(("method", "path", "body"), ENDPOINTS)
def test_accounts_require_login(anonymous, method, path, body):
    res = anonymous.request(method, path, json=body)
    assert res.status_code == 401 and res.headers["WWW-Authenticate"] == "Bearer"


# --- lista ---------------------------------------------------------------------------------------


def test_list_sorted_by_full_name(client):
    res = client.get("/api/users")
    assert res.status_code == 200
    body = res.json()
    assert (body["total"], body["page"], body["size"]) == (5, 1, 50)
    assert [u["fullName"] for u in body["items"]] == [
        "Administrator",
        "Anna Kaczmarek",
        "Jan Kowalski",
        "Konto bez hasła",
        "Piotr Mazur",
    ]
    anna = body["items"][1]
    assert set(anna) == USER_FIELDS
    assert anna["email"] == "anna.k@clouddesk.example" and anna["login"] == "anna.k"
    assert anna["role"] == "REPORTER" and anna["isActive"] is True and anna["createdAt"]
    assert_no_password_hash(res)


def test_list_same_name_sorted_by_id(client, db):
    first = add_user(db, "jan.k2", UserRole.REPORTER, name="Jan Kowalski")
    items = client.get("/api/users", params={"q": "Jan Kowalski"}).json()["items"]
    assert [u["id"] for u in items] == sorted(u["id"] for u in items) and first in [u["id"] for u in items]


@pytest.mark.parametrize(
    ("params", "logins"),
    [
        ({"q": "KOWAL"}, ["tech.jan"]),
        ({"q": "anna.k@"}, ["anna.k"]),
        ({"q": "  mazur  "}, ["piotr.m"]),
        ({"q": "clouddesk", "role": "TECHNICIAN"}, ["tech.jan"]),
        ({"role": "REPORTER"}, ["anna.k", "bez.hasla", "piotr.m"]),
        ({"role": "ADMIN"}, ["admin"]),
        # %, _ i \ dosłownie – nie pasują do wszystkiego.
        ({"q": "%"}, []),
        ({"q": "_"}, []),
        ({"q": "\\"}, []),
        ({"q": ""}, ["admin", "anna.k", "tech.jan", "bez.hasla", "piotr.m"]),
    ],
)
def test_list_filters(client, params, logins):
    res = client.get("/api/users", params=params)
    assert res.status_code == 200
    assert [u["login"] for u in res.json()["items"]] == logins
    assert res.json()["total"] == len(logins)


def test_list_query_matches_percent_literally(client, db):
    add_user(db, "procent", UserRole.REPORTER, name="Rabat 100% Kowalska")
    items = client.get("/api/users", params={"q": "100%"}).json()["items"]
    assert [u["login"] for u in items] == ["procent"]


def test_list_pagination(client):
    res = client.get("/api/users", params={"page": 2, "size": 2}).json()
    assert (res["total"], res["page"], res["size"]) == (5, 2, 2)
    assert [u["login"] for u in res["items"]] == ["tech.jan", "bez.hasla"]
    assert client.get("/api/users", params={"page": 4, "size": 2}).json()["items"] == []


@pytest.mark.parametrize(
    "params",
    [{"page": 0}, {"size": 0}, {"size": 101}, {"role": "SUPERADMIN"}, {"q": "x" * 201}, {"q": "a\x00"}],
)
def test_list_validation(client, params):
    assert client.get("/api/users", params=params).status_code == 422


# --- nowe konto ----------------------------------------------------------------------------------


def test_create_user_with_temporary_password(client, anonymous, db, caplog):
    caplog.set_level(logging.INFO, logger="uvicorn.error")
    payload = {"email": "  Nowa.Osoba@Firma.PL ", "fullName": "  Nowa Osoba  ", "role": "TECHNICIAN"}
    res = client.post("/api/users", json=payload)
    assert res.status_code == 201
    body = res.json()
    assert set(body) == {"user", "temporaryPassword"}
    user = body["user"]
    assert set(user) == USER_FIELDS
    assert user["email"] == "nowa.osoba@firma.pl" and user["login"] == "nowa.osoba"
    assert user["fullName"] == "Nowa Osoba" and user["role"] == "TECHNICIAN" and user["isActive"] is True
    password = body["temporaryPassword"]
    assert len(password) == 16
    assert_no_password_hash(res)

    # W bazie tylko skrót.
    with db() as session:
        stored = session.get(User, user["id"])
        assert stored.password_hash.startswith("$argon2") and password not in stored.password_hash

    login = anonymous.post("/api/auth/login", json={"email": "nowa.osoba@firma.pl", "password": password})
    assert login.status_code == 200 and login.json()["user"]["role"] == "TECHNICIAN"

    assert "Konta: admin – nowe konto nowa.osoba (rola TECHNICIAN)" in caplog.messages
    assert password not in caplog.text


def test_create_user_passwords_differ(client):
    first = client.post("/api/users", json=NEW_USER).json()
    second = client.post("/api/users", json={**NEW_USER, "email": "druga@firma.pl"}).json()
    assert first["temporaryPassword"] != second["temporaryPassword"]


@pytest.mark.parametrize("address", ["anna.k@clouddesk.example", "ANNA.K@CloudDesk.Example"])
def test_create_duplicate_email_409(client, address):
    res = client.post("/api/users", json={**NEW_USER, "email": address})
    assert res.status_code == 409
    assert res.json() == {"detail": "Konto z tym adresem już istnieje."}


def test_create_duplicate_login_409(client):
    # Login (część przed „@”) identyfikuje konto w API, np. przy przypisaniu technika.
    res = client.post("/api/users", json={**NEW_USER, "email": "Tech.Jan@inna-firma.pl"})
    assert res.status_code == 409
    assert "tech.jan" in res.json()["detail"]


@pytest.mark.parametrize(
    "payload",
    [
        {**NEW_USER, "email": "bez-malpy"},
        {**NEW_USER, "email": "a@b"},
        {**NEW_USER, "email": "ja n@firma.pl"},
        {**NEW_USER, "email": "a@@firma.pl"},
        {**NEW_USER, "email": "x" * 250 + "@firma.pl"},
        {**NEW_USER, "fullName": " X "},
        {**NEW_USER, "fullName": "x" * 201},
        {**NEW_USER, "fullName": "Zero\x00"},
        {**NEW_USER, "role": "SUPERADMIN"},
        {"email": NEW_USER["email"], "fullName": NEW_USER["fullName"]},
        {**NEW_USER, "password": "moje-haslo-123"},
        {},
    ],
    ids=[
        "email-bez-malpy",
        "email-bez-kropki",
        "email-spacja",
        "email-dwie-malpy",
        "email-za-dlugi",
        "nazwisko-za-krotkie",
        "nazwisko-za-dlugie",
        "nazwisko-nul",
        "zla-rola",
        "bez-roli",
        "haslo-od-klienta",
        "puste",
    ],
)
def test_create_validation(client, payload):
    res = client.post("/api/users", json=payload)
    assert res.status_code == 422
    assert client.get("/api/users").json()["total"] == 5


# --- zmiana konta --------------------------------------------------------------------------------


def test_patch_role_name_and_block(client, anonymous, db, caplog):
    caplog.set_level(logging.INFO, logger="uvicorn.error")
    piotr = user_id(db, "piotr.m")
    res = client.patch(f"/api/users/{piotr}", json={"role": "TECHNICIAN", "fullName": " Piotr Mazurek "})
    assert res.status_code == 200
    body = res.json()
    assert set(body) == USER_FIELDS
    assert (body["role"], body["fullName"], body["isActive"]) == ("TECHNICIAN", "Piotr Mazurek", True)
    assert_no_password_hash(res)

    res = client.patch(f"/api/users/{piotr}", json={"isActive": False})
    assert res.status_code == 200 and res.json()["isActive"] is False
    assert login_status(anonymous, email("piotr.m"), PASSWORD) == 403

    res = client.patch(f"/api/users/{piotr}", json={"isActive": True})
    assert res.status_code == 200 and res.json()["isActive"] is True
    assert login_status(anonymous, email("piotr.m"), PASSWORD) == 200

    assert caplog.messages[-3:] == [
        "Konta: admin – konto piotr.m: zmiana imienia i nazwiska, rola REPORTER → TECHNICIAN",
        "Konta: admin – konto piotr.m: blokada",
        "Konta: admin – konto piotr.m: odblokowanie",
    ]
    # Imię i nazwisko nie trafia do logu.
    assert "Mazurek" not in caplog.text


def test_blocked_user_token_stops_and_unblock_restores(client, login_as, db):
    anna_client = login_as("anna.k")
    anna = user_id(db, "anna.k")
    client.patch(f"/api/users/{anna}", json={"isActive": False})
    assert anna_client.get("/api/auth/me").status_code == 401
    client.patch(f"/api/users/{anna}", json={"isActive": True})
    assert login_as("anna.k").get("/api/auth/me").status_code == 200


def test_role_change_applies_to_existing_token(client, login_as, db):
    tech = login_as("tech.jan")
    assert tech.get("/api/stats").status_code == 200
    client.patch(f"/api/users/{user_id(db, 'tech.jan')}", json={"role": "REPORTER"})
    assert tech.get("/api/stats").status_code == 403


@pytest.mark.parametrize("payload", [{"role": "REPORTER"}, {"role": "TECHNICIAN"}, {"isActive": False}])
def test_admin_cannot_lock_out_self(client, db, payload):
    res = client.patch(f"/api/users/{user_id(db, 'admin')}", json={**payload, "fullName": "Nowe Nazwisko"})
    assert res.status_code == 409
    assert res.json() == SELF_LOCKOUT
    me = client.get("/api/auth/me").json()
    assert me["role"] == "ADMIN" and me["fullName"] == "Administrator"


def test_admin_can_change_own_name(client, db):
    admin = user_id(db, "admin")
    res = client.patch(f"/api/users/{admin}", json={"fullName": "Główny Administrator", "role": "ADMIN"})
    assert res.status_code == 200
    assert res.json()["fullName"] == "Główny Administrator" and res.json()["role"] == "ADMIN"
    assert client.patch(f"/api/users/{admin}", json={"isActive": True}).status_code == 200


def test_other_admin_can_be_demoted_and_blocked(client, db):
    second = add_user(db, "admin2", UserRole.ADMIN)
    assert client.patch(f"/api/users/{second}", json={"role": "TECHNICIAN"}).json()["role"] == "TECHNICIAN"
    assert client.patch(f"/api/users/{second}", json={"role": "ADMIN"}).status_code == 200
    assert client.patch(f"/api/users/{second}", json={"isActive": False}).json()["isActive"] is False
    # Zablokowany administrator nie liczy się jako aktywny – można mu też odebrać rolę.
    assert client.patch(f"/api/users/{second}", json={"role": "REPORTER"}).status_code == 200


def test_last_active_admin_cannot_be_demoted_or_blocked(db):
    """Przez API nie da się tego wywołać (aktywny admin działa na innym koncie, więc są co najmniej dwa),
    dlatego test woła serwis z kontem zablokowanego administratora – jak przy wyścigu dwóch żądań."""
    blocked_admin = add_user(db, "admin2", UserRole.ADMIN, active=False)
    only_admin = user_id(db, "admin")
    with db() as session:
        service = UserService(session, actor=session.get(User, blocked_admin))
        for payload in ({"role": "TECHNICIAN"}, {"isActive": False}):
            with pytest.raises(ConflictError) as exc:
                service.update(only_admin, UserUpdate.model_validate(payload))
            assert str(exc.value) == LAST_ADMIN
        # Zmiana nazwiska ostatniego administratora – bez przeszkód.
        assert service.update(only_admin, UserUpdate(full_name="Jedyny Admin")).full_name == "Jedyny Admin"
    with db() as session:
        admin = session.get(User, only_admin)
        assert admin.role == UserRole.ADMIN and admin.is_active


def test_demoted_admin_loses_panel_at_once(client, db, login_as):
    """Dwóch administratorów: pierwszy odbiera rolę drugiemu, a token drugiego od razu traci uprawnienia."""
    second = add_user(db, "admin2", UserRole.ADMIN)
    other = login_as("admin2")
    assert client.patch(f"/api/users/{second}", json={"role": "TECHNICIAN"}).status_code == 200
    assert other.patch(f"/api/users/{user_id(db, 'admin')}", json={"role": "REPORTER"}).status_code == 403


def test_patch_not_found(client):
    assert client.patch("/api/users/9999", json={"fullName": "Nikt Taki"}).status_code == 404
    assert client.patch("/api/users/9999", json={"fullName": "Nikt Taki"}).json() == {
        "detail": "Konto nie istnieje."
    }


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"email": "inny@firma.pl"},
        {"fullName": "Anna K", "passwordHash": "x"},
        {"role": None},
        {"isActive": None},
        {"fullName": None},
        {"fullName": "A"},
        {"role": "ROOT"},
        {"isActive": "może"},
    ],
    ids=[
        "puste",
        "email",
        "hash",
        "rola-null",
        "aktywne-null",
        "nazwisko-null",
        "nazwisko-krotkie",
        "zla-rola",
        "zle-aktywne",
    ],
)
def test_patch_validation(client, db, payload):
    anna = user_id(db, "anna.k")
    assert client.patch(f"/api/users/{anna}", json=payload).status_code == 422
    after = next(u for u in client.get("/api/users").json()["items"] if u["id"] == anna)
    assert (after["fullName"], after["role"], after["isActive"]) == ("Anna Kaczmarek", "REPORTER", True)


# --- reset hasła ---------------------------------------------------------------------------------


@pytest.mark.parametrize("body", [{}, None], ids=["pusty-json", "bez-ciala"])
def test_reset_password(client, anonymous, db, caplog, body):
    caplog.set_level(logging.INFO, logger="uvicorn.error")
    anna = user_id(db, "anna.k")
    res = client.post(f"/api/users/{anna}/reset-password", json=body)
    assert res.status_code == 200
    assert set(res.json()) == {"temporaryPassword"}
    password = res.json()["temporaryPassword"]
    assert len(password) == 16
    assert_no_password_hash(res)
    assert login_status(anonymous, email("anna.k"), PASSWORD) == 401
    assert login_status(anonymous, email("anna.k"), password) == 200
    assert "Konta: admin – reset hasła konta anna.k" in caplog.messages
    assert password not in caplog.text


def test_reset_password_keeps_block(client, anonymous, db):
    piotr = user_id(db, "piotr.m")
    client.patch(f"/api/users/{piotr}", json={"isActive": False})
    password = client.post(f"/api/users/{piotr}/reset-password").json()["temporaryPassword"]
    assert login_status(anonymous, email("piotr.m"), password) == 403


def test_reset_password_not_found_and_validation(client, db):
    assert client.post("/api/users/9999/reset-password", json={}).status_code == 404
    anna = user_id(db, "anna.k")
    assert client.post(f"/api/users/{anna}/reset-password", json={"password": "x"}).status_code == 422


def test_blocked_technician_cannot_be_assigned(login_as, db):
    """Zablokowanego technika nie da się przypisać do zgłoszenia – 422 przy polu assignee."""
    tid = (
        login_as("anna.k")
        .post("/api/tickets", json={"title": "Nie działa drukarka", "description": "Opis", "priority": "P3"})
        .json()["id"]
    )
    add_user(db, "tech.blocked", UserRole.TECHNICIAN, active=False)
    res = login_as("tech.jan").patch(f"/api/tickets/{tid}", json={"assignee": "tech.blocked"})
    assert res.status_code == 422
    assert res.json()["detail"][0]["loc"][-1] == "assignee"


def test_resending_current_blocked_assignee_is_allowed(login_as, db, client):
    """Pełny PATCH z obecnym (w międzyczasie zablokowanym) technikiem nie blokuje zmiany statusu."""
    tid = (
        login_as("anna.k")
        .post("/api/tickets", json={"title": "Nie działa drukarka", "description": "Opis", "priority": "P3"})
        .json()["id"]
    )
    tech = login_as("tech.jan")
    assert (
        tech.patch(f"/api/tickets/{tid}", json={"assignee": "tech.jan", "status": "ASSIGNED"}).status_code
        == 200
    )
    assert client.patch(f"/api/users/{user_id(db, 'tech.jan')}", json={"isActive": False}).status_code == 200
    res = client.patch(f"/api/tickets/{tid}", json={"assignee": "tech.jan", "status": "IN_PROGRESS"})
    assert res.status_code == 200, res.text
    assert res.json()["status"] == "IN_PROGRESS"

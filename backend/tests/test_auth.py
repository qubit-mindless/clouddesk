"""Logowanie (JWT), ochrona /api/tickets i uprawnienia ról REPORTER / TECHNICIAN / ADMIN."""

import secrets
from datetime import UTC, datetime, timedelta

import jwt
import pytest
from sqlalchemy import delete, update

from app.core import security
from app.models import User
from tests.conftest import PASSWORD, email

TICKET = {"title": "Nie działa VPN", "description": "Błąd po aktualizacji.", "priority": "P3"}


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


# --- logowanie ---------------------------------------------------------------------------------


def test_login_returns_token_and_user(anonymous):
    res = anonymous.post("/api/auth/login", json={"email": email("tech.jan"), "password": PASSWORD})
    assert res.status_code == 200
    body = res.json()
    assert body["tokenType"] == "bearer" and body["expiresIn"] == 3600
    assert body["user"] == {
        "id": body["user"]["id"],
        "email": "tech.jan@clouddesk.example",
        "login": "tech.jan",
        "fullName": "Jan Kowalski",
        "role": "TECHNICIAN",
    }
    me = anonymous.get("/api/auth/me", headers=bearer(body["accessToken"]))
    assert me.status_code == 200 and me.json()["login"] == "tech.jan"


def test_login_email_is_case_and_space_insensitive(anonymous):
    payload = {"email": "  Anna.K@CloudDesk.Example ", "password": PASSWORD}
    res = anonymous.post("/api/auth/login", json=payload)
    assert res.status_code == 200


@pytest.mark.parametrize(
    ("login", "password"),
    [("anna.k", "zle-haslo"), ("nie.ma", PASSWORD), ("bez.hasla", "!"), ("bez.hasla", PASSWORD)],
)
def test_login_failures_look_the_same(anonymous, login, password):
    res = anonymous.post("/api/auth/login", json={"email": email(login), "password": password})
    assert res.status_code == 401
    assert res.json() == {"detail": "Nieprawidłowy e-mail lub hasło."}
    assert res.headers["WWW-Authenticate"] == "Bearer"


@pytest.mark.parametrize(
    "payload",
    [{}, {"email": "a@b.c"}, {"email": "a@b.c", "password": ""}, {"email": "a@b.c", "password": "x" * 129}],
)
def test_login_validation_returns_422(anonymous, payload):
    assert anonymous.post("/api/auth/login", json=payload).status_code == 422


# --- token -----------------------------------------------------------------------------------


def _token(**overrides) -> str:
    now = datetime.now(UTC)
    claims = {"sub": "1", "role": "ADMIN", "iss": "clouddesk", "iat": now, "exp": now + timedelta(minutes=5)}
    claims.update(overrides)
    key = claims.pop("key", security._signing_key())
    algorithm = claims.pop("alg", "HS256")
    return jwt.encode({k: v for k, v in claims.items() if v is not None}, key, algorithm=algorithm)


def test_valid_handmade_token_is_accepted(anonymous):
    # Kontrola dla testów poniżej: ten sam token bez zmian przechodzi, więc 401 niżej wynika ze zmiany.
    assert anonymous.get("/api/tickets", headers=bearer(_token())).status_code == 200


@pytest.mark.parametrize(
    "headers",
    [
        {},
        {"Authorization": "Bearer"},
        {"Authorization": "Bearer nie-jest-tokenem"},
        {"Authorization": "Basic YWRtaW46eA=="},
        bearer(_token(exp=datetime.now(UTC) - timedelta(seconds=1))),
        bearer(_token(key="inny-klucz-" + "x" * 40)),
        bearer(_token(iss="ktos-inny")),
        bearer(_token(sub=None)),
        bearer(_token(sub="abc")),
        bearer(_token(sub="9999")),
        bearer(jwt.encode({"sub": "1", "iss": "clouddesk"}, key=None, algorithm="none")),
    ],
    ids=[
        "brak",
        "pusty-bearer",
        "smieci",
        "basic",
        "wygasly",
        "obcy-klucz",
        "obcy-wystawca",
        "bez-sub",
        "sub-nie-liczba",
        "nieistniejacy-uzytkownik",
        "alg-none",
    ],
)
def test_tickets_require_valid_token(anonymous, headers):
    res = anonymous.get("/api/tickets", headers=headers)
    assert res.status_code == 401
    assert res.headers["WWW-Authenticate"] == "Bearer"


def test_deleted_user_token_stops_working(login_as, db):
    client = login_as("piotr.m")
    assert client.get("/api/auth/me").status_code == 200
    with db() as session:
        session.execute(delete(User).where(User.email == email("piotr.m")))
        session.commit()
    assert client.get("/api/auth/me").status_code == 401


def test_health_stays_public(anonymous, monkeypatch):
    from app.db import session

    monkeypatch.setattr(session, "ping_db", lambda: None)
    assert anonymous.get("/api/health").status_code == 200


def test_missing_secret_outside_local_stops_start(monkeypatch):
    monkeypatch.setenv("APP_ENV", "azure")
    monkeypatch.delenv("JWT_SECRET", raising=False)
    security.get_settings.cache_clear()
    security._signing_key.cache_clear()
    try:
        with pytest.raises(RuntimeError, match="JWT_SECRET"):
            security.check_configuration()
        monkeypatch.setenv("JWT_SECRET", "za-krotki")
        security.get_settings.cache_clear()
        security._signing_key.cache_clear()
        with pytest.raises(RuntimeError, match="32"):
            security.check_configuration()
    finally:
        monkeypatch.undo()
        security.get_settings.cache_clear()
        security._signing_key.cache_clear()


# --- role ------------------------------------------------------------------------------------


def test_reporter_is_author_and_sees_only_own_tickets(login_as):
    anna, piotr, tech = login_as("anna.k"), login_as("piotr.m"), login_as("tech.jan")
    own = anna.post("/api/tickets", json=TICKET)
    assert own.status_code == 201 and own.json()["reporter"] == "anna.k"
    other = piotr.post("/api/tickets", json=TICKET).json()

    assert [t["id"] for t in anna.get("/api/tickets").json()["items"]] == [own.json()["id"]]
    # Cudze zgłoszenie wygląda dla zgłaszającego jak nieistniejące.
    assert anna.get(f"/api/tickets/{other['id']}").status_code == 404
    assert anna.patch(f"/api/tickets/{other['id']}", json={"title": "Przejęte zgłoszenie"}).status_code == 404
    # Technik widzi wszystkie.
    assert tech.get("/api/tickets").json()["total"] == 2


def test_reporter_edits_content_but_not_workflow(login_as):
    anna = login_as("anna.k")
    tid = anna.post("/api/tickets", json=TICKET).json()["id"]

    res = anna.patch(f"/api/tickets/{tid}", json={"title": "VPN nadal nie działa", "priority": "P2"})
    assert res.status_code == 200 and res.json()["priority"] == "P2"
    for payload in ({"status": "CLOSED"}, {"assignee": "tech.jan"}, {"title": "Inny tytuł", "status": "NEW"}):
        res = anna.patch(f"/api/tickets/{tid}", json=payload)
        assert res.status_code == 403, payload
    # Pole zakazane podane jako null – też 403 (rola sprawdzana przed walidacją pól).
    assert anna.patch(f"/api/tickets/{tid}", json={"status": None}).status_code == 403
    assert anna.delete(f"/api/tickets/{tid}").status_code == 403
    assert anna.get(f"/api/tickets/{tid}").status_code == 200


def test_reporter_cannot_change_resolved_ticket(login_as):
    anna, tech = login_as("anna.k"), login_as("tech.jan")
    tid = anna.post("/api/tickets", json={**TICKET, "priority": "P4"}).json()["id"]
    tech.patch(f"/api/tickets/{tid}", json={"assignee": "tech.jan", "status": "RESOLVED"})
    res = anna.patch(f"/api/tickets/{tid}", json={"priority": "P1"})
    assert res.status_code == 403
    assert anna.get(f"/api/tickets/{tid}").json()["priority"] == "P4"


def test_login_ignores_case_of_stored_email(anonymous, db):
    with db() as session:
        session.add(
            User(
                email="Jan.Nowak@CloudDesk.example",
                full_name="Jan Nowak",
                role="REPORTER",
                password_hash=security.hash_password(PASSWORD),
            )
        )
        session.commit()
    payload = {"email": "jan.nowak@clouddesk.example", "password": PASSWORD}
    assert anonymous.post("/api/auth/login", json=payload).status_code == 200


def test_technician_runs_workflow_and_history_has_real_author(login_as, db):
    from sqlalchemy import select

    from app.models import TicketHistory

    tid = login_as("anna.k").post("/api/tickets", json=TICKET).json()["id"]
    tech = login_as("tech.jan")
    res = tech.patch(f"/api/tickets/{tid}", json={"assignee": "tech.jan", "status": "ASSIGNED"})
    assert res.status_code == 200
    with db() as session:
        authors = {h.author.email for h in session.scalars(select(TicketHistory))}
    assert authors == {email("tech.jan")}
    assert tech.delete(f"/api/tickets/{tid}").status_code == 204


# --- blokada konta (panel administratora) ------------------------------------------------------

LOCKED = {"detail": "Konto jest zablokowane. Skontaktuj się z administratorem."}


def set_active(db, login: str, active: bool) -> None:
    with db() as session:
        session.execute(update(User).where(User.email == email(login)).values(is_active=active))
        session.commit()


def test_locked_account_login_403_only_with_correct_password(anonymous, db):
    set_active(db, "piotr.m", False)
    res = anonymous.post("/api/auth/login", json={"email": email("piotr.m"), "password": PASSWORD})
    assert res.status_code == 403
    assert res.json() == LOCKED
    # Złe hasło do zablokowanego konta – zwykłe 401, bez zdradzania blokady.
    res = anonymous.post("/api/auth/login", json={"email": email("piotr.m"), "password": "zle-haslo"})
    assert res.status_code == 401 and res.json() == {"detail": "Nieprawidłowy e-mail lub hasło."}

    set_active(db, "piotr.m", True)
    res = anonymous.post("/api/auth/login", json={"email": email("piotr.m"), "password": PASSWORD})
    assert res.status_code == 200


def test_locked_account_token_stops_working(login_as, db):
    client = login_as("piotr.m")
    assert client.get("/api/auth/me").status_code == 200
    set_active(db, "piotr.m", False)
    res = client.get("/api/auth/me")
    assert res.status_code == 401 and res.headers["WWW-Authenticate"] == "Bearer"
    assert client.get("/api/tickets").status_code == 401
    # Po odblokowaniu ten sam (nadal ważny) token znów działa.
    set_active(db, "piotr.m", True)
    assert client.get("/api/auth/me").status_code == 200


# --- zmiana własnego hasła -----------------------------------------------------------------------

NEW_PASSWORD = "nowe-haslo-" + secrets.token_urlsafe(8)


def _login(anonymous, login: str, password: str) -> int:
    return anonymous.post("/api/auth/login", json={"email": email(login), "password": password}).status_code


@pytest.mark.parametrize("login", ["anna.k", "tech.jan", "admin"])
def test_change_own_password(login_as, anonymous, login):
    client = login_as(login)
    res = client.post("/api/auth/password", json={"currentPassword": PASSWORD, "newPassword": NEW_PASSWORD})
    assert res.status_code == 204 and res.content == b""
    assert _login(anonymous, login, PASSWORD) == 401
    assert _login(anonymous, login, NEW_PASSWORD) == 200
    # Token sprzed zmiany działa do wygaśnięcia (znane ograniczenie JWT bez listy unieważnień).
    assert client.get("/api/auth/me").status_code == 200


def test_change_password_wrong_current(login_as, anonymous):
    res = login_as("anna.k").post(
        "/api/auth/password", json={"currentPassword": "nie-to-haslo", "newPassword": NEW_PASSWORD}
    )
    assert res.status_code == 422
    assert res.json() == {
        "detail": [
            {"loc": ["body", "currentPassword"], "msg": "Nieprawidłowe obecne hasło.", "type": "value_error"}
        ]
    }
    assert _login(anonymous, "anna.k", PASSWORD) == 200


@pytest.mark.parametrize(
    "new_password",
    ["x" * 11, "y" * 129, PASSWORD],
    ids=["za-krotkie", "za-dlugie", "takie-samo-jak-obecne"],
)
def test_change_password_rejects_new_password(login_as, anonymous, new_password):
    res = login_as("anna.k").post(
        "/api/auth/password", json={"currentPassword": PASSWORD, "newPassword": new_password}
    )
    assert res.status_code == 422
    assert [e["loc"] for e in res.json()["detail"]] == [["body", "newPassword"]]
    assert _login(anonymous, "anna.k", PASSWORD) == 200


def test_change_password_counts_characters_not_bytes(login_as, anonymous):
    # 12 znaków, ale 24 bajty w UTF-8 – mieści się w limicie.
    polish = "ąęółśżźćńĄĘÓ"
    res = login_as("anna.k").post(
        "/api/auth/password", json={"currentPassword": PASSWORD, "newPassword": polish}
    )
    assert res.status_code == 204
    assert _login(anonymous, "anna.k", polish) == 200


@pytest.mark.parametrize(
    "payload",
    [{}, {"currentPassword": PASSWORD}, {"currentPassword": PASSWORD, "newPassword": NEW_PASSWORD, "x": 1}],
    ids=["puste", "bez-nowego", "pole-spoza-kontraktu"],
)
def test_change_password_validation(login_as, payload):
    assert login_as("anna.k").post("/api/auth/password", json=payload).status_code == 422


def test_change_password_requires_login(anonymous):
    payload = {"currentPassword": PASSWORD, "newPassword": NEW_PASSWORD}
    assert anonymous.post("/api/auth/password", json=payload).status_code == 401

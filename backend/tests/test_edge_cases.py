"""Przypadki skrajne (#105): limity pól, znaki specjalne i Unicode, awaria bazy, nieobsłużone wyjątki.

Zasada: błąd klienta → 422 przy polu; baza niedostępna → JSON 503; cokolwiek innego → JSON 500.
W żadnej odpowiedzi nie ma śladu stosu ani szczegółów połączenia z bazą.
"""

import secrets

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.api.errors import DATABASE_UNAVAILABLE_MESSAGE, INTERNAL_ERROR_MESSAGE
from app.db.session import get_db
from app.main import app
from app.services.ticket_service import TicketService
from tests.conftest import PASSWORD, email

VALID = {"title": "Nie działa VPN", "description": "Błąd logowania po aktualizacji.", "priority": "P2"}


def create(client, **overrides):
    return client.post("/api/tickets", json={**VALID, **overrides})


def error_fields(res) -> set[str]:
    return {item["loc"][-1] for item in res.json()["detail"]}


def assert_no_internals(res, *secrets: str) -> None:
    text = res.text
    assert "Traceback" not in text and 'File "' not in text
    for secret in secrets:
        assert secret not in text


# --- Limity długości: liczone w znakach, tak jak VARCHAR(n) w PostgreSQL --------------------------------


@pytest.mark.parametrize(
    ("field", "limit"),
    [("title", 200), ("description", 5000)],
)
def test_text_limit_counts_characters_not_bytes(client, field, limit):
    # "ż" to 2 bajty w UTF-8 – limit dotyczy znaków, więc dokładnie `limit` znaków przechodzi.
    assert create(client, **{field: "ż" * limit}).status_code == 201

    res = create(client, **{field: "ż" * (limit + 1)})
    assert res.status_code == 422
    assert field in error_fields(res)


def test_patch_respects_the_same_limits(client):
    ticket = create(client).json()
    res = client.patch(f"/api/tickets/{ticket['id']}", json={"title": "x" * 201})
    assert res.status_code == 422
    assert "title" in error_fields(res)


@pytest.mark.parametrize(
    ("url", "field"),
    [
        ("/api/tickets?q=" + "a" * 201, "q"),
        ("/api/tickets?assignee=" + "a" * 101, "assignee"),
    ],
)
def test_query_parameter_limits(client, url, field):
    res = client.get(url)
    assert res.status_code == 422
    assert field in error_fields(res)


def test_login_field_limits(anonymous):
    too_long_email = "a" * 250 + "@x.example"
    assert (
        anonymous.post("/api/auth/login", json={"email": too_long_email, "password": "x"}).status_code == 422
    )
    assert (
        anonymous.post("/api/auth/login", json={"email": email("admin"), "password": "x" * 129}).status_code
        == 422
    )


# --- Znaki specjalne i Unicode ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "title",
    [
        "Drukarka 🖨️ nie drukuje – zażółć gęślą jaźń",
        "Сервер не отвечает (кириллица)",
        "打印机坏了 — 中文",
        "خطأ في الطابعة",
        "<script>alert(1)</script>",
        "'; DROP TABLE tickets; --",
        '100% \\ _ % [a-z] "cudzysłów"',
        "Linia 1\nLinia 2\tTab",
    ],
    # Czytelne nazwy w wyniku pytest -v (inaczej pytest pokazuje znaki spoza ASCII jako \uXXXX).
    ids=["polskie-i-emoji", "cyrylica", "chinski", "arabski", "html", "sql", "znaki-like", "nowe-linie"],
)
def test_special_and_unicode_text_round_trips(client, title):
    res = create(client, title=title, description=f"Opis: {title}")
    assert res.status_code == 201, res.text
    ticket = client.get(f"/api/tickets/{res.json()['id']}").json()
    assert ticket["title"] == title
    assert ticket["description"] == f"Opis: {title}"


@pytest.mark.parametrize("field", ["title", "description"])
def test_nul_character_returns_422_not_500(client, field):
    # PostgreSQL odrzuca U+0000 w tekście – bez walidacji kończyło się to błędem bazy i 500.
    res = create(client, **{field: "Nie działa\x00VPN"})
    assert res.status_code == 422
    assert field in error_fields(res)
    # Frontend pokazuje `msg` przy polu – bez technicznego prefiksu Pydantica „Value error, ”.
    msg = next(e["msg"] for e in res.json()["detail"] if e["loc"][-1] == field)
    assert msg == "Tekst nie może zawierać znaku NUL (\\u0000)."


def test_nul_character_in_patch_query_and_login(client, anonymous):
    ticket = create(client).json()
    assert client.patch(f"/api/tickets/{ticket['id']}", json={"description": "a\x00b"}).status_code == 422
    assert client.patch(f"/api/tickets/{ticket['id']}", json={"assignee": "tech\x00jan"}).status_code == 422
    assert client.get("/api/tickets", params={"q": "vpn\x00"}).status_code == 422
    login = {"email": "admin\x00@clouddesk.example", "password": PASSWORD}
    assert anonymous.post("/api/auth/login", json=login).status_code == 422


def test_lone_surrogate_returns_422(client):
    # "\ud800" to poprawny zapis w JSON-ie, ale nie da się go zakodować w UTF-8 ani zapisać w bazie.
    body = '{"title": "Nie działa \\ud800 VPN", "description": "Opis", "priority": "P2"}'
    res = client.post("/api/tickets", content=body.encode(), headers={"Content-Type": "application/json"})
    assert res.status_code == 422


# --- Baza niedostępna → JSON 503 -------------------------------------------------------------------------


@pytest.fixture
def database_down(db, tmp_path):
    """Podmienia sesję na bazę, z którą nie da się połączyć (katalog nie istnieje → OperationalError)."""
    missing = tmp_path / "nie-ma-takiego-katalogu" / "clouddesk.db"
    engine = create_engine(f"sqlite:///{missing}")
    broken = sessionmaker(bind=engine)

    def override():
        with broken() as session:
            yield session

    app.dependency_overrides[get_db] = override
    yield str(missing)
    engine.dispose()


def test_database_down_returns_json_503(client, database_down):
    for method, url, body in [
        ("GET", "/api/tickets", None),
        ("GET", "/api/tickets/1", None),
        ("POST", "/api/tickets", VALID),
        ("PATCH", "/api/tickets/1", {"priority": "P1"}),
        ("DELETE", "/api/tickets/1", None),
    ]:
        res = client.request(method, url, json=body)
        assert res.status_code == 503, f"{method} {url}: {res.status_code}"
        assert res.headers["content-type"].startswith("application/json")
        assert res.json() == {"detail": DATABASE_UNAVAILABLE_MESSAGE}
        assert res.headers["retry-after"] == "10"
        assert_no_internals(res, database_down, "sqlite", "OperationalError", "SELECT")


def test_login_with_database_down_returns_503(anonymous, database_down):
    res = anonymous.post("/api/auth/login", json={"email": email("admin"), "password": PASSWORD})
    assert res.status_code == 503
    assert res.json() == {"detail": DATABASE_UNAVAILABLE_MESSAGE}
    assert_no_internals(res, database_down, "sqlite")


def test_database_down_logs_details_for_operators_without_user_data(client, database_down, caplog):
    client.post("/api/tickets", json={**VALID, "title": "Tytuł z danymi zgłaszającego"})
    records = [r for r in caplog.records if "Baza niedostępna" in r.getMessage()]
    assert records, "brak wpisu w logu o awarii bazy"
    assert records[0].levelname == "ERROR"
    assert "/api/tickets" in records[0].getMessage()
    # Do logu trafia komunikat sterownika, ale nie SQL i wartości parametrów (dane użytkowników).
    assert all("Tytuł z danymi" not in r.getMessage() and "[SQL:" not in r.getMessage() for r in records)


# --- Nieobsłużony wyjątek → JSON 500 bez śladu stosu ------------------------------------------------------

# Udawany szczegół wewnętrzny – nie może wyciec do odpowiedzi.
INTERNAL_DETAIL = f"szczegół-wewnętrzny-{secrets.token_hex(4)}"


@pytest.fixture
def broken_list(monkeypatch):
    def boom(self, query):
        raise RuntimeError(INTERNAL_DETAIL)

    monkeypatch.setattr(TicketService, "list", boom)


def test_unexpected_error_returns_json_500_without_details(client, broken_list, caplog):
    res = client.get("/api/tickets")
    assert res.status_code == 500
    assert res.headers["content-type"].startswith("application/json")
    assert res.json() == {"detail": INTERNAL_ERROR_MESSAGE}
    assert_no_internals(res, INTERNAL_DETAIL, "RuntimeError")
    # Szczegóły zostają w logu dla zespołu – jeden wpis ze śladem stosu na żądanie.
    traced = [r for r in caplog.records if r.exc_info]
    assert len(traced) == 1 and INTERNAL_DETAIL in str(traced[0].exc_info[1])


def test_error_responses_keep_cors_headers(client, broken_list):
    # Frontend z innego originu musi móc odczytać komunikat błędu, a nie dostać błąd CORS.
    origin = "http://localhost:5173"
    res = client.get("/api/tickets", headers={"Origin": origin})
    assert res.status_code == 500
    assert res.headers.get("access-control-allow-origin") == origin

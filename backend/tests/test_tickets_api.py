"""API /api/tickets: CRUD, filtry, walidacja (422 w formacie FastAPI), 404, SLA i historia zmian."""

import os

os.environ.setdefault("DATABASE_URL", "sqlite://")

from datetime import datetime, timedelta  # noqa: E402

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine, event, func, select  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

from app.db.session import get_db  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Base, Ticket, TicketHistory, User, UserRole  # noqa: E402


@pytest.fixture
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    # SQLite domyślnie ignoruje klucze obce – bez tego testy nie wyłapałyby błędów CASCADE/RESTRICT.
    event.listen(engine, "connect", lambda dbapi_conn, _: dbapi_conn.execute("PRAGMA foreign_keys=ON"))
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False)
    with session_factory() as session:
        for login, name, role in [
            ("tech.jan", "Jan Kowalski", UserRole.TECHNICIAN),
            ("anna.k", "Anna Kaczmarek", UserRole.REPORTER),
        ]:
            session.add(
                User(email=f"{login}@clouddesk.example", full_name=name, role=role, password_hash="!")
            )
        session.commit()

    def override():
        with session_factory() as session:
            yield session

    app.dependency_overrides[get_db] = override
    yield session_factory
    app.dependency_overrides.clear()
    engine.dispose()


@pytest.fixture
def client(db):
    return TestClient(app)


def create(client, **overrides):
    body = {"title": "Nie działa VPN", "description": "Błąd logowania po aktualizacji.", "priority": "P2"}
    body.update(overrides)
    return client.post("/api/tickets", json=body)


def parse(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00")).replace(tzinfo=None)


def test_create_returns_201_with_camel_case_and_sla(client):
    res = create(client, priority="P1")
    assert res.status_code == 201
    body = res.json()
    assert body["status"] == "NEW"
    assert body["reporter"] == "demo"
    assert body["assignee"] is None
    assert {"createdAt", "slaDueAt", "updatedAt", "resolvedAt"} <= body.keys()
    assert parse(body["slaDueAt"]) - parse(body["createdAt"]) == timedelta(hours=4)


@pytest.mark.parametrize(
    ("payload", "field"),
    [
        ({"title": "abc"}, "title"),
        ({"title": "x" * 201}, "title"),
        ({"description": "   "}, "description"),
        ({"priority": "P9"}, "priority"),
        ({"status": "NEW"}, "status"),  # status nadaje backend, nie klient
    ],
)
def test_create_invalid_returns_422_per_field(client, payload, field):
    res = create(client, **payload)
    assert res.status_code == 422
    assert field in {item["loc"][-1] for item in res.json()["detail"]}


def test_get_and_404(client):
    created = create(client).json()
    assert client.get(f"/api/tickets/{created['id']}").json()["title"] == "Nie działa VPN"
    res = client.get("/api/tickets/9999")
    assert res.status_code == 404
    assert "9999" in res.json()["detail"]


def test_list_filters_search_and_pagination(client):
    create(client, title="Drukarka zacięta", priority="P4")
    create(client, title="Serwer plików nie odpowiada", priority="P1")
    create(client, title="Drukarka – brak tonera", priority="P3")

    page = client.get("/api/tickets").json()
    assert page["total"] == 3 and len(page["items"]) == 3 and page["page"] == 1

    assert [t["priority"] for t in client.get("/api/tickets?priority=P1").json()["items"]] == ["P1"]
    assert client.get("/api/tickets?q=drukarka").json()["total"] == 2
    assert client.get("/api/tickets?status=CLOSED").json()["total"] == 0

    first = client.get("/api/tickets?size=2&page=1").json()
    second = client.get("/api/tickets?size=2&page=2").json()
    assert len(first["items"]) == 2 and len(second["items"]) == 1
    assert first["total"] == second["total"] == 3

    assert client.get("/api/tickets?priority=P7").status_code == 422
    assert client.get("/api/tickets?size=0").status_code == 422


def test_patch_assign_status_and_history(client, db):
    ticket = create(client, priority="P3").json()
    tid = ticket["id"]

    res = client.patch(f"/api/tickets/{tid}", json={"assignee": "tech.jan", "status": "ASSIGNED"})
    assert res.status_code == 200
    assert res.json()["assignee"] == "tech.jan" and res.json()["status"] == "ASSIGNED"
    assert client.get("/api/tickets?assignee=tech.jan").json()["total"] == 1

    resolved = client.patch(f"/api/tickets/{tid}", json={"status": "RESOLVED"}).json()
    assert resolved["resolvedAt"] is not None
    reopened = client.patch(f"/api/tickets/{tid}", json={"status": "IN_PROGRESS"}).json()
    assert reopened["resolvedAt"] is None

    with db() as session:
        changes = session.scalars(select(TicketHistory).where(TicketHistory.ticket_id == tid)).all()
        assert [(h.field, h.old_value, h.new_value) for h in changes] == [
            ("assignee", None, "tech.jan"),
            ("status", "NEW", "ASSIGNED"),
            ("status", "ASSIGNED", "RESOLVED"),
            ("status", "RESOLVED", "IN_PROGRESS"),
        ]


def test_patch_priority_recalculates_sla(client):
    ticket = create(client, priority="P4").json()
    updated = client.patch(f"/api/tickets/{ticket['id']}", json={"priority": "P1"}).json()
    assert parse(updated["slaDueAt"]) - parse(updated["createdAt"]) == timedelta(hours=4)


@pytest.mark.parametrize(
    ("payload", "field"),
    [
        ({"assignee": "nikt"}, "assignee"),
        ({"assignee": "anna.k"}, "assignee"),  # zgłaszającego nie można zrobić technikiem
        ({"title": None}, "title"),
        ({"status": "DONE"}, "status"),
        ({"unknown": 1}, "unknown"),
    ],
)
def test_patch_invalid_returns_422(client, payload, field):
    tid = create(client).json()["id"]
    res = client.patch(f"/api/tickets/{tid}", json=payload)
    assert res.status_code == 422
    assert field in {item["loc"][-1] for item in res.json()["detail"]}


def test_patch_unassign_and_404(client):
    tid = create(client).json()["id"]
    client.patch(f"/api/tickets/{tid}", json={"assignee": "tech.jan"})
    assert client.patch(f"/api/tickets/{tid}", json={"assignee": None}).json()["assignee"] is None
    assert client.patch("/api/tickets/9999", json={"title": "Nowy tytuł"}).status_code == 404


def test_delete_returns_204_then_404(client):
    tid = create(client).json()["id"]
    res = client.delete(f"/api/tickets/{tid}")
    assert res.status_code == 204 and res.content == b""
    assert client.get(f"/api/tickets/{tid}").status_code == 404
    assert client.delete(f"/api/tickets/{tid}").status_code == 404


def test_delete_cascades_history(client, db):
    tid = create(client).json()["id"]
    client.patch(f"/api/tickets/{tid}", json={"assignee": "tech.jan", "status": "ASSIGNED"})
    assert client.delete(f"/api/tickets/{tid}").status_code == 204
    with db() as session:
        assert session.scalar(select(func.count()).select_from(TicketHistory)) == 0
        assert session.get(Ticket, tid) is None


def test_search_treats_like_wildcards_literally(client):
    create(client, title="Drukarka zacięta")
    create(client, title="Rabat 100% na licencje")
    assert client.get("/api/tickets?q=_").json()["total"] == 0
    assert client.get("/api/tickets", params={"q": "100%"}).json()["total"] == 1

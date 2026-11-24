"""POST /api/tickets/{id}/resolve – zgłaszający zamyka własne zgłoszenie po pomocy asystenta AI."""

from datetime import UTC, datetime

import pytest
from sqlalchemy import select

from app.core import clock
from app.models import AiMessage, AiMessageRole, TicketHistory
from tests.conftest import add_assistant_answer

FROZEN = datetime(2026, 11, 22, 10, 0, tzinfo=UTC)


def create(client, db=None, **overrides):
    """Nowe zgłoszenie; z `db` – od razu z odpowiedzią asystenta (warunek „Pomogło – zamknij”)."""
    body = {"title": "Nie działa VPN", "description": "Błąd logowania po aktualizacji.", "priority": "P2"}
    body.update(overrides)
    res = client.post("/api/tickets", json=body)
    assert res.status_code == 201, res.text
    if db is not None:
        add_assistant_answer(db, res.json()["id"])
    return res.json()


def parse(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00")).replace(tzinfo=UTC)


def test_reporter_resolves_own_ticket_with_history(login_as, db, monkeypatch):
    anna = login_as("anna.k")
    tid = create(anna, db)["id"]
    login_as("tech.jan").patch(f"/api/tickets/{tid}", json={"status": "IN_PROGRESS"})

    monkeypatch.setattr(clock, "utc_now", lambda: FROZEN)
    res = anna.post(f"/api/tickets/{tid}/resolve", json={})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["status"] == "RESOLVED"
    # Całe „teraz” z jednego zegara aplikacji: resolvedAt, updatedAt i czas wierszy historii.
    assert parse(body["resolvedAt"]) == parse(body["updatedAt"]) == FROZEN

    with db() as session:
        rows = session.scalars(
            select(TicketHistory).where(TicketHistory.ticket_id == tid).order_by(TicketHistory.id)
        ).all()
        assert [(h.field, h.old_value, h.new_value, h.author.email) for h in rows[-2:]] == [
            ("status", "IN_PROGRESS", "RESOLVED", "anna.k@clouddesk.example"),
            ("resolution", None, "SELF_AI", "anna.k@clouddesk.example"),
        ]
        assert {h.changed_at.replace(tzinfo=UTC) for h in rows[-2:]} == {FROZEN}


def test_without_assistant_answer_409(login_as, db):
    anna = login_as("anna.k")
    tid = create(anna)["id"]
    res = anna.post(f"/api/tickets/{tid}/resolve", json={})
    assert res.status_code == 409
    assert "najpierw zapytaj asystenta" in res.json()["detail"]
    # Samo pytanie zgłaszającego to jeszcze nie pomoc asystenta.
    with db() as session:
        session.add(AiMessage(ticket_id=tid, role=AiMessageRole.USER, content="Pytanie"))
        session.commit()
    assert anna.post(f"/api/tickets/{tid}/resolve", json={}).status_code == 409
    add_assistant_answer(db, tid)
    assert anna.post(f"/api/tickets/{tid}/resolve", json={}).status_code == 200


def test_patch_history_uses_app_clock(client, db, monkeypatch):
    tid = create(client)["id"]
    monkeypatch.setattr(clock, "utc_now", lambda: FROZEN)
    body = client.patch(f"/api/tickets/{tid}", json={"status": "RESOLVED"}).json()
    assert parse(body["resolvedAt"]) == parse(body["updatedAt"]) == FROZEN
    with db() as session:
        (row,) = session.scalars(select(TicketHistory).where(TicketHistory.ticket_id == tid)).all()
        assert row.changed_at.replace(tzinfo=UTC) == FROZEN


@pytest.mark.parametrize("staff", ["tech.jan", "admin"])
def test_staff_gets_403(login_as, db, staff):
    tid = create(login_as("anna.k"), db)["id"]
    res = login_as(staff).post(f"/api/tickets/{tid}/resolve", json={})
    assert res.status_code == 403


def test_staff_own_ticket_also_403(login_as, db):
    # Technik i administrator zamykają przez PATCH status – także zgłoszenia, które sami założyli.
    admin = login_as("admin")
    tid = create(admin, db)["id"]
    assert admin.post(f"/api/tickets/{tid}/resolve", json={}).status_code == 403


def test_foreign_ticket_404_for_reporter(login_as, db):
    tid = create(login_as("anna.k"), db)["id"]
    res = login_as("piotr.m").post(f"/api/tickets/{tid}/resolve", json={})
    assert res.status_code == 404
    assert login_as("piotr.m").post("/api/tickets/9999/resolve", json={}).status_code == 404
    assert login_as("tech.jan").post("/api/tickets/9999/resolve", json={}).status_code == 404


@pytest.mark.parametrize("closed", ["RESOLVED", "CLOSED"])
def test_already_closed_409(login_as, db, closed):
    anna = login_as("anna.k")
    tid = create(anna, db)["id"]
    login_as("tech.jan").patch(f"/api/tickets/{tid}", json={"status": closed})
    assert anna.post(f"/api/tickets/{tid}/resolve", json={}).status_code == 409


def test_second_resolve_409(login_as, db):
    anna = login_as("anna.k")
    tid = create(anna, db)["id"]
    assert anna.post(f"/api/tickets/{tid}/resolve", json={}).status_code == 200
    assert anna.post(f"/api/tickets/{tid}/resolve", json={}).status_code == 409


def test_unknown_body_field_422_and_401(login_as, anonymous):
    anna = login_as("anna.k")
    tid = create(anna)["id"]
    assert anna.post(f"/api/tickets/{tid}/resolve", json={"status": "CLOSED"}).status_code == 422
    assert anonymous.post(f"/api/tickets/{tid}/resolve", json={}).status_code == 401

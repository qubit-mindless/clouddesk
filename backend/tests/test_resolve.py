"""POST /api/tickets/{id}/resolve – zgłaszający zamyka własne zgłoszenie po pomocy asystenta AI."""

import pytest
from sqlalchemy import select

from app.models import TicketHistory


def create(client, **overrides):
    body = {"title": "Nie działa VPN", "description": "Błąd logowania po aktualizacji.", "priority": "P2"}
    body.update(overrides)
    res = client.post("/api/tickets", json=body)
    assert res.status_code == 201, res.text
    return res.json()


def test_reporter_resolves_own_ticket_with_history(login_as, db):
    anna = login_as("anna.k")
    tid = create(anna)["id"]
    login_as("tech.jan").patch(f"/api/tickets/{tid}", json={"status": "IN_PROGRESS"})

    res = anna.post(f"/api/tickets/{tid}/resolve", json={})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["status"] == "RESOLVED"
    assert body["resolvedAt"] is not None

    with db() as session:
        rows = session.scalars(
            select(TicketHistory).where(TicketHistory.ticket_id == tid).order_by(TicketHistory.id)
        ).all()
        assert [(h.field, h.old_value, h.new_value, h.author.email) for h in rows[-2:]] == [
            ("status", "IN_PROGRESS", "RESOLVED", "anna.k@clouddesk.example"),
            ("resolution", None, "SELF_AI", "anna.k@clouddesk.example"),
        ]


@pytest.mark.parametrize("staff", ["tech.jan", "admin"])
def test_staff_gets_403(login_as, staff):
    tid = create(login_as("anna.k"))["id"]
    res = login_as(staff).post(f"/api/tickets/{tid}/resolve", json={})
    assert res.status_code == 403


def test_staff_own_ticket_also_403(login_as):
    # Technik i administrator zamykają przez PATCH status – także zgłoszenia, które sami założyli.
    admin = login_as("admin")
    tid = create(admin)["id"]
    assert admin.post(f"/api/tickets/{tid}/resolve", json={}).status_code == 403


def test_foreign_ticket_404_for_reporter(login_as):
    tid = create(login_as("anna.k"))["id"]
    res = login_as("piotr.m").post(f"/api/tickets/{tid}/resolve", json={})
    assert res.status_code == 404
    assert login_as("piotr.m").post("/api/tickets/9999/resolve", json={}).status_code == 404
    assert login_as("tech.jan").post("/api/tickets/9999/resolve", json={}).status_code == 404


@pytest.mark.parametrize("closed", ["RESOLVED", "CLOSED"])
def test_already_closed_409(login_as, closed):
    anna = login_as("anna.k")
    tid = create(anna)["id"]
    login_as("tech.jan").patch(f"/api/tickets/{tid}", json={"status": closed})
    assert anna.post(f"/api/tickets/{tid}/resolve", json={}).status_code == 409


def test_second_resolve_409(login_as):
    anna = login_as("anna.k")
    tid = create(anna)["id"]
    assert anna.post(f"/api/tickets/{tid}/resolve", json={}).status_code == 200
    assert anna.post(f"/api/tickets/{tid}/resolve", json={}).status_code == 409


def test_unknown_body_field_422_and_401(login_as, anonymous):
    anna = login_as("anna.k")
    tid = create(anna)["id"]
    assert anna.post(f"/api/tickets/{tid}/resolve", json={"status": "CLOSED"}).status_code == 422
    assert anonymous.post(f"/api/tickets/{tid}/resolve", json={}).status_code == 401

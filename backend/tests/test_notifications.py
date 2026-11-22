"""GET /api/notifications i POST /api/notifications/read – dzwonek wyliczany z historii i zgłoszeń."""

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select, update

from app.models import Ticket, TicketHistory, User
from tests.conftest import email


def create(client, title="Nie działa VPN", priority="P3"):
    res = client.post("/api/tickets", json={"title": title, "description": "Opis.", "priority": priority})
    assert res.status_code == 201, res.text
    return res.json()["id"]


def notifications(client):
    res = client.get("/api/notifications")
    assert res.status_code == 200, res.text
    return res.json()


def kinds(client):
    return [(n["kind"], n["ticketId"], n["value"]) for n in notifications(client)["items"]]


def set_ticket(db, ticket_id, **values):
    with db() as session:
        session.execute(update(Ticket).where(Ticket.id == ticket_id).values(**values))
        session.commit()


def test_requires_token(anonymous):
    assert anonymous.get("/api/notifications").status_code == 401
    assert anonymous.post("/api/notifications/read", json={}).status_code == 401


def test_assigned_by_someone_else(login_as):
    admin, tech = login_as("admin"), login_as("tech.jan")
    tid = create(login_as("anna.k"))
    admin.patch(f"/api/tickets/{tid}", json={"assignee": "tech.jan"})

    (item,) = notifications(tech)["items"]
    assert item == {
        "id": item["id"],
        "kind": "assigned",
        "ticketId": tid,
        "ticketTitle": "Nie działa VPN",
        "actorName": "Administrator",
        "value": "tech.jan",
        "at": item["at"],
        "unread": True,
    }
    assert item["id"].startswith("n-h-") and item["at"].endswith("Z")
    # Administrator sam przypisał – własnej zmiany nie dostaje.
    assert kinds(admin) == []


def test_self_assignment_is_not_notified_but_reporter_gets_taken_and_status(login_as):
    anna, tech = login_as("anna.k"), login_as("tech.jan")
    tid = create(anna)
    tech.patch(f"/api/tickets/{tid}", json={"assignee": "tech.jan", "status": "ASSIGNED"})

    assert kinds(tech) == []
    assert sorted(kinds(anna)) == [("status", tid, "ASSIGNED"), ("taken", tid, "tech.jan")]
    assert {n["actorName"] for n in notifications(anna)["items"]} == {"Jan Kowalski"}

    # Zwolnienie zgłoszenia (assignee → null) nie jest „przejęciem”.
    tech.patch(f"/api/tickets/{tid}", json={"assignee": None})
    assert len(kinds(anna)) == 2


def test_own_changes_and_resolve_are_not_notified(login_as):
    anna = login_as("anna.k")
    tid = create(anna, priority="P1")
    anna.patch(f"/api/tickets/{tid}", json={"title": "Nowy tytuł zgłoszenia"})
    anna.post(f"/api/tickets/{tid}/resolve", json={})
    assert kinds(anna) == []


def test_new_p1_for_staff_except_own(login_as):
    anna, admin, tech = login_as("anna.k"), login_as("admin"), login_as("tech.jan")
    p1 = create(anna, priority="P1")
    create(anna, priority="P2")
    own = create(admin, priority="P1")

    assert kinds(tech) == [("new_p1", own, "P1"), ("new_p1", p1, "P1")]
    assert kinds(admin) == [("new_p1", p1, "P1")]
    assert notifications(admin)["items"][0]["actorName"] == "Anna Kaczmarek"
    assert kinds(anna) == []


def test_sla_breached_recipients(login_as, db):
    anna, admin, tech = login_as("anna.k"), login_as("admin"), login_as("tech.jan")
    now = datetime.now(UTC)
    unassigned, mine, old, done = (create(anna, title=f"Zgłoszenie numer {i}") for i in range(4))
    for tid in (unassigned, mine, done):
        set_ticket(db, tid, sla_due_at=now - timedelta(hours=1))
    set_ticket(db, old, sla_due_at=now - timedelta(days=8))  # poza oknem 7 dni
    admin.patch(f"/api/tickets/{mine}", json={"assignee": "tech.jan"})
    admin.patch(f"/api/tickets/{done}", json={"status": "RESOLVED"})

    def breached(client):
        return sorted(t for k, t, _ in kinds(client) if k == "sla_breached")

    assert breached(tech) == sorted([unassigned, mine])
    # Przypisane do kogoś innego – tylko ten technik; nieprzypisane – wszyscy technicy i administratorzy.
    assert breached(admin) == [unassigned]
    assert breached(anna) == []
    item = next(n for n in notifications(tech)["items"] if n["id"] == f"n-sla-{mine}")
    assert item["actorName"] is None and item["value"] == "P3"


def test_reporter_does_not_see_foreign_notifications(login_as):
    anna, piotr, tech = login_as("anna.k"), login_as("piotr.m"), login_as("tech.jan")
    tid = create(anna, priority="P1")
    tech.patch(f"/api/tickets/{tid}", json={"assignee": "tech.jan", "status": "IN_PROGRESS"})
    assert kinds(piotr) == []
    assert len(kinds(anna)) == 2


def test_window_sort_and_limit(login_as, db):
    anna, tech = login_as("anna.k"), login_as("tech.jan")
    now = datetime.now(UTC)
    ids = [create(anna, title=f"Awaria serwera {i}", priority="P1") for i in range(23)]
    for offset, tid in enumerate(ids):
        set_ticket(db, tid, created_at=now - timedelta(minutes=offset))
    set_ticket(db, ids[0], created_at=now - timedelta(days=7, minutes=1))  # poza oknem 7 dni

    items = notifications(tech)["items"]
    assert len(items) == 20
    assert [n["ticketId"] for n in items] == ids[1:21]
    assert [n["at"] for n in items] == sorted((n["at"] for n in items), reverse=True)


def test_mark_read_then_new_events_are_unread(login_as, db):
    anna, admin, tech = login_as("anna.k"), login_as("admin"), login_as("tech.jan")
    tid = create(anna)
    admin.patch(f"/api/tickets/{tid}", json={"assignee": "tech.jan", "status": "ASSIGNED"})
    assert notifications(anna)["unread"] == 2
    assert notifications(tech)["unread"] == 1

    res = anna.post("/api/notifications/read", json={})
    assert res.status_code == 204 and res.content == b""
    after = notifications(anna)
    assert after["unread"] == 0 and len(after["items"]) == 2
    assert not any(n["unread"] for n in after["items"])

    with db() as session:
        user = session.scalars(select(User).where(User.email == email("anna.k"))).one()
        seen = user.notifications_seen_at
        assert seen is not None
        tech_id = session.scalars(select(User.id).where(User.email == email("tech.jan"))).one()
        session.add(
            TicketHistory(
                ticket_id=tid, changed_by=tech_id, field="status", old_value="ASSIGNED",
                new_value="IN_PROGRESS", changed_at=seen + timedelta(seconds=1),
            )
        )  # fmt: skip
        session.commit()

    fresh = notifications(anna)
    assert fresh["unread"] == 1
    assert [(n["value"], n["unread"]) for n in fresh["items"]][0] == ("IN_PROGRESS", True)
    # Przeczytanie u jednej osoby nie zmienia stanu u innych.
    assert notifications(tech)["unread"] == 1


@pytest.mark.parametrize("login", ["admin", "tech.jan", "anna.k"])
def test_every_role_can_read(login_as, login):
    client = login_as(login)
    assert client.get("/api/notifications").status_code == 200
    assert client.post("/api/notifications/read", json={}).status_code == 204
    assert client.post("/api/notifications/read", json={"all": True}).status_code == 422

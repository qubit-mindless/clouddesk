"""GET /api/tickets/{id}/history – oś historii zgłoszenia (#139)."""

from datetime import UTC, datetime

import pytest
from sqlalchemy import select

from app.models import TicketHistory, User
from tests.conftest import add_assistant_answer, email


def create(client, title="Nie działa drukarka", priority="P3") -> int:
    res = client.post(
        "/api/tickets", json={"title": title, "description": "Opis problemu", "priority": priority}
    )
    assert res.status_code == 201, res.text
    return res.json()["id"]


def history(client, ticket_id: int):
    return client.get(f"/api/tickets/{ticket_id}/history")


def test_requires_token(anonymous, login_as):
    tid = create(login_as("anna.k"))
    assert history(anonymous, tid).status_code == 401


def test_new_ticket_has_empty_history(login_as):
    anna = login_as("anna.k")
    tid = create(anna)
    res = history(anna, tid)
    assert res.status_code == 200
    assert res.json() == {"items": []}


def test_changes_shape_and_order(login_as):
    anna, tech = login_as("anna.k"), login_as("tech.jan")
    tid = create(anna)
    tech.patch(f"/api/tickets/{tid}", json={"assignee": "tech.jan", "status": "ASSIGNED"})
    tech.patch(f"/api/tickets/{tid}", json={"priority": "P1"})
    tech.patch(f"/api/tickets/{tid}", json={"assignee": None})

    res = history(anna, tid)
    assert res.status_code == 200
    items = res.json()["items"]
    assert [(i["field"], i["oldValue"], i["newValue"]) for i in items] == [
        ("assignee", None, "tech.jan"),
        ("status", "NEW", "ASSIGNED"),
        ("priority", "P3", "P1"),
        ("assignee", "tech.jan", None),
    ]
    first = items[0]
    assert set(first) == {"id", "field", "oldValue", "newValue", "author", "authorName", "changedAt"}
    assert first["author"] == "tech.jan"
    assert first["authorName"] == "Jan Kowalski"
    # ISO 8601 w UTC – jak pozostałe daty w API.
    assert datetime.fromisoformat(first["changedAt"]).utcoffset().total_seconds() == 0
    ids = [i["id"] for i in items]
    assert ids == sorted(ids)


def test_order_by_time_then_id(login_as, db):
    """Kolejność z `changed_at`, a nie z kolejności zapisu; przy równym czasie – `id`."""
    anna = login_as("anna.k")
    tid = create(anna)
    early = datetime(2026, 11, 1, 8, 0, tzinfo=UTC)
    late = datetime(2026, 11, 2, 8, 0, tzinfo=UTC)
    with db() as session:
        author = session.scalar(select(User).where(User.email == email("anna.k")))
        for field, at in [("title", late), ("priority", early), ("description", early)]:
            session.add(TicketHistory(ticket_id=tid, changed_by=author.id, field=field, changed_at=at))
        session.commit()

    fields = [i["field"] for i in history(anna, tid).json()["items"]]
    assert fields == ["priority", "description", "title"]


def test_reporter_resolve_adds_resolution(login_as, db):
    anna = login_as("anna.k")
    tid = create(anna)
    add_assistant_answer(db, tid)
    assert anna.post(f"/api/tickets/{tid}/resolve", json={}).status_code == 200

    items = history(anna, tid).json()["items"]
    assert [(i["field"], i["newValue"], i["author"]) for i in items] == [
        ("status", "RESOLVED", "anna.k"),
        ("resolution", "SELF_AI", "anna.k"),
    ]


def test_reporter_foreign_ticket_404(login_as):
    tid = create(login_as("anna.k"))
    res = history(login_as("piotr.m"), tid)
    assert res.status_code == 404


@pytest.mark.parametrize("staff", ["tech.jan", "admin"])
def test_staff_sees_any_ticket(login_as, staff):
    anna = login_as("anna.k")
    tid = create(anna)
    anna.patch(f"/api/tickets/{tid}", json={"title": "Nie działa drukarka na 2 piętrze"})
    items = history(login_as(staff), tid).json()["items"]
    assert [(i["field"], i["author"]) for i in items] == [("title", "anna.k")]


def test_missing_ticket_404(client):
    assert history(client, 999_999).status_code == 404


def test_invalid_id_422(client):
    res = history(client, "abc")
    assert res.status_code == 422
    assert res.json()["detail"][0]["loc"] == ["path", "ticket_id"]


def test_deleted_ticket_404(client):
    tid = create(client)
    client.patch(f"/api/tickets/{tid}", json={"priority": "P2"})
    assert client.delete(f"/api/tickets/{tid}").status_code == 204
    assert history(client, tid).status_code == 404

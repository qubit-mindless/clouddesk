"""GET /api/activity – „Aktywność na żywo”: zmiany z historii, utworzenia zgłoszeń, odpowiedzi asystenta."""

from datetime import UTC, date, datetime, timedelta

import pytest
from sqlalchemy import update

from app.core import clock
from app.models import AiMessage, AiMessageRole, Ticket, TicketHistory

DESCRIPTION = "Sekretny opis problemu z VPN"
AI_ANSWER = "Treść odpowiedzi asystenta, której nie pokazujemy"


def create(client, title="Nie działa VPN", priority="P2"):
    body = {"title": title, "description": DESCRIPTION, "priority": priority}
    res = client.post("/api/tickets", json=body)
    assert res.status_code == 201, res.text
    return res.json()["id"]


def add_answer(db, ticket_id: int, at: datetime | None = None) -> int:
    with db() as session:
        message = AiMessage(ticket_id=ticket_id, role=AiMessageRole.ASSISTANT, content=AI_ANSWER)
        if at is not None:
            message.created_at = at
        session.add(message)
        session.add(AiMessage(ticket_id=ticket_id, role=AiMessageRole.USER, content="pytanie"))
        session.commit()
        return message.id


def test_requires_token(anonymous):
    assert anonymous.get("/api/activity").status_code == 401


@pytest.mark.parametrize("limit", ["0", "51", "-1", "abc"])
def test_invalid_limit_422(client, limit):
    res = client.get("/api/activity", params={"limit": limit})
    assert res.status_code == 422
    assert res.json()["detail"][0]["loc"] == ["query", "limit"]


def test_kinds_shape_and_no_content(login_as, db):
    anna, tech = login_as("anna.k"), login_as("tech.jan")
    tid = create(anna, priority="P3")
    tech.patch(f"/api/tickets/{tid}", json={"priority": "P1", "description": "Nowy sekretny opis"})
    tech.patch(f"/api/tickets/{tid}", json={"assignee": "tech.jan", "status": "ASSIGNED"})
    add_answer(db, tid)

    res = tech.get("/api/activity")
    assert res.status_code == 200
    items = res.json()["items"]
    by_kind = {kind: [i for i in items if i["kind"] == kind] for kind in ("change", "created", "ai")}

    created = by_kind["created"][0]
    assert created == {
        "id": f"t-{tid}",
        "kind": "created",
        "ticketId": tid,
        "ticketTitle": "Nie działa VPN",
        "actor": "anna.k",
        "actorName": "Anna Kaczmarek",
        "field": "priority",
        "oldValue": None,
        # Priorytet z chwili utworzenia, a nie bieżący (P1 nadał później technik).
        "newValue": "P3",
        "at": created["at"],
    }
    assert created["at"].endswith("Z")

    changes = {c["field"]: c for c in by_kind["change"]}
    assert set(changes) == {"priority", "description", "assignee", "status"}
    assert (changes["status"]["oldValue"], changes["status"]["newValue"]) == ("NEW", "ASSIGNED")
    assert changes["status"]["actor"] == "tech.jan" and changes["status"]["actorName"] == "Jan Kowalski"
    assert changes["status"]["id"].startswith("h-")
    # Zmiana opisu – tylko fakt zmiany, bez treści.
    assert changes["description"]["oldValue"] is None and changes["description"]["newValue"] is None

    (answer,) = by_kind["ai"]  # pytanie użytkownika nie jest zdarzeniem
    assert answer["actor"] is None and answer["actorName"] == "Asystent AI"
    assert answer["field"] is None and answer["id"].startswith("a-")

    assert DESCRIPTION not in res.text and "Nowy sekretny opis" not in res.text and AI_ANSWER not in res.text
    assert len({i["id"] for i in items}) == len(items)


def test_resolution_row_is_listed(login_as, db):
    anna = login_as("anna.k")
    tid = create(anna)
    add_answer(db, tid)
    assert anna.post(f"/api/tickets/{tid}/resolve", json={}).status_code == 200
    changes = [i for i in anna.get("/api/activity").json()["items"] if i["kind"] == "change"]
    assert {(c["field"], c["newValue"]) for c in changes} == {
        ("status", "RESOLVED"),
        ("resolution", "SELF_AI"),
    }


def test_reporter_sees_only_own_tickets(login_as, db):
    anna, piotr, tech = login_as("anna.k"), login_as("piotr.m"), login_as("tech.jan")
    own = create(anna, title="Zgłoszenie Anny")
    foreign = create(piotr, title="Zgłoszenie Piotra")
    tech.patch(f"/api/tickets/{foreign}", json={"status": "IN_PROGRESS"})
    add_answer(db, foreign)

    anna_items = anna.get("/api/activity").json()["items"]
    assert {i["ticketId"] for i in anna_items} == {own}
    assert "Zgłoszenie Piotra" not in str(anna_items)

    staff_items = login_as("admin").get("/api/activity").json()["items"]
    assert {i["ticketId"] for i in staff_items} == {own, foreign}
    assert {i["kind"] for i in staff_items if i["ticketId"] == foreign} == {"created", "change", "ai"}


def test_sorted_newest_first_and_limited(client, db):
    base = datetime(2026, 11, 20, 12, 0, tzinfo=UTC)
    first, second = create(client, title="Pierwsze zgłoszenie"), create(client, title="Drugie zgłoszenie")
    with db() as session:
        session.execute(update(Ticket).where(Ticket.id == first).values(created_at=base))
        session.execute(
            update(Ticket).where(Ticket.id == second).values(created_at=base + timedelta(hours=1))
        )
        session.commit()
    add_answer(db, first, at=base + timedelta(hours=2))
    # Ta sama chwila co odpowiedź – kolejność ustala rodzaj zdarzenia (zmiana przed odpowiedzią AI w czasie).
    with db() as session:
        admin_id = session.get(Ticket, first).reporter_id
        session.add(
            TicketHistory(
                ticket_id=first, changed_by=admin_id, field="title", old_value="a", new_value="b",
                changed_at=base + timedelta(hours=2),
            )
        )  # fmt: skip
        session.commit()

    items = client.get("/api/activity").json()["items"]
    assert [i["id"][0] for i in items] == ["a", "h", "t", "t"]
    assert [i["ticketId"] for i in items[2:]] == [second, first]

    limited = client.get("/api/activity", params={"limit": 2}).json()["items"]
    assert [i["id"] for i in limited] == [i["id"] for i in items[:2]]


@pytest.mark.parametrize("use_zoneinfo", [True, False])
def test_warsaw_day_boundaries(monkeypatch, use_zoneinfo):
    """Dzień w Polsce z bazą stref (zoneinfo) i bez niej (reguła UE, obraz bez tzdata) – te same wyniki."""
    if not use_zoneinfo:
        monkeypatch.setattr(clock, "_ZONE", None)
    # Zima (UTC+1): 22.11 zaczyna się 21.11 o 23:00 UTC.
    assert clock.day_start(date(2026, 11, 22)) == datetime(2026, 11, 21, 23, 0, tzinfo=UTC)
    assert clock.local_date(datetime(2026, 11, 21, 23, 30, tzinfo=UTC)) == date(2026, 11, 22)
    assert clock.local_date(datetime(2026, 11, 21, 22, 59, tzinfo=UTC)) == date(2026, 11, 21)
    # Lato (UTC+2).
    assert clock.day_start(date(2026, 7, 1)) == datetime(2026, 6, 30, 22, 0, tzinfo=UTC)
    # Dni zmiany czasu w 2026: 29.03 i 25.10 (zmiana o 01:00 UTC).
    assert clock.day_start(date(2026, 3, 29)) == datetime(2026, 3, 28, 23, 0, tzinfo=UTC)
    assert clock.day_start(date(2026, 3, 30)) == datetime(2026, 3, 29, 22, 0, tzinfo=UTC)
    assert clock.day_start(date(2026, 10, 25)) == datetime(2026, 10, 24, 22, 0, tzinfo=UTC)
    assert clock.day_start(date(2026, 10, 26)) == datetime(2026, 10, 25, 23, 0, tzinfo=UTC)
    assert clock.local_date(datetime(2026, 10, 25, 22, 30, tzinfo=UTC)) == date(2026, 10, 25)
    assert clock.local_date(datetime(2026, 3, 29, 22, 30, tzinfo=UTC)) == date(2026, 3, 30)
    # Daty bez strefy (SQLite) traktujemy jako UTC.
    assert clock.local_date(datetime(2026, 11, 21, 23, 30)) == date(2026, 11, 22)


def test_fallback_matches_zoneinfo_every_hour_of_year(monkeypatch):
    moments = [datetime(2026, 1, 1, tzinfo=UTC) + timedelta(hours=h) for h in range(0, 366 * 24)]
    days = [date(2026, 1, 1) + timedelta(days=d) for d in range(366)]
    with_zone = ([clock.local_date(m) for m in moments], [clock.day_start(d) for d in days])
    monkeypatch.setattr(clock, "_ZONE", None)
    assert ([clock.local_date(m) for m in moments], [clock.day_start(d) for d in days]) == with_zone

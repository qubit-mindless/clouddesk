"""GET /api/stats – pulpit SLA (#138); okno czasu w dniach kalendarzowych strefy Europe/Warsaw."""

from datetime import UTC, date, datetime, timedelta

import pytest
from sqlalchemy import select

from app.core import clock
from app.core.security import hash_password
from app.models import (
    AiMessage,
    AiMessageRole,
    Ticket,
    TicketHistory,
    TicketPriority,
    TicketStatus,
    User,
    UserRole,
)
from tests.conftest import email

# 22.11.2026, 11:00 w Polsce (UTC+1) – dzień w Polsce zaczął się 21.11 o 23:00 UTC.
NOW = datetime(2026, 11, 22, 10, 0, tzinfo=UTC)
LONG_AGO = NOW - timedelta(days=50)


@pytest.fixture
def frozen(monkeypatch):
    monkeypatch.setattr(clock, "utc_now", lambda: NOW)


def user_id(session, login: str) -> int:
    return session.scalars(select(User.id).where(User.email == email(login))).one()


def add_technician(db, login="tech.ola", name="Aleksandra Nowak") -> None:
    with db() as session:
        session.add(
            User(
                email=email(login), full_name=name, role=UserRole.TECHNICIAN, password_hash=hash_password("x")
            )
        )
        session.commit()


def add_ticket(
    db,
    *,
    priority=TicketPriority.P3,
    status=TicketStatus.NEW,
    assignee=None,
    created=NOW - timedelta(hours=1),
    due=NOW + timedelta(days=2),
    resolved=None,
    title="Zgłoszenie testowe",
) -> int:
    with db() as session:
        ticket = Ticket(
            title=title,
            description="Opis, którego pulpit nie potrzebuje.",
            priority=priority,
            status=status,
            reporter_id=user_id(session, "anna.k"),
            assignee_id=user_id(session, assignee) if assignee else None,
            created_at=created,
            updated_at=created,
            sla_due_at=due,
            resolved_at=resolved,
        )
        session.add(ticket)
        session.commit()
        return ticket.id


def add_message(db, ticket_id: int, at: datetime, role=AiMessageRole.ASSISTANT) -> None:
    with db() as session:
        session.add(AiMessage(ticket_id=ticket_id, role=role, content="Odpowiedź.", created_at=at))
        session.commit()


def daily_map(body) -> dict[str, tuple[int, int]]:
    return {d["date"]: (d["created"], d["resolved"]) for d in body["daily"]}


def test_requires_token(anonymous):
    assert anonymous.get("/api/stats").status_code == 401


def test_reporter_403(login_as):
    assert login_as("anna.k").get("/api/stats").status_code == 403


@pytest.mark.parametrize("staff", ["tech.jan", "admin"])
def test_staff_200(login_as, staff):
    assert login_as(staff).get("/api/stats").status_code == 200


@pytest.mark.parametrize("days", ["6", "91", "0", "abc"])
def test_invalid_days_422(client, days):
    res = client.get("/api/stats", params={"days": days})
    assert res.status_code == 422
    assert res.json()["detail"][0]["loc"] == ["query", "days"]


def test_empty_database(client, frozen):
    res = client.get("/api/stats")
    assert res.status_code == 200
    body = res.json()
    assert body["days"] == 30
    assert body["generatedAt"].startswith("2026-11-22T10:00:00")
    assert body["byStatus"] == {"NEW": 0, "ASSIGNED": 0, "IN_PROGRESS": 0, "RESOLVED": 0, "CLOSED": 0}
    assert body["byPriority"] == {"P1": 0, "P2": 0, "P3": 0, "P4": 0}
    assert body["sla"] == {
        "open": 0,
        "breachedOpen": 0,
        "atRisk": 0,
        "resolved": 0,
        "resolvedOnTime": 0,
        "compliancePct": None,
    }
    assert body["mttrHours"] is None
    assert body["perTechnician"] == [
        {"login": "tech.jan", "fullName": "Jan Kowalski", "open": 0, "resolved": 0}
    ]
    assert body["ai"] == {"answers": 0, "tickets": 0}
    assert body["atRiskTop"] == []
    assert len(body["daily"]) == 30
    assert body["daily"][0] == {"date": "2026-10-24", "created": 0, "resolved": 0}
    assert body["daily"][-1]["date"] == "2026-11-22"


def test_numbers(client, db, frozen):
    add_technician(db)
    breached = add_ticket(
        db, priority=TicketPriority.P1, status=TicketStatus.IN_PROGRESS, assignee="tech.jan",
        created=NOW - timedelta(hours=5), due=NOW - timedelta(hours=1), title="Po terminie",
    )  # fmt: skip
    # SLA 8 h, zostało 1 h < 25% → zagrożone.
    at_risk = add_ticket(
        db, priority=TicketPriority.P2, status=TicketStatus.ASSIGNED, assignee="tech.ola",
        created=NOW - timedelta(hours=7), due=NOW + timedelta(hours=1),
    )  # fmt: skip
    add_ticket(db)  # otwarte, w terminie, nieprzypisane
    # Rozwiązane w terminie (8 h), dziś.
    add_ticket(
        db, status=TicketStatus.RESOLVED, assignee="tech.jan", created=NOW - timedelta(hours=10),
        resolved=NOW - timedelta(hours=2), due=NOW - timedelta(hours=1),
    )  # fmt: skip
    # Zamknięte po terminie (10 h), wczoraj: utworzone 21.11 05:00, rozwiązane 21.11 15:00 czasu polskiego.
    add_ticket(
        db, status=TicketStatus.CLOSED, assignee="tech.ola", created=NOW - timedelta(hours=30),
        resolved=NOW - timedelta(hours=20), due=NOW - timedelta(hours=24),
    )  # fmt: skip
    # Poza oknem: liczy się tylko w byStatus.
    add_ticket(
        db, status=TicketStatus.RESOLVED, assignee="tech.jan", created=LONG_AGO,
        resolved=LONG_AGO + timedelta(hours=1), due=LONG_AGO + timedelta(days=2),
    )  # fmt: skip
    # Administrator nie jest na liście techników, ale jego zgłoszenie liczy się w SLA.
    add_ticket(
        db, priority=TicketPriority.P4, status=TicketStatus.ASSIGNED, assignee="admin",
        created=LONG_AGO, due=LONG_AGO + timedelta(days=5),
    )  # fmt: skip

    body = client.get("/api/stats").json()
    assert body["byStatus"] == {"NEW": 1, "ASSIGNED": 2, "IN_PROGRESS": 1, "RESOLVED": 2, "CLOSED": 1}
    assert body["byPriority"] == {"P1": 1, "P2": 1, "P3": 1, "P4": 1}
    assert body["sla"] == {
        "open": 4,
        "breachedOpen": 2,
        "atRisk": 1,
        "resolved": 2,
        "resolvedOnTime": 1,
        "compliancePct": 50.0,
    }
    assert body["mttrHours"] == 9.0
    assert body["perTechnician"] == [
        {"login": "tech.jan", "fullName": "Jan Kowalski", "open": 1, "resolved": 1},
        {"login": "tech.ola", "fullName": "Aleksandra Nowak", "open": 1, "resolved": 1},
    ]
    days = daily_map(body)
    assert days["2026-11-22"] == (4, 1)
    assert days["2026-11-21"] == (1, 1)
    assert sum(r for _, r in days.values()) == body["sla"]["resolved"]

    top = body["atRiskTop"]
    # Sort po terminie: przekroczone zgłoszenie administratora, P1 po terminie, potem zagrożone.
    assert [t["id"] for t in top][1:] == [breached, at_risk]
    assert top[1] == {
        "id": breached,
        "title": "Po terminie",
        "priority": "P1",
        "status": "IN_PROGRESS",
        "assignee": "tech.jan",
        "createdAt": "2026-11-22T05:00:00Z",
        "slaDueAt": "2026-11-22T09:00:00Z",
    }


def test_at_risk_top_limited_to_five_sorted_by_due(client, db, frozen):
    ids = [add_ticket(db, created=NOW - timedelta(days=1), due=NOW - timedelta(hours=h)) for h in range(1, 8)]
    top = client.get("/api/stats").json()["atRiskTop"]
    # Najstarszy termin = największe h = ostatnio dodane.
    assert [t["id"] for t in top] == list(reversed(ids))[:5]


def test_compliance_rounding(client, db, frozen):
    for late in (False, False, True):
        due = NOW + timedelta(hours=1) if not late else NOW - timedelta(hours=5)
        add_ticket(
            db, status=TicketStatus.RESOLVED, created=NOW - timedelta(hours=6),
            resolved=NOW - timedelta(hours=4), due=due,
        )  # fmt: skip
    body = client.get("/api/stats").json()
    assert body["sla"]["compliancePct"] == 66.7
    assert body["mttrHours"] == 2.0


def test_window_uses_warsaw_calendar_days(client, db, frozen):
    """days=7: okno od 16.11 00:00 czasu polskiego (15.11 23:00 UTC) do dziś włącznie."""
    first = clock.day_start(date(2026, 11, 16))
    assert first == datetime(2026, 11, 15, 23, 0, tzinfo=UTC)
    add_ticket(db, created=first)  # pierwszy dzień okna
    add_ticket(db, created=first - timedelta(seconds=1))  # dzień przed oknem
    add_ticket(db, status=TicketStatus.RESOLVED, created=LONG_AGO, resolved=first, due=first)
    add_ticket(
        db, status=TicketStatus.RESOLVED, created=LONG_AGO, resolved=first - timedelta(seconds=1), due=first
    )
    # 21.11 23:30 UTC to już 22.11 w Polsce.
    add_ticket(db, created=datetime(2026, 11, 21, 23, 30, tzinfo=UTC))

    body = client.get("/api/stats", params={"days": 7}).json()
    assert [d["date"] for d in body["daily"]] == [f"2026-11-{d}" for d in range(16, 23)]
    days = daily_map(body)
    assert days["2026-11-16"] == (1, 1)
    assert days["2026-11-22"] == (1, 0)
    assert days["2026-11-21"] == (0, 0)
    assert body["sla"]["resolved"] == 1


def test_ai_answers_in_window(client, db, frozen):
    one, two = add_ticket(db), add_ticket(db)
    add_message(db, one, NOW - timedelta(hours=1))
    add_message(db, one, NOW - timedelta(days=3))
    add_message(db, two, NOW - timedelta(minutes=5))
    add_message(db, two, NOW - timedelta(minutes=6), role=AiMessageRole.USER)  # pytanie się nie liczy
    add_message(db, two, LONG_AGO)  # poza oknem

    assert client.get("/api/stats").json()["ai"] == {"answers": 3, "tickets": 2}


def test_reopened_ticket_not_counted_as_resolved(client, db, frozen):
    """Otwarte ponownie (status otwarty, stara data rozwiązania) – liczone jako otwarte, nie rozwiązane."""
    add_ticket(db, status=TicketStatus.IN_PROGRESS, resolved=NOW - timedelta(hours=1))
    sla = client.get("/api/stats").json()["sla"]
    assert (sla["open"], sla["resolved"]) == (1, 0)


# ------------------------------------------------- porównanie z poprzednim okresem i z tygodniem wstecz (↑↓)


def add_status_change(db, ticket_id: int, at: datetime, old: str, new: str) -> None:
    with db() as session:
        session.add(
            TicketHistory(
                ticket_id=ticket_id,
                changed_by=user_id(session, "tech.jan"),
                field="status",
                old_value=old,
                new_value=new,
                changed_at=at,
            )
        )
        session.commit()


def test_previous_period_empty(client, frozen):
    body = client.get("/api/stats").json()
    assert body["previous"] == {"compliancePct": None, "mttrHours": None, "aiAnswers": 0}
    assert body["openWeekAgo"] == 0


def test_previous_period_is_same_length_right_before_window(client, db, frozen):
    """days=7: okno od 16.11 do teraz; poprzedni okres 9.11 00:00 – 15.11 11:00 czasu polskiego."""
    window = clock.day_start(date(2026, 11, 16))
    previous = clock.day_start(date(2026, 11, 9))
    previous_end = clock.days_earlier(NOW, 7)
    assert previous_end == datetime(2026, 11, 15, 10, 0, tzinfo=UTC)
    # W poprzednim okresie: w terminie (4 h) i po terminie (8 h) → 50%, MTTR 6 h.
    add_ticket(
        db, status=TicketStatus.RESOLVED, created=previous, resolved=previous + timedelta(hours=4),
        due=previous + timedelta(hours=8),
    )  # fmt: skip
    last = previous_end - timedelta(seconds=1)
    add_ticket(
        db, status=TicketStatus.CLOSED, created=last - timedelta(hours=8), resolved=last,
        due=last - timedelta(hours=1),
    )  # fmt: skip
    # Nie liczą się: tuż przed poprzednim okresem, od jego końca i z bieżącego okna.
    for done in (previous - timedelta(seconds=1), previous_end, window):
        add_ticket(db, status=TicketStatus.RESOLVED, created=LONG_AGO, resolved=done, due=done)
    ai = add_ticket(db)
    for at in (previous + timedelta(days=1), previous - timedelta(seconds=1), previous_end, window):
        add_message(db, ai, at)

    body = client.get("/api/stats", params={"days": 7}).json()
    assert body["previous"] == {"compliancePct": 50.0, "mttrHours": 6.0, "aiAnswers": 1}
    assert (body["sla"]["resolved"], body["ai"]["answers"]) == (1, 1)


def test_days_earlier_keeps_local_time_across_dst():
    # 2.11 11:00 CET → 23.10 11:00 CEST (przed zmianą czasu 25.10), czyli 09:00 UTC, a nie 10:00.
    assert clock.days_earlier(datetime(2026, 11, 2, 10, 0, tzinfo=UTC), 10) == datetime(
        2026, 10, 23, 9, 0, tzinfo=UTC
    )


def test_open_week_ago_from_status_history(client, db, frozen):
    week_ago = NOW - timedelta(days=7)
    old = NOW - timedelta(days=10)
    # Liczą się (otwarte 7 dni temu):
    add_ticket(db, created=old)  # nadal otwarte, bez historii
    # Rozwiązane później, bez historii:
    add_ticket(db, status=TicketStatus.RESOLVED, created=old, resolved=NOW - timedelta(days=2))
    closed_later = add_ticket(db, status=TicketStatus.CLOSED, created=old, resolved=NOW - timedelta(days=2))
    add_status_change(db, closed_later, old + timedelta(days=1), "NEW", "ASSIGNED")
    add_status_change(db, closed_later, NOW - timedelta(days=2), "ASSIGNED", "RESOLVED")
    only_later = add_ticket(db, status=TicketStatus.RESOLVED, created=old, resolved=NOW - timedelta(days=1))
    add_status_change(db, only_later, NOW - timedelta(days=1), "IN_PROGRESS", "RESOLVED")
    # Nie liczą się:
    add_ticket(db, created=NOW - timedelta(days=3))  # jeszcze nie istniało
    # Rozwiązane już wcześniej:
    add_ticket(db, status=TicketStatus.RESOLVED, created=old, resolved=NOW - timedelta(days=8))
    reopened = add_ticket(db, status=TicketStatus.IN_PROGRESS, created=old)  # wtedy rozwiązane, potem otwarte
    add_status_change(db, reopened, week_ago - timedelta(days=1), "NEW", "RESOLVED")
    add_status_change(db, reopened, NOW - timedelta(days=1), "RESOLVED", "IN_PROGRESS")

    body = client.get("/api/stats").json()
    assert body["openWeekAgo"] == 4
    assert body["sla"]["open"] == 3

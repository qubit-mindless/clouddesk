"""GET /api/me/summary – liczniki „moje”, „zespół” i „Asystent AI dziś”; dzień w strefie Europe/Warsaw."""

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select

from app.core import clock
from app.models import (
    AiMessage,
    AiMessageRole,
    Ticket,
    TicketHistory,
    TicketPriority,
    TicketStatus,
    User,
)
from tests.conftest import email

# 22.11.2026, 11:00 w Polsce (UTC+1) – dzień w Polsce zaczął się 21.11 o 23:00 UTC.
NOW = datetime(2026, 11, 22, 10, 0, tzinfo=UTC)


@pytest.fixture
def frozen(monkeypatch):
    monkeypatch.setattr(clock, "utc_now", lambda: NOW)


def user_id(session, login: str) -> int:
    return session.scalars(select(User.id).where(User.email == email(login))).one()


def add_ticket(
    db,
    *,
    reporter="anna.k",
    assignee=None,
    created=NOW - timedelta(hours=1),
    due=NOW + timedelta(days=1),
    status=TicketStatus.NEW,
    resolved=None,
) -> int:
    with db() as session:
        ticket = Ticket(
            title="Zgłoszenie testowe",
            description="Opis.",
            priority=TicketPriority.P3,
            status=status,
            reporter_id=user_id(session, reporter),
            assignee_id=user_id(session, assignee) if assignee else None,
            created_at=created,
            updated_at=created,
            sla_due_at=due,
            resolved_at=resolved,
        )
        session.add(ticket)
        session.commit()
        return ticket.id


def add_answer(db, ticket_id: int, at: datetime, role=AiMessageRole.ASSISTANT) -> None:
    with db() as session:
        session.add(AiMessage(ticket_id=ticket_id, role=role, content="Odpowiedź.", created_at=at))
        session.commit()


def add_self_resolution(db, ticket_id: int, at: datetime) -> None:
    with db() as session:
        session.add(
            TicketHistory(
                ticket_id=ticket_id, changed_by=user_id(session, "anna.k"), field="resolution",
                old_value=None, new_value="SELF_AI", changed_at=at,
            )
        )  # fmt: skip
        session.commit()


def test_requires_token(anonymous):
    assert anonymous.get("/api/me/summary").status_code == 401


def test_reporter_gets_only_own_open_tickets(login_as, db, frozen):
    add_ticket(db, due=NOW - timedelta(minutes=5))  # po terminie
    add_ticket(db, created=NOW - timedelta(hours=1), due=NOW + timedelta(hours=3))  # ok
    add_ticket(db, status=TicketStatus.RESOLVED, resolved=NOW, due=NOW - timedelta(days=1))
    add_ticket(db, reporter="piotr.m", due=NOW - timedelta(hours=1))

    res = login_as("anna.k").get("/api/me/summary")
    assert res.status_code == 200
    body = res.json()
    assert body["team"] is None and body["aiToday"] is None
    assert body["mine"] == {"open": 2, "breached": 1, "atRisk": 0, "nextDueAt": "2026-11-22T13:00:00Z"}

    piotr = login_as("piotr.m").get("/api/me/summary").json()["mine"]
    assert piotr == {"open": 1, "breached": 1, "atRisk": 0, "nextDueAt": None}


@pytest.mark.parametrize("login", ["tech.jan", "admin"])
def test_staff_mine_is_assigned_open_with_sla_rule(login_as, db, frozen, login):
    other = "admin" if login == "tech.jan" else "tech.jan"
    # Okno SLA 4 h, zostało 50 min (< 25% = 60 min) → zagrożone.
    add_ticket(db, assignee=login, created=NOW - timedelta(minutes=190), due=NOW + timedelta(minutes=50))
    # Zostało dokładnie 25% → jeszcze nie zagrożone.
    add_ticket(db, assignee=login, created=NOW - timedelta(hours=3), due=NOW + timedelta(hours=1))
    add_ticket(db, assignee=login, due=NOW)  # termin właśnie minął → po terminie
    add_ticket(db, assignee=login, status=TicketStatus.CLOSED, resolved=NOW, due=NOW - timedelta(days=2))
    add_ticket(db, assignee=other, due=NOW - timedelta(hours=1))
    add_ticket(db, due=NOW + timedelta(minutes=10), created=NOW - timedelta(hours=8))  # nieprzypisane

    body = login_as(login).get("/api/me/summary").json()
    assert body["mine"] == {"open": 3, "breached": 1, "atRisk": 1, "nextDueAt": "2026-11-22T10:50:00Z"}
    # Zespół: wszystkie otwarte – po terminie moje i kolegi, zagrożone moje i nieprzypisane.
    assert (body["team"]["breached"], body["team"]["atRisk"]) == (2, 2)
    assert body["aiToday"] == {"conversations": 0, "resolvedByReporter": 0, "handedOver": 0, "answers": 0}


def test_team_days_use_warsaw_boundary(client, db, frozen):
    add_ticket(db, created=datetime(2026, 11, 21, 23, 30, tzinfo=UTC))  # 22.11, 00:30 w Polsce – dziś
    add_ticket(db, created=datetime(2026, 11, 21, 22, 30, tzinfo=UTC))  # 21.11, 23:30 w Polsce – wczoraj
    add_ticket(db, created=datetime(2026, 11, 15, 23, 30, tzinfo=UTC))  # 16.11 – pierwszy z 7 dni
    add_ticket(db, created=datetime(2026, 11, 15, 22, 30, tzinfo=UTC))  # 15.11 – poza 7 dniami
    add_ticket(
        db,
        created=datetime(2026, 11, 10, 8, 0, tzinfo=UTC),
        status=TicketStatus.RESOLVED,
        resolved=datetime(2026, 11, 21, 23, 5, tzinfo=UTC),  # dziś w Polsce
    )
    add_ticket(
        db,
        created=datetime(2026, 11, 10, 8, 0, tzinfo=UTC),
        status=TicketStatus.CLOSED,
        resolved=datetime(2026, 11, 21, 22, 55, tzinfo=UTC),  # wczoraj w Polsce
    )

    team = client.get("/api/me/summary").json()["team"]
    assert team["createdToday"] == 1 and team["resolvedToday"] == 1
    assert team["last7Days"] == [
        {"date": "2026-11-16", "created": 1, "resolved": 0},
        {"date": "2026-11-17", "created": 0, "resolved": 0},
        {"date": "2026-11-18", "created": 0, "resolved": 0},
        {"date": "2026-11-19", "created": 0, "resolved": 0},
        {"date": "2026-11-20", "created": 0, "resolved": 0},
        {"date": "2026-11-21", "created": 1, "resolved": 1},
        {"date": "2026-11-22", "created": 1, "resolved": 1},
    ]


def test_ai_today(login_as, db, frozen):
    today = datetime(2026, 11, 21, 23, 15, tzinfo=UTC)  # 22.11 w Polsce
    yesterday = datetime(2026, 11, 21, 22, 45, tzinfo=UTC)  # 21.11 w Polsce
    helped = add_ticket(db, status=TicketStatus.RESOLVED, resolved=NOW)
    add_answer(db, helped, today)
    add_answer(db, helped, NOW - timedelta(minutes=5))
    add_self_resolution(db, helped, NOW - timedelta(minutes=1))
    handed = add_ticket(db)
    add_answer(db, handed, NOW - timedelta(hours=2))
    add_answer(db, handed, NOW - timedelta(hours=2), role=AiMessageRole.USER)  # pytanie się nie liczy
    old = add_ticket(db, status=TicketStatus.RESOLVED, resolved=NOW)
    add_answer(db, old, yesterday)  # rozmowa wczoraj, zamknięcie dziś – nie jest rozmową z dziś
    add_self_resolution(db, old, NOW - timedelta(minutes=2))
    asked_only = add_ticket(db)
    add_answer(db, asked_only, NOW, role=AiMessageRole.USER)

    expected = {"conversations": 2, "resolvedByReporter": 1, "handedOver": 1, "answers": 3}
    assert login_as("tech.jan").get("/api/me/summary").json()["aiToday"] == expected
    assert login_as("admin").get("/api/me/summary").json()["aiToday"] == expected
    assert login_as("anna.k").get("/api/me/summary").json()["aiToday"] is None


def test_resolve_endpoint_counts_as_resolved_by_reporter(login_as, db):
    # Bez zamrożonego czasu: prawdziwy /resolve zapisuje wiersz resolution z bieżącą chwilą.
    anna = login_as("anna.k")
    tid = anna.post(
        "/api/tickets", json={"title": "Nie działa VPN", "description": "Opis.", "priority": "P2"}
    )
    tid = tid.json()["id"]
    add_answer(db, tid, datetime.now(UTC))
    assert anna.post(f"/api/tickets/{tid}/resolve", json={}).status_code == 200

    body = login_as("tech.jan").get("/api/me/summary").json()
    assert body["aiToday"]["resolvedByReporter"] == 1 and body["aiToday"]["handedOver"] == 0
    assert body["team"]["resolvedToday"] == 1 and body["team"]["createdToday"] == 1
    assert body["team"]["last7Days"][-1]["date"] == clock.local_date(datetime.now(UTC)).isoformat()

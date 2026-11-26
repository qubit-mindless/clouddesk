import math
from collections import Counter, defaultdict
from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from app.core import clock
from app.models import TicketPriority, TicketStatus, User

# OPEN_STATUSES przez stats_repository: działa przed i po przeniesieniu stałych do app.models (#181).
from app.repositories.stats_repository import OPEN_STATUSES, ResolvedRow, StatsRepository, StatusChangeRow
from app.repositories.summary_repository import SummaryRepository
from app.schemas.stats import AiStats, AtRiskTicket, PreviousPeriod, SlaStats, Stats, TechnicianStats
from app.schemas.summary import DayCount
from app.services.errors import ForbiddenError
from app.services.summary_service import sla_state
from app.services.ticket_service import STAFF_ROLES, login_of

AT_RISK_TOP = 5
HOUR = timedelta(hours=1)
# „Otwarte tydzień temu” na kafelku – porównanie z bieżącą liczbą otwartych.
WEEK = timedelta(days=7)
OPEN_VALUES = frozenset(status.value for status in OPEN_STATUSES)


def round1(value: float) -> float:
    """Zaokrąglenie do 1 miejsca „połówka w górę” – jak Math.round w makiecie frontendu (fakeStats.ts)."""
    return math.floor(value * 10 + 0.5) / 10


def on_time_count(resolved: list[ResolvedRow]) -> int:
    return sum(1 for _, done, due, _ in resolved if clock.as_utc(done) <= clock.as_utc(due))


def compliance_pct(resolved: list[ResolvedRow]) -> float | None:
    return round1(on_time_count(resolved) / len(resolved) * 100) if resolved else None


def mttr_hours(resolved: list[ResolvedRow]) -> float | None:
    if not resolved:
        return None
    spent = sum((clock.as_utc(done) - clock.as_utc(created) for created, done, _, _ in resolved), timedelta())
    return round1(spent / HOUR / len(resolved))


def was_open(
    moment: datetime, status: TicketStatus, resolved_at: datetime | None, changes: list[StatusChangeRow]
) -> bool:
    """Czy zgłoszenie było otwarte w chwili `moment` (`changes` – zmiany statusu po kolei)."""
    before = [change for change in changes if clock.as_utc(change[1]) <= moment]
    if before:
        return before[-1][3] in OPEN_VALUES
    if changes:
        # Wszystkie zmiany są późniejsze – w chwili `moment` miało status sprzed pierwszej z nich.
        return changes[0][2] in OPEN_VALUES
    # Bez historii statusu (np. dane wgrane seedem): otwarte, jeśli nadal jest albo rozwiązano je później.
    return status in OPEN_STATUSES or (resolved_at is not None and clock.as_utc(resolved_at) > moment)


class StatsService:
    def __init__(self, db: Session, actor: User) -> None:
        self.actor = actor
        self.repo = StatsRepository(db)
        self.summary = SummaryRepository(db)

    def stats(self, days: int) -> Stats:
        if self.actor.role not in STAFF_ROLES:
            raise ForbiddenError("Pulpit SLA jest dostępny dla technika i administratora.")
        now = clock.utc_now()
        # Okno = `days` dni kalendarzowych w Polsce, ostatni to dziś. Kalendarzem, nie odejmowaniem 24 h –
        # zmiana czasu nie zgubi ani nie zdubluje dnia. To samo okno dla daily, sla.resolved, mttr i ai.
        today = clock.local_date(now)
        dates = [today - timedelta(days=offset) for offset in range(days - 1, -1, -1)]
        start, end = clock.day_start(dates[0]), clock.day_start(today + timedelta(days=1))

        statuses = self.repo.status_counts()
        open_tickets = self.repo.open_tickets()
        states = {t.id: sla_state(t.created_at, t.sla_due_at, now) for t in open_tickets}
        resolved = self.repo.resolved_between(start, end)

        # Poprzedni okres: tyle samo dni kalendarzowych tuż przed oknem. Bieżące okno kończy się „teraz”, więc
        # poprzedni – o tej samej porze `days` dni wcześniej; inaczej rano liczba odpowiedzi AI by „spadała”.
        previous_start = clock.day_start(dates[0] - timedelta(days=days))
        previous_end = clock.days_earlier(now, days)
        previous_resolved = self.repo.resolved_between(previous_start, previous_end)
        previous_answers, _ = self.summary.ai_answers_between(previous_start, previous_end)

        open_by_tech = Counter(t.assignee_id for t in open_tickets)
        resolved_by_tech = Counter(assignee_id for *_, assignee_id in resolved)
        technicians = sorted(
            (
                TechnicianStats(
                    login=login_of(u),
                    full_name=u.full_name,
                    open=open_by_tech[u.id],
                    resolved=resolved_by_tech[u.id],
                )
                for u in self.repo.technicians()
            ),
            key=lambda t: (-t.open, t.login),
        )

        created_per_day = Counter(clock.local_date(at) for at in self.summary.created_between(start, end))
        resolved_per_day = Counter(clock.local_date(done) for _, done, _, _ in resolved)
        answers, answered_tickets = self.summary.ai_answers_between(start, end)

        # Przekroczone mają wcześniejszy termin niż zagrożone, więc są na początku listy.
        flagged = sorted(
            (t for t in open_tickets if states[t.id] is not None),
            key=lambda t: (clock.as_utc(t.sla_due_at), t.id),
        )

        return Stats(
            days=days,
            generated_at=now,
            by_status={s: statuses.get(s, 0) for s in TicketStatus},
            by_priority={p: sum(1 for t in open_tickets if t.priority == p) for p in TicketPriority},
            sla=SlaStats(
                open=len(open_tickets),
                breached_open=sum(1 for s in states.values() if s == "breached"),
                at_risk=sum(1 for s in states.values() if s == "at_risk"),
                resolved=len(resolved),
                resolved_on_time=on_time_count(resolved),
                compliance_pct=compliance_pct(resolved),
            ),
            mttr_hours=mttr_hours(resolved),
            per_technician=technicians,
            daily=[
                DayCount(date=day, created=created_per_day[day], resolved=resolved_per_day[day])
                for day in dates
            ],
            ai=AiStats(answers=answers, tickets=answered_tickets),
            at_risk_top=[
                AtRiskTicket(
                    id=t.id,
                    title=t.title,
                    priority=t.priority,
                    status=t.status,
                    assignee=login_of(t.assignee),
                    created_at=clock.as_utc(t.created_at),
                    sla_due_at=clock.as_utc(t.sla_due_at),
                )
                for t in flagged[:AT_RISK_TOP]
            ],
            previous=PreviousPeriod(
                compliance_pct=compliance_pct(previous_resolved),
                mttr_hours=mttr_hours(previous_resolved),
                ai_answers=previous_answers,
            ),
            open_week_ago=self.open_at(now - WEEK),
        )

    def open_at(self, moment: datetime) -> int:
        """Ile zgłoszeń było otwartych w chwili `moment` – z historii zmian statusu."""
        tickets = self.repo.state_candidates(moment)
        changes: defaultdict[int, list[StatusChangeRow]] = defaultdict(list)
        for change in self.repo.status_changes_of([ticket_id for ticket_id, _, _ in tickets]):
            changes[change[0]].append(change)
        return sum(
            1
            for ticket_id, status, resolved_at in tickets
            if was_open(moment, status, resolved_at, changes[ticket_id])
        )

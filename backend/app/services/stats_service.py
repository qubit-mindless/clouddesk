import math
from collections import Counter
from datetime import timedelta

from sqlalchemy.orm import Session

from app.core import clock
from app.models import TicketPriority, TicketStatus, User
from app.repositories.stats_repository import StatsRepository
from app.repositories.summary_repository import SummaryRepository
from app.schemas.stats import AiStats, AtRiskTicket, SlaStats, Stats, TechnicianStats
from app.schemas.summary import DayCount
from app.services.errors import ForbiddenError
from app.services.summary_service import sla_state
from app.services.ticket_service import STAFF_ROLES, login_of

AT_RISK_TOP = 5
HOUR = timedelta(hours=1)


def round1(value: float) -> float:
    """Zaokrąglenie do 1 miejsca „połówka w górę” – jak Math.round w makiecie frontendu (fakeStats.ts)."""
    return math.floor(value * 10 + 0.5) / 10


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

        on_time = sum(1 for _, done, due, _ in resolved if clock.as_utc(done) <= clock.as_utc(due))
        mttr = None
        if resolved:
            spent = sum(
                (clock.as_utc(done) - clock.as_utc(created) for created, done, _, _ in resolved), timedelta()
            )
            mttr = round1(spent / HOUR / len(resolved))

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
                resolved_on_time=on_time,
                compliance_pct=round1(on_time / len(resolved) * 100) if resolved else None,
            ),
            mttr_hours=mttr,
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
        )

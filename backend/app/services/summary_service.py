from collections import Counter
from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from app.core import clock
from app.models import User
from app.models.ticket_history import RESOLUTION_SELF_AI
from app.repositories.summary_repository import SummaryRepository
from app.schemas.summary import AiTodaySummary, DayCount, MeSummary, MineSummary, TeamSummary
from app.services.ticket_service import STAFF_ROLES

# Zagrożone = przed terminem, ale zostało mniej niż 25% czasu SLA (WARNING_RATIO we frontendzie, /api/stats).
AT_RISK_RATIO = 0.25
LAST_DAYS = 7


def sla_state(created: datetime, due: datetime, now: datetime) -> str | None:
    """Otwarte zgłoszenie: "breached" (po terminie), "at_risk" (zostało < 25% czasu SLA) albo None.

    Jedna reguła dla /api/me/summary i /api/stats.
    """
    created, due = clock.as_utc(created), clock.as_utc(due)
    remaining = due - now
    if remaining <= timedelta(0):
        return "breached"
    if remaining < (due - created) * AT_RISK_RATIO:
        return "at_risk"
    return None


def sla_counts(deadlines: list[tuple[datetime, datetime]], now: datetime) -> tuple[int, int, datetime | None]:
    """(po terminie, zagrożone, najbliższy termin przed upływem) dla par (utworzenie, termin SLA)."""
    breached = at_risk = 0
    next_due: datetime | None = None
    for created, due in deadlines:
        state = sla_state(created, due, now)
        if state == "breached":
            breached += 1
            continue
        if state == "at_risk":
            at_risk += 1
        due = clock.as_utc(due)
        if next_due is None or due < next_due:
            next_due = due
    return breached, at_risk, next_due


class SummaryService:
    def __init__(self, db: Session, actor: User) -> None:
        self.actor = actor
        self.stats = SummaryRepository(db)

    def summary(self) -> MeSummary:
        now = clock.utc_now()
        is_staff = self.actor.role in STAFF_ROLES
        if is_staff:
            mine_deadlines = self.stats.open_deadlines(assignee_id=self.actor.id)
        else:
            mine_deadlines = self.stats.open_deadlines(reporter_id=self.actor.id)
        breached, at_risk, next_due = sla_counts(mine_deadlines, now)
        mine = MineSummary(open=len(mine_deadlines), breached=breached, at_risk=at_risk, next_due_at=next_due)
        if not is_staff:
            return MeSummary(mine=mine, team=None, ai_today=None)
        return MeSummary(mine=mine, team=self._team(now), ai_today=self._ai_today(now))

    def _team(self, now: datetime) -> TeamSummary:
        today = clock.local_date(now)
        days = [today - timedelta(days=offset) for offset in range(LAST_DAYS - 1, -1, -1)]
        start, end = clock.day_start(days[0]), clock.day_start(today + timedelta(days=1))
        created = Counter(clock.local_date(at) for at in self.stats.created_between(start, end))
        resolved = Counter(clock.local_date(at) for at in self.stats.resolved_between(start, end))
        breached, at_risk, _ = sla_counts(self.stats.open_deadlines(), now)
        return TeamSummary(
            breached=breached,
            at_risk=at_risk,
            created_today=created[today],
            resolved_today=resolved[today],
            last_7_days=[DayCount(date=day, created=created[day], resolved=resolved[day]) for day in days],
        )

    def _ai_today(self, now: datetime) -> AiTodaySummary:
        today = clock.local_date(now)
        start, end = clock.day_start(today), clock.day_start(today + timedelta(days=1))
        answers, conversations = self.stats.ai_answers_between(start, end)
        resolved = self.stats.self_resolved_with_ai_between(start, end, RESOLUTION_SELF_AI)
        return AiTodaySummary(
            conversations=conversations,
            resolved_by_reporter=resolved,
            handed_over=conversations - resolved,
            answers=answers,
        )

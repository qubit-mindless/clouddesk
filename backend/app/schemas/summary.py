import datetime as dt

from app.schemas.ticket import CamelModel


class MineSummary(CamelModel):
    """Technik/administrator: przypisane do mnie i otwarte; zgłaszający: moje otwarte."""

    open: int
    breached: int
    at_risk: int
    # Najbliższy termin SLA wśród zgłoszeń przed terminem; None, gdy brak.
    next_due_at: dt.datetime | None


class DayCount(CamelModel):
    # Dzień w strefie Europe/Warsaw (YYYY-MM-DD).
    date: dt.date
    created: int
    resolved: int


class TeamSummary(CamelModel):
    breached: int
    at_risk: int
    created_today: int
    resolved_today: int
    # Dokładnie 7 dni od najstarszego, ostatni = dziś.
    last_7_days: list[DayCount]


class AiTodaySummary(CamelModel):
    conversations: int
    resolved_by_reporter: int
    handed_over: int
    answers: int


class MeSummary(CamelModel):
    mine: MineSummary
    # Tylko technik i administrator; dla zgłaszającego None.
    team: TeamSummary | None
    ai_today: AiTodaySummary | None

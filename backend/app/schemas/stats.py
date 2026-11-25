import datetime as dt

from app.models import TicketPriority, TicketStatus
from app.schemas.base import CamelModel
from app.schemas.summary import DayCount

STATS_DEFAULT_DAYS = 30
STATS_MIN_DAYS = 7
STATS_MAX_DAYS = 90


class SlaStats(CamelModel):
    # Otwarte teraz: wszystkie, po terminie, zagrożone (przed terminem, zostało < 25% czasu SLA).
    open: int
    breached_open: int
    at_risk: int
    # Rozwiązane/zamknięte z `resolvedAt` w oknie i z nich rozwiązane w terminie.
    resolved: int
    resolved_on_time: int
    # Tylko z zakończonych (otwarte po terminie są w `breachedOpen`); None, gdy w oknie nic nie rozwiązano.
    compliance_pct: float | None


class TechnicianStats(CamelModel):
    login: str
    full_name: str
    open: int
    resolved: int


class AiStats(CamelModel):
    answers: int
    tickets: int


class AtRiskTicket(CamelModel):
    id: int
    title: str
    priority: TicketPriority
    status: TicketStatus
    assignee: str | None
    created_at: dt.datetime
    sla_due_at: dt.datetime


class Stats(CamelModel):
    days: int
    generated_at: dt.datetime
    # Zawsze wszystkie klucze (kody statusów / priorytetów), także z zerami.
    by_status: dict[TicketStatus, int]
    by_priority: dict[TicketPriority, int]
    sla: SlaStats
    mttr_hours: float | None
    per_technician: list[TechnicianStats]
    # Dokładnie `days` dni w strefie Europe/Warsaw, od najstarszego; ostatni = dziś.
    daily: list[DayCount]
    ai: AiStats
    at_risk_top: list[AtRiskTicket]

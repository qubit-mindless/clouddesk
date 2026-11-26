from datetime import datetime

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, joinedload, load_only

from app.models import Ticket, TicketHistory, TicketStatus, User, UserRole
from app.repositories.summary_repository import CLOSED_STATUSES, OPEN_STATUSES

ResolvedRow = tuple[datetime, datetime, datetime, int | None]
# (id, bieżący status, rozwiązanie) i (id zgłoszenia, chwila zmiany, stary status, nowy status).
TicketStateRow = tuple[int, TicketStatus, datetime | None]
StatusChangeRow = tuple[int, datetime, str | None, str | None]


class StatsRepository:
    """Zapytania do pulpitu SLA (/api/stats). Zakresy czasu [start, end) w UTC; reguły liczy serwis."""

    def __init__(self, db: Session) -> None:
        self.db = db

    def status_counts(self) -> dict[TicketStatus, int]:
        rows = self.db.execute(select(Ticket.status, func.count()).group_by(Ticket.status))
        return {status: count for status, count in rows}

    def open_tickets(self) -> list[Ticket]:
        # Bez opisu – na pulpit trafiają tylko liczby i tytuły; technik dociągany jednym JOIN-em.
        query = (
            select(Ticket)
            .options(
                load_only(
                    Ticket.id,
                    Ticket.title,
                    Ticket.priority,
                    Ticket.status,
                    Ticket.assignee_id,
                    Ticket.created_at,
                    Ticket.sla_due_at,
                ),
                joinedload(Ticket.assignee).load_only(User.email),
            )
            .where(Ticket.status.in_(OPEN_STATUSES))
        )
        return list(self.db.scalars(query))

    def resolved_between(self, start: datetime, end: datetime) -> list[ResolvedRow]:
        """(utworzenie, rozwiązanie, termin SLA, id technika) zgłoszeń rozwiązanych/zamkniętych w zakresie."""
        query = select(Ticket.created_at, Ticket.resolved_at, Ticket.sla_due_at, Ticket.assignee_id).where(
            Ticket.status.in_(CLOSED_STATUSES), Ticket.resolved_at >= start, Ticket.resolved_at < end
        )
        return [(created, done, due, assignee) for created, done, due, assignee in self.db.execute(query)]

    def technicians(self) -> list[User]:
        # Tylko pola potrzebne na pulpit – bez skrótu hasła i innych danych konta.
        query = (
            select(User)
            .options(load_only(User.id, User.email, User.full_name))
            .where(User.role == UserRole.TECHNICIAN)
        )
        return list(self.db.scalars(query))

    def state_candidates(self, moment: datetime) -> list[TicketStateRow]:
        """Zgłoszenia istniejące w chwili `moment`, które mogły być wtedy otwarte.

        Pomija zamknięte dziś bez zmiany statusu i rozwiązania po `moment` – wtedy miały ten sam (zamknięty)
        status. Koszt rośnie z liczbą otwartych i świeżo zmienionych, a nie z całą historią.
        """
        changed_later = select(TicketHistory.ticket_id).where(
            TicketHistory.field == "status", TicketHistory.changed_at > moment
        )
        query = select(Ticket.id, Ticket.status, Ticket.resolved_at).where(
            Ticket.created_at <= moment,
            or_(Ticket.status.in_(OPEN_STATUSES), Ticket.resolved_at > moment, Ticket.id.in_(changed_later)),
        )
        return [(ticket_id, status, done) for ticket_id, status, done in self.db.execute(query)]

    def status_changes_of(self, ticket_ids: list[int]) -> list[StatusChangeRow]:
        """Zmiany statusu podanych zgłoszeń, po kolei (dla każdego zgłoszenia od najstarszej)."""
        if not ticket_ids:
            return []
        query = (
            select(
                TicketHistory.ticket_id,
                TicketHistory.changed_at,
                TicketHistory.old_value,
                TicketHistory.new_value,
            )
            .where(TicketHistory.field == "status", TicketHistory.ticket_id.in_(ticket_ids))
            .order_by(TicketHistory.ticket_id, TicketHistory.changed_at, TicketHistory.id)
        )
        return [(ticket_id, at, old, new) for ticket_id, at, old, new in self.db.execute(query)]

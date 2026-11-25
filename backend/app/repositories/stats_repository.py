from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload, load_only

from app.models import CLOSED_STATUSES, OPEN_STATUSES, Ticket, TicketStatus, User, UserRole

ResolvedRow = tuple[datetime, datetime, datetime, int | None]


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

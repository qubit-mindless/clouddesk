from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload

from app.models import Ticket, TicketPriority, TicketStatus


class TicketRepository:
    """Dostęp do tabeli tickets – jedyne miejsce z zapytaniami SQL o zgłoszenia."""

    def __init__(self, db: Session) -> None:
        self.db = db

    def list(
        self,
        *,
        status: TicketStatus | None,
        priority: TicketPriority | None,
        assignee_id: int | None,
        q: str | None,
        offset: int,
        limit: int,
    ) -> tuple[list[Ticket], int]:
        filters = []
        if status:
            filters.append(Ticket.status == status)
        if priority:
            filters.append(Ticket.priority == priority)
        if assignee_id is not None:
            filters.append(Ticket.assignee_id == assignee_id)
        if q:
            filters.append(Ticket.title.ilike(f"%{q}%"))

        total = self.db.scalar(select(func.count()).select_from(Ticket).where(*filters)) or 0
        rows = self.db.scalars(
            select(Ticket)
            .options(joinedload(Ticket.reporter), joinedload(Ticket.assignee))
            .where(*filters)
            .order_by(Ticket.created_at.desc(), Ticket.id.desc())
            .offset(offset)
            .limit(limit)
        ).all()
        return list(rows), total

    def get(self, ticket_id: int) -> Ticket | None:
        options = [joinedload(Ticket.reporter), joinedload(Ticket.assignee)]
        return self.db.get(Ticket, ticket_id, options=options)

    def add(self, ticket: Ticket) -> Ticket:
        self.db.add(ticket)
        self.db.flush()
        return ticket

    def delete(self, ticket: Ticket) -> None:
        self.db.delete(ticket)

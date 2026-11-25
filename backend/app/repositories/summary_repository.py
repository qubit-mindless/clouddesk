from datetime import datetime

from sqlalchemy import distinct, func, select
from sqlalchemy.orm import Session

from app.models import AiMessage, AiMessageRole, Ticket, TicketHistory, TicketStatus
from app.models.ticket_history import RESOLUTION_FIELD

OPEN_STATUSES = (TicketStatus.NEW, TicketStatus.ASSIGNED, TicketStatus.IN_PROGRESS)
CLOSED_STATUSES = (TicketStatus.RESOLVED, TicketStatus.CLOSED)


class SummaryRepository:
    """Liczniki do powitania na pulpicie (/api/me/summary). Zakresy czasu [start, end) w UTC."""

    def __init__(self, db: Session) -> None:
        self.db = db

    def open_deadlines(
        self, *, assignee_id: int | None = None, reporter_id: int | None = None
    ) -> list[tuple[datetime, datetime]]:
        """(utworzenie, termin SLA) otwartych zgłoszeń – regułę „zagrożone” liczy serwis."""
        query = select(Ticket.created_at, Ticket.sla_due_at).where(Ticket.status.in_(OPEN_STATUSES))
        if assignee_id is not None:
            query = query.where(Ticket.assignee_id == assignee_id)
        if reporter_id is not None:
            query = query.where(Ticket.reporter_id == reporter_id)
        return [(created, due) for created, due in self.db.execute(query)]

    def created_between(self, start: datetime, end: datetime) -> list[datetime]:
        return list(
            self.db.scalars(
                select(Ticket.created_at).where(Ticket.created_at >= start, Ticket.created_at < end)
            )
        )

    def resolved_between(self, start: datetime, end: datetime) -> list[datetime]:
        return list(
            self.db.scalars(
                select(Ticket.resolved_at).where(
                    Ticket.status.in_(CLOSED_STATUSES), Ticket.resolved_at >= start, Ticket.resolved_at < end
                )
            )
        )

    def ai_answers_between(self, start: datetime, end: datetime) -> tuple[int, int]:
        """(liczba odpowiedzi asystenta, liczba zgłoszeń z co najmniej jedną odpowiedzią)."""
        answers, tickets = self.db.execute(
            select(func.count(), func.count(distinct(AiMessage.ticket_id))).where(*self._answers(start, end))
        ).one()
        return answers or 0, tickets or 0

    def self_resolved_with_ai_between(self, start: datetime, end: datetime, resolution: str) -> int:
        """Zgłoszenia z odpowiedzią asystenta w zakresie, zamknięte w nim przez zgłaszającego (/resolve)."""
        with_answers = select(AiMessage.ticket_id).where(*self._answers(start, end))
        return (
            self.db.scalar(
                select(func.count(distinct(TicketHistory.ticket_id)))
                .select_from(TicketHistory)
                .join(TicketHistory.ticket)
                .where(
                    # Tylko wciąż zamknięte – otwarte ponownie przez technika wraca do „przekazanych”.
                    Ticket.status.in_(CLOSED_STATUSES),
                    TicketHistory.field == RESOLUTION_FIELD,
                    TicketHistory.new_value == resolution,
                    TicketHistory.changed_at >= start,
                    TicketHistory.changed_at < end,
                    TicketHistory.ticket_id.in_(with_answers),
                )
            )
            or 0
        )

    @staticmethod
    def _answers(start: datetime, end: datetime) -> tuple:
        return (
            AiMessage.role == AiMessageRole.ASSISTANT,
            AiMessage.created_at >= start,
            AiMessage.created_at < end,
        )

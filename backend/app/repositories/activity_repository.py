from sqlalchemy import ColumnElement, func, select
from sqlalchemy.orm import Session, contains_eager, joinedload, load_only

from app.models import AiMessage, AiMessageRole, Ticket, TicketHistory


def initial_priority() -> ColumnElement[str]:
    """Wyrażenie SQL: priorytet nadany przy utworzeniu zgłoszenia.

    Stara wartość pierwszej zmiany priorytetu z historii, a gdy zmian nie było – bieżący priorytet.
    Ta sama reguła co `ActivityRepository.initial_priorities` (wersja zbiorcza dla listy zgłoszeń).
    """
    first_change = (
        select(TicketHistory.old_value)
        .where(TicketHistory.ticket_id == Ticket.id, TicketHistory.field == "priority")
        .order_by(TicketHistory.changed_at, TicketHistory.id)
        .limit(1)
        .correlate(Ticket)
        .scalar_subquery()
    )
    return func.coalesce(first_change, Ticket.priority)


class ActivityRepository:
    """Zdarzenia w zgłoszeniach do „Aktywności na żywo”: zmiany z historii, utworzenia i odpowiedzi asystenta.

    Każde zapytanie zwraca najwyżej `limit` najnowszych wierszy jednego źródła; scala je serwis.
    `reporter_id` zawęża do zgłoszeń jednego zgłaszającego (rola REPORTER widzi tylko swoje).
    """

    def __init__(self, db: Session) -> None:
        self.db = db

    def recent_changes(self, *, reporter_id: int | None, limit: int) -> list[TicketHistory]:
        query = (
            select(TicketHistory)
            .join(TicketHistory.ticket)
            .options(
                contains_eager(TicketHistory.ticket).load_only(Ticket.id, Ticket.title, Ticket.reporter_id),
                joinedload(TicketHistory.author),
            )
            .order_by(TicketHistory.changed_at.desc(), TicketHistory.id.desc())
            .limit(limit)
        )
        if reporter_id is not None:
            query = query.where(Ticket.reporter_id == reporter_id)
        return list(self.db.scalars(query))

    def recent_tickets(self, *, reporter_id: int | None, limit: int) -> list[Ticket]:
        # Bez opisu zgłoszenia – nie jest potrzebny, a bywa długi.
        query = (
            select(Ticket)
            .options(
                load_only(Ticket.id, Ticket.title, Ticket.priority, Ticket.created_at, Ticket.reporter_id),
                joinedload(Ticket.reporter),
            )
            .order_by(Ticket.created_at.desc(), Ticket.id.desc())
            .limit(limit)
        )
        if reporter_id is not None:
            query = query.where(Ticket.reporter_id == reporter_id)
        return list(self.db.scalars(query))

    def recent_answers(self, *, reporter_id: int | None, limit: int) -> list[AiMessage]:
        # Treść odpowiedzi nie jest wczytywana – do listy trafia tylko fakt, że asystent odpowiedział.
        query = (
            select(AiMessage)
            .join(AiMessage.ticket)
            .options(
                load_only(AiMessage.id, AiMessage.ticket_id, AiMessage.created_at),
                contains_eager(AiMessage.ticket).load_only(Ticket.id, Ticket.title, Ticket.reporter_id),
            )
            .where(AiMessage.role == AiMessageRole.ASSISTANT)
            .order_by(AiMessage.created_at.desc(), AiMessage.id.desc())
            .limit(limit)
        )
        if reporter_id is not None:
            query = query.where(Ticket.reporter_id == reporter_id)
        return list(self.db.scalars(query))

    def initial_priorities(self, ticket_ids: list[int]) -> dict[int, str]:
        """Priorytet nadany przy utworzeniu = stara wartość pierwszej zmiany priorytetu (jeśli była)."""
        if not ticket_ids:
            return {}
        rows = self.db.execute(
            select(TicketHistory.ticket_id, TicketHistory.old_value)
            .where(TicketHistory.ticket_id.in_(ticket_ids), TicketHistory.field == "priority")
            .order_by(TicketHistory.changed_at, TicketHistory.id)
        )
        first: dict[int, str] = {}
        for ticket_id, old_value in rows:
            if old_value is not None:
                first.setdefault(ticket_id, old_value)
        return first

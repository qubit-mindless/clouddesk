from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.models import TicketHistory


class HistoryRepository:
    """Zapytania o audyt zmian zgłoszeń (`ticket_history`)."""

    def __init__(self, db: Session) -> None:
        self.db = db

    def for_ticket(self, ticket_id: int) -> list[TicketHistory]:
        # Autor dociągany jednym JOIN-em – bez osobnego zapytania na każdy wiersz.
        query = (
            select(TicketHistory)
            .options(joinedload(TicketHistory.author))
            .where(TicketHistory.ticket_id == ticket_id)
            .order_by(TicketHistory.changed_at, TicketHistory.id)
        )
        return list(self.db.scalars(query))

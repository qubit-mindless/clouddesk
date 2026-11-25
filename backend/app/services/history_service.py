from sqlalchemy.orm import Session

from app.core.clock import as_utc
from app.models import User
from app.repositories.history_repository import HistoryRepository
from app.schemas.history import HistoryItem, HistoryPage
from app.services.ticket_service import TicketService, login_of


class HistoryService:
    def __init__(self, db: Session, actor: User) -> None:
        self.tickets = TicketService(db, actor=actor)
        self.history = HistoryRepository(db)

    def for_ticket(self, ticket_id: int) -> HistoryPage:
        # Widoczność jak przy samym zgłoszeniu: cudze dla zgłaszającego → NotFoundError (404).
        ticket = self.tickets.visible(ticket_id)
        items = [
            HistoryItem(
                id=row.id,
                field=row.field,
                old_value=row.old_value,
                new_value=row.new_value,
                author=login_of(row.author),
                author_name=row.author.full_name,
                changed_at=as_utc(row.changed_at),
            )
            for row in self.history.for_ticket(ticket.id)
        ]
        return HistoryPage(items=items)

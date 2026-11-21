from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import AiMessage, AiMessageRole


class AiMessageRepository:
    """Rozmowa z asystentem AI przypięta do zgłoszenia."""

    def __init__(self, db: Session) -> None:
        self.db = db

    def list_for_ticket(self, ticket_id: int) -> list[AiMessage]:
        return list(
            self.db.scalars(
                select(AiMessage)
                .where(AiMessage.ticket_id == ticket_id)
                .order_by(AiMessage.created_at, AiMessage.id)
            )
        )

    def count_answers(self, ticket_id: int) -> int:
        return (
            self.db.scalar(
                select(func.count())
                .select_from(AiMessage)
                .where(AiMessage.ticket_id == ticket_id, AiMessage.role == AiMessageRole.ASSISTANT)
            )
            or 0
        )

    def add(self, message: AiMessage) -> None:
        self.db.add(message)

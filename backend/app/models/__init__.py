# Import wszystkich modeli w jednym miejscu – Alembic (autogenerate) widzi wtedy pełne Base.metadata.
from app.models.ai_message import AiMessage, AiMessageRole
from app.models.attachment import Attachment
from app.models.base import Base
from app.models.comment import Comment
from app.models.ticket import Ticket, TicketPriority, TicketStatus
from app.models.ticket_history import TicketHistory
from app.models.user import User, UserRole

__all__ = [
    "AiMessage",
    "AiMessageRole",
    "Attachment",
    "Base",
    "Comment",
    "Ticket",
    "TicketHistory",
    "TicketPriority",
    "TicketStatus",
    "User",
    "UserRole",
]

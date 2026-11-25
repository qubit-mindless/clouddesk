# Import wszystkich modeli w jednym miejscu – Alembic (autogenerate) widzi wtedy pełne Base.metadata.
from app.models.ai_message import AiMessage, AiMessageRole
from app.models.attachment import Attachment
from app.models.base import Base
from app.models.comment import Comment
from app.models.ticket import CLOSED_STATUSES, OPEN_STATUSES, Ticket, TicketPriority, TicketStatus
from app.models.ticket_history import TicketHistory
from app.models.user import User, UserRole

__all__ = [
    "CLOSED_STATUSES",
    "OPEN_STATUSES",
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

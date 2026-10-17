# Import wszystkich modeli w jednym miejscu – Alembic (autogenerate) widzi wtedy pełne Base.metadata.
from app.models.base import Base
from app.models.ticket import Ticket, TicketPriority, TicketStatus
from app.models.user import User, UserRole

__all__ = ["Base", "Ticket", "TicketPriority", "TicketStatus", "User", "UserRole"]

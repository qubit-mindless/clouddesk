from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base
from app.models.user import User

if TYPE_CHECKING:
    from app.models.ticket import Ticket


class TicketHistory(Base):
    """Audyt zmian zgłoszenia: jedno pole = jeden wiersz (np. status NEW → ASSIGNED)."""

    __tablename__ = "ticket_history"

    id: Mapped[int] = mapped_column(primary_key=True)
    ticket_id: Mapped[int] = mapped_column(ForeignKey("tickets.id", ondelete="CASCADE"), index=True)
    # Autora zmiany nie da się usunąć – audyt musi zostać kompletny.
    changed_by: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    field: Mapped[str] = mapped_column(String(50))
    old_value: Mapped[str | None] = mapped_column(Text)
    new_value: Mapped[str | None] = mapped_column(Text)
    changed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    ticket: Mapped[Ticket] = relationship(back_populates="history")
    author: Mapped[User] = relationship()

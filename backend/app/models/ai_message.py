from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, Enum, ForeignKey, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base

if TYPE_CHECKING:
    from app.models.ticket import Ticket
    from app.models.user import User


class AiMessageRole(StrEnum):
    USER = "user"
    ASSISTANT = "assistant"


class AiMessage(Base):
    """Wiadomość z czatu z asystentem AI – cała rozmowa trafia do technika jako kontekst."""

    __tablename__ = "ai_messages"

    id: Mapped[int] = mapped_column(primary_key=True)
    ticket_id: Mapped[int] = mapped_column(ForeignKey("tickets.id", ondelete="CASCADE"), index=True)
    role: Mapped[AiMessageRole] = mapped_column(
        Enum(
            AiMessageRole,
            name="ai_message_role",
            native_enum=False,
            create_constraint=True,
            length=20,
            values_callable=lambda e: [m.value for m in e],
        )
    )
    # Kto zadał pytanie (rozmowę widzą zgłaszający i technik); NULL dla odpowiedzi asystenta
    # i dla pytań usuniętych użytkowników.
    author_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    content: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    ticket: Mapped[Ticket] = relationship(back_populates="ai_messages")
    author: Mapped[User | None] = relationship()

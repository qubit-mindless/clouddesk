from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, Enum, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base
from app.models.user import User

if TYPE_CHECKING:
    from app.models.ai_message import AiMessage
    from app.models.attachment import Attachment
    from app.models.comment import Comment
    from app.models.ticket_history import TicketHistory


class TicketStatus(StrEnum):
    """Cykl życia incydentu wg ITIL."""

    NEW = "NEW"
    ASSIGNED = "ASSIGNED"
    IN_PROGRESS = "IN_PROGRESS"
    RESOLVED = "RESOLVED"
    CLOSED = "CLOSED"


class TicketPriority(StrEnum):
    P1 = "P1"
    P2 = "P2"
    P3 = "P3"
    P4 = "P4"


class Ticket(Base):
    __tablename__ = "tickets"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text)
    status: Mapped[TicketStatus] = mapped_column(
        Enum(TicketStatus, name="ticket_status", native_enum=False, create_constraint=True, length=20),
        default=TicketStatus.NEW,
        server_default=TicketStatus.NEW.value,
        index=True,
    )
    priority: Mapped[TicketPriority] = mapped_column(
        Enum(TicketPriority, name="ticket_priority", native_enum=False, create_constraint=True, length=2),
        index=True,
    )
    # Zgłaszającego z historią zgłoszeń nie da się usunąć; usunięcie technika zwalnia zgłoszenie.
    reporter_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), index=True)
    assignee_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    sla_due_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    reporter: Mapped[User] = relationship(foreign_keys=[reporter_id])
    assignee: Mapped[User | None] = relationship(foreign_keys=[assignee_id])

    # Dane zależne giną razem ze zgłoszeniem (ON DELETE CASCADE w bazie).
    history: Mapped[list[TicketHistory]] = relationship(
        back_populates="ticket", cascade="all, delete-orphan", passive_deletes=True
    )
    comments: Mapped[list[Comment]] = relationship(
        back_populates="ticket", cascade="all, delete-orphan", passive_deletes=True
    )
    attachments: Mapped[list[Attachment]] = relationship(
        back_populates="ticket", cascade="all, delete-orphan", passive_deletes=True
    )
    ai_messages: Mapped[list[AiMessage]] = relationship(
        back_populates="ticket", cascade="all, delete-orphan", passive_deletes=True
    )

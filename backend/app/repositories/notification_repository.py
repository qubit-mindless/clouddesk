from datetime import datetime

from sqlalchemy import and_, false, or_, select
from sqlalchemy.orm import Session, contains_eager, joinedload, load_only

from app.models import Ticket, TicketHistory, TicketPriority, TicketStatus
from app.repositories.activity_repository import initial_priority

OPEN_STATUSES = (TicketStatus.NEW, TicketStatus.ASSIGNED, TicketStatus.IN_PROGRESS)


class NotificationRepository:
    """Źródła powiadomień (dzwonek) – wyliczane z historii i zgłoszeń, bez osobnej tabeli.

    Każde zapytanie zwraca najwyżej `limit` najnowszych wierszy od chwili `since`; scala je serwis.
    """

    def __init__(self, db: Session) -> None:
        self.db = db

    def changes_for(
        self, *, user_id: int, login: str, include_assigned: bool, since: datetime, limit: int
    ) -> list[TicketHistory]:
        """Cudze zmiany: przypisanie do mnie oraz status i przypisanie technika w moich zgłoszeniach."""
        # include_assigned=False dla zgłaszającego: login w historii przypisań nie odsłoni cudzych zgłoszeń.
        assigned_to_me = (
            and_(TicketHistory.field == "assignee", TicketHistory.new_value == login)
            if include_assigned
            else false()
        )
        in_my_ticket = and_(
            Ticket.reporter_id == user_id,
            or_(
                TicketHistory.field == "status",
                and_(TicketHistory.field == "assignee", TicketHistory.new_value.is_not(None)),
            ),
        )
        return list(
            self.db.scalars(
                select(TicketHistory)
                .join(TicketHistory.ticket)
                .options(
                    contains_eager(TicketHistory.ticket).load_only(
                        Ticket.id, Ticket.title, Ticket.reporter_id
                    ),
                    joinedload(TicketHistory.author),
                )
                .where(
                    TicketHistory.changed_at >= since,
                    # Własnych zmian nie powiadamiamy.
                    TicketHistory.changed_by != user_id,
                    or_(assigned_to_me, in_my_ticket),
                )
                .order_by(TicketHistory.changed_at.desc(), TicketHistory.id.desc())
                .limit(limit)
            )
        )

    def new_p1(self, *, user_id: int, since: datetime, limit: int) -> list[Ticket]:
        return list(
            self.db.scalars(
                select(Ticket)
                .options(
                    load_only(
                        Ticket.id, Ticket.title, Ticket.priority, Ticket.created_at, Ticket.reporter_id
                    ),
                    joinedload(Ticket.reporter),
                )
                .where(
                    # Priorytet z chwili utworzenia – podniesienie do P1 później nie jest „nowym P1”.
                    initial_priority() == TicketPriority.P1.value,
                    Ticket.created_at >= since,
                    # Własne zgłoszenie P1 to własna zmiana.
                    Ticket.reporter_id != user_id,
                )
                .order_by(Ticket.created_at.desc(), Ticket.id.desc())
                .limit(limit)
            )
        )

    def breached(self, *, user_id: int, since: datetime, now: datetime, limit: int) -> list[Ticket]:
        """Otwarte, z terminem SLA między `since` a `now`: przypisane do mnie i wolne (nieprzypisane)."""
        unassigned = Ticket.assignee_id.is_(None)
        return list(
            self.db.scalars(
                select(Ticket)
                .options(load_only(Ticket.id, Ticket.title, Ticket.priority, Ticket.sla_due_at))
                .where(
                    Ticket.status.in_(OPEN_STATUSES),
                    Ticket.sla_due_at >= since,
                    Ticket.sla_due_at <= now,
                    or_(Ticket.assignee_id == user_id, unassigned),
                )
                .order_by(Ticket.sla_due_at.desc(), Ticket.id.desc())
                .limit(limit)
            )
        )

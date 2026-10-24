from datetime import UTC, datetime, timedelta

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models import Ticket, TicketHistory, TicketPriority, TicketStatus, User, UserRole
from app.repositories.ticket_repository import TicketRepository
from app.repositories.user_repository import UserRepository
from app.schemas.ticket import TicketCreate, TicketOut, TicketPage, TicketQuery, TicketUpdate
from app.services.errors import FieldValidationError, NotFoundError

# Czas na rozwiązanie zgłoszenia liczony od jego utworzenia (ten sam w seedzie i w fake API frontendu).
SLA_BY_PRIORITY: dict[TicketPriority, timedelta] = {
    TicketPriority.P1: timedelta(hours=4),
    TicketPriority.P2: timedelta(hours=8),
    TicketPriority.P3: timedelta(days=2),
    TicketPriority.P4: timedelta(days=5),
}
CLOSED_STATUSES = {TicketStatus.RESOLVED, TicketStatus.CLOSED}
ASSIGNABLE_ROLES = {UserRole.TECHNICIAN, UserRole.ADMIN}


def login_of(user: User | None) -> str | None:
    return user.email.split("@", 1)[0] if user else None


def to_dto(ticket: Ticket) -> TicketOut:
    return TicketOut(
        id=ticket.id,
        title=ticket.title,
        description=ticket.description,
        status=ticket.status,
        priority=ticket.priority,
        reporter=login_of(ticket.reporter),
        assignee=login_of(ticket.assignee),
        created_at=ticket.created_at,
        updated_at=ticket.updated_at,
        sla_due_at=ticket.sla_due_at,
        resolved_at=ticket.resolved_at,
    )


class TicketService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.tickets = TicketRepository(db)
        self.users = UserRepository(db)

    def _actor(self) -> User:
        # Do czasu logowania (#14) zgłoszenia i zmiany zapisujemy na konto demonstracyjne.
        email = get_settings().demo_user_email
        return self.users.get_or_create(email, "Użytkownik demonstracyjny", UserRole.REPORTER)

    def _get(self, ticket_id: int) -> Ticket:
        ticket = self.tickets.get(ticket_id)
        if ticket is None:
            raise NotFoundError(f"Nie znaleziono zgłoszenia #{ticket_id}.")
        return ticket

    def list(self, query: TicketQuery) -> TicketPage:
        assignee_id = None
        if query.assignee:
            assignee = self.users.get_by_login(query.assignee)
            if assignee is None:
                return TicketPage(items=[], total=0, page=query.page, size=query.size)
            assignee_id = assignee.id
        items, total = self.tickets.list(
            status=query.status,
            priority=query.priority,
            assignee_id=assignee_id,
            q=query.q.strip() if query.q else None,
            offset=(query.page - 1) * query.size,
            limit=query.size,
        )
        return TicketPage(items=[to_dto(t) for t in items], total=total, page=query.page, size=query.size)

    def get(self, ticket_id: int) -> TicketOut:
        return to_dto(self._get(ticket_id))

    def create(self, data: TicketCreate) -> TicketOut:
        now = datetime.now(UTC)
        ticket = Ticket(
            title=data.title,
            description=data.description,
            priority=data.priority,
            status=TicketStatus.NEW,
            reporter=self._actor(),
            created_at=now,
            updated_at=now,
            sla_due_at=now + SLA_BY_PRIORITY[data.priority],
        )
        self.tickets.add(ticket)
        self.db.commit()
        return to_dto(self._get(ticket.id))

    def update(self, ticket_id: int, data: TicketUpdate) -> TicketOut:
        ticket = self._get(ticket_id)
        changes = data.model_dump(exclude_unset=True)
        for field in ("title", "description", "priority", "status"):
            if field in changes and changes[field] is None:
                raise FieldValidationError(field, "Pole nie może być puste.")

        actor = self._actor()
        history: list[TicketHistory] = []

        def record(field: str, old: object, new: object) -> None:
            if old != new:
                history.append(
                    TicketHistory(
                        author=actor,
                        field=field,
                        old_value=None if old is None else str(old),
                        new_value=None if new is None else str(new),
                    )
                )

        if "assignee" in changes:
            new_assignee = None
            if changes["assignee"] is not None:
                new_assignee = self.users.get_by_login(changes["assignee"])
                if new_assignee is None:
                    raise FieldValidationError("assignee", f"Nie ma użytkownika „{changes['assignee']}”.")
                if new_assignee.role not in ASSIGNABLE_ROLES:
                    raise FieldValidationError("assignee", "Zgłoszenie można przypisać tylko technikowi.")
            record("assignee", login_of(ticket.assignee), login_of(new_assignee))
            ticket.assignee = new_assignee

        for field in ("title", "description"):
            if field in changes:
                record(field, getattr(ticket, field), changes[field])
                setattr(ticket, field, changes[field])

        if "priority" in changes and changes["priority"] != ticket.priority:
            record("priority", ticket.priority.value, changes["priority"].value)
            ticket.priority = changes["priority"]
            # Nowy priorytet = nowy termin SLA liczony od utworzenia zgłoszenia.
            ticket.sla_due_at = ticket.created_at + SLA_BY_PRIORITY[ticket.priority]

        if "status" in changes and changes["status"] != ticket.status:
            new_status = changes["status"]
            record("status", ticket.status.value, new_status.value)
            if new_status in CLOSED_STATUSES and ticket.resolved_at is None:
                ticket.resolved_at = datetime.now(UTC)
            elif new_status not in CLOSED_STATUSES:
                ticket.resolved_at = None
            ticket.status = new_status

        if history:
            ticket.history.extend(history)
            ticket.updated_at = datetime.now(UTC)
        self.db.commit()
        return to_dto(self._get(ticket.id))

    def delete(self, ticket_id: int) -> None:
        self.tickets.delete(self._get(ticket_id))
        self.db.commit()

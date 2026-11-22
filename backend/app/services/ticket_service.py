from datetime import UTC, datetime, timedelta

from sqlalchemy.orm import Session

from app.models import Ticket, TicketHistory, TicketPriority, TicketStatus, User, UserRole
from app.repositories.ticket_repository import TicketRepository
from app.repositories.user_repository import UserRepository
from app.schemas.ticket import TicketCreate, TicketOut, TicketPage, TicketQuery, TicketUpdate
from app.services.errors import ConflictError, FieldValidationError, ForbiddenError, NotFoundError

# Czas na rozwiązanie zgłoszenia liczony od jego utworzenia (ten sam w seedzie i w fake API frontendu).
SLA_BY_PRIORITY: dict[TicketPriority, timedelta] = {
    TicketPriority.P1: timedelta(hours=4),
    TicketPriority.P2: timedelta(hours=8),
    TicketPriority.P3: timedelta(days=2),
    TicketPriority.P4: timedelta(days=5),
}
CLOSED_STATUSES = {TicketStatus.RESOLVED, TicketStatus.CLOSED}
ASSIGNABLE_ROLES = {UserRole.TECHNICIAN, UserRole.ADMIN}
# Obsługa zgłoszeń (wszystkie zgłoszenia, status, przypisanie, usuwanie) – technik i administrator.
STAFF_ROLES = {UserRole.TECHNICIAN, UserRole.ADMIN}
# Zgłaszający może poprawić treść i priorytet własnego zgłoszenia, ale nie prowadzi go dalej.
REPORTER_EDITABLE = {"title", "description", "priority"}
# Wiersz historii „sposób rozwiązania”: SELF_AI = zgłaszający zamknął zgłoszenie po pomocy asystenta AI.
RESOLUTION_FIELD = "resolution"
RESOLUTION_SELF_AI = "SELF_AI"


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
    def __init__(self, db: Session, actor: User) -> None:
        self.db = db
        self.actor = actor
        self.tickets = TicketRepository(db)
        self.users = UserRepository(db)

    @property
    def _is_staff(self) -> bool:
        return self.actor.role in STAFF_ROLES

    def _get(self, ticket_id: int) -> Ticket:
        ticket = self.tickets.get(ticket_id)
        # Cudze zgłoszenie dla zgłaszającego wygląda jak nieistniejące – nie zdradzamy, że jest.
        if ticket is None or (not self._is_staff and ticket.reporter_id != self.actor.id):
            raise NotFoundError(f"Nie znaleziono zgłoszenia #{ticket_id}.")
        return ticket

    def visible(self, ticket_id: int) -> Ticket:
        """Zgłoszenie, jeśli użytkownik może je oglądać – ta sama reguła dla innych serwisów (asystent)."""
        return self._get(ticket_id)

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
            reporter_id=None if self._is_staff else self.actor.id,
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
            reporter=self.actor,
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
        if not self._is_staff:
            if not changes.keys() <= REPORTER_EDITABLE:
                raise ForbiddenError("Status i przypisanie zgłoszenia zmienia technik.")
            if ticket.status in CLOSED_STATUSES:
                # Inaczej zmiana priorytetu przeliczyłaby SLA zgłoszenia, które już rozliczono.
                raise ForbiddenError("Rozwiązanego lub zamkniętego zgłoszenia nie można już zmieniać.")
        for field in ("title", "description", "priority", "status"):
            if field in changes and changes[field] is None:
                raise FieldValidationError(field, "Pole nie może być puste.")

        actor = self.actor
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

    def resolve(self, ticket_id: int) -> TicketOut:
        """„Pomogło – zamknij”: zgłaszający sam zamyka własne zgłoszenie po pomocy asystenta AI."""
        # Blokada wiersza (PostgreSQL: FOR UPDATE) – dwa równoległe kliknięcia nie zapiszą historii dwa razy;
        # zablokowany obiekt trafia do mapy tożsamości, więc _get poniżej zwraca ten sam, świeży stan.
        self.tickets.lock(ticket_id)
        ticket = self._get(ticket_id)
        if self._is_staff:
            raise ForbiddenError("Technik i administrator zmieniają status zgłoszenia przez edycję statusu.")
        if ticket.status in CLOSED_STATUSES:
            raise ConflictError("Zgłoszenie jest już rozwiązane lub zamknięte.")

        now = datetime.now(UTC)
        ticket.history.extend(
            [
                TicketHistory(
                    author=self.actor,
                    field="status",
                    old_value=ticket.status.value,
                    new_value=TicketStatus.RESOLVED.value,
                    changed_at=now,
                ),
                # Osobny wiersz pozwala policzyć zgłoszenia rozwiązane bez technika (/api/me/summary).
                TicketHistory(
                    author=self.actor,
                    field=RESOLUTION_FIELD,
                    old_value=None,
                    new_value=RESOLUTION_SELF_AI,
                    changed_at=now,
                ),
            ]
        )
        ticket.status = TicketStatus.RESOLVED
        ticket.resolved_at = now
        ticket.updated_at = now
        self.db.commit()
        return to_dto(self._get(ticket.id))

    def delete(self, ticket_id: int) -> None:
        ticket = self._get(ticket_id)
        if not self._is_staff:
            raise ForbiddenError("Zgłoszenie może usunąć tylko technik lub administrator.")
        self.tickets.delete(ticket)
        self.db.commit()

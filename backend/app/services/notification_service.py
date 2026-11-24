from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from app.core import clock
from app.models import TicketPriority, User
from app.repositories.notification_repository import NotificationRepository
from app.schemas.notification import NotificationItem, NotificationList
from app.services.ticket_service import STAFF_ROLES, login_of

NOTIFICATION_WINDOW = timedelta(days=7)
NOTIFICATION_LIMIT = 20


def _sort_key(item: NotificationItem) -> tuple[datetime, int]:
    return item.at, int(item.id.rsplit("-", 1)[1])


class NotificationService:
    def __init__(self, db: Session, actor: User) -> None:
        self.db = db
        self.actor = actor
        self.sources = NotificationRepository(db)

    def list(self) -> NotificationList:
        now = clock.utc_now()
        since = now - NOTIFICATION_WINDOW
        me = self.actor
        my_login = login_of(me) or ""
        is_staff = me.role in STAFF_ROLES
        items: list[NotificationItem] = []

        def add(**fields) -> None:
            items.append(NotificationItem(unread=False, **fields))

        # Zgłaszający dostaje tylko status i taken ze swoich zgłoszeń – bez assigned, new_p1 i sla_breached.
        for row in self.sources.changes_for(
            user_id=me.id, login=my_login, include_assigned=is_staff, since=since, limit=NOTIFICATION_LIMIT
        ):
            # Jedna zmiana = jedno powiadomienie: przypisanie mnie do mojego zgłoszenia → assigned, nie taken.
            if is_staff and row.field == "assignee" and row.new_value == my_login:
                kind = "assigned"
            elif row.field == "assignee":
                kind = "taken"
            else:
                kind = "status"
            add(
                id=f"n-h-{row.id}",
                kind=kind,
                ticket_id=row.ticket_id,
                ticket_title=row.ticket.title,
                actor_name=row.author.full_name,
                value=row.new_value,
                at=clock.as_utc(row.changed_at),
            )

        if is_staff:
            for ticket in self.sources.new_p1(user_id=me.id, since=since, limit=NOTIFICATION_LIMIT):
                add(
                    id=f"n-t-{ticket.id}",
                    kind="new_p1",
                    ticket_id=ticket.id,
                    ticket_title=ticket.title,
                    actor_name=ticket.reporter.full_name,
                    value=TicketPriority.P1.value,
                    at=clock.as_utc(ticket.created_at),
                )

            for ticket in self.sources.breached(
                user_id=me.id, include_unassigned=True, since=since, now=now, limit=NOTIFICATION_LIMIT
            ):
                add(
                    id=f"n-sla-{ticket.id}",
                    kind="sla_breached",
                    ticket_id=ticket.id,
                    ticket_title=ticket.title,
                    actor_name=None,
                    value=ticket.priority.value,
                    at=clock.as_utc(ticket.sla_due_at),
                )

        newest = sorted(items, key=_sort_key, reverse=True)[:NOTIFICATION_LIMIT]
        # Przeczytane = nie nowsze niż znacznik z „oznacz jako przeczytane”; NULL = nic nie przeczytano.
        # Ostro większe: pozycja z at == until (najnowsza pokazana klientowi) jest już przeczytana.
        seen = clock.as_utc(me.notifications_seen_at) if me.notifications_seen_at else None
        for item in newest:
            item.unread = seen is None or item.at > seen
        return NotificationList(unread=sum(item.unread for item in newest), items=newest)

    def mark_read(self, until: datetime | None = None) -> None:
        """Przeczytane do chwili `until` (at najnowszego powiadomienia pokazanego w UI), najpóźniej do teraz.

        Z `until` powiadomienie, które powstało między pobraniem listy a kliknięciem, zostaje nieprzeczytane.
        Znacznik nie cofa się – starsze `until` (np. z nieodświeżonej karty) niczego nie zmienia.
        """
        now = clock.utc_now()
        seen = now if until is None else min(clock.as_utc(until), now)
        current = self.actor.notifications_seen_at
        if current is None or seen > clock.as_utc(current):
            self.actor.notifications_seen_at = seen
            self.db.commit()

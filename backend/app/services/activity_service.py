from datetime import datetime

from sqlalchemy.orm import Session

from app.core.clock import as_utc
from app.models import User
from app.repositories.activity_repository import ActivityRepository
from app.schemas.activity import ActivityItem, ActivityPage
from app.services.ticket_service import STAFF_ROLES, login_of

ASSISTANT_NAME = "Asystent AI"
# Pola historii z treścią wpisaną przez użytkownika – w aktywności pokazujemy tylko fakt zmiany.
CONTENT_FIELDS = {"description"}
# Kolejność zdarzeń z tą samą chwilą: zmiany po utworzeniu zgłoszenia, odpowiedź asystenta po zmianach.
_KIND_ORDER = {"created": 0, "change": 1, "ai": 2}


def _sort_key(item: ActivityItem) -> tuple[datetime, int, int]:
    # id = "<prefiks>-<id wiersza>"; liczbowo, bo przy porównaniu tekstów „h-9” wypadłoby po „h-10”.
    return item.at, _KIND_ORDER[item.kind], int(item.id.rsplit("-", 1)[1])


class ActivityService:
    def __init__(self, db: Session, actor: User) -> None:
        self.db = db
        self.actor = actor
        self.events = ActivityRepository(db)

    @property
    def _reporter_scope(self) -> int | None:
        # Widoczność jak na liście zgłoszeń: zgłaszający – tylko swoje, technik i administrator – wszystkie.
        return None if self.actor.role in STAFF_ROLES else self.actor.id

    def activity(self, limit: int) -> ActivityPage:
        scope = self._reporter_scope
        items: list[ActivityItem] = []

        for row in self.events.recent_changes(reporter_id=scope, limit=limit):
            hidden = row.field in CONTENT_FIELDS
            items.append(
                ActivityItem(
                    id=f"h-{row.id}",
                    kind="change",
                    ticket_id=row.ticket_id,
                    ticket_title=row.ticket.title,
                    actor=login_of(row.author),
                    actor_name=row.author.full_name,
                    field=row.field,
                    old_value=None if hidden else row.old_value,
                    new_value=None if hidden else row.new_value,
                    at=as_utc(row.changed_at),
                )
            )

        tickets = self.events.recent_tickets(reporter_id=scope, limit=limit)
        initial = self.events.initial_priorities([t.id for t in tickets])
        for ticket in tickets:
            items.append(
                ActivityItem(
                    id=f"t-{ticket.id}",
                    kind="created",
                    ticket_id=ticket.id,
                    ticket_title=ticket.title,
                    actor=login_of(ticket.reporter),
                    actor_name=ticket.reporter.full_name,
                    field="priority",
                    old_value=None,
                    new_value=initial.get(ticket.id, ticket.priority.value),
                    at=as_utc(ticket.created_at),
                )
            )

        for message in self.events.recent_answers(reporter_id=scope, limit=limit):
            items.append(
                ActivityItem(
                    id=f"a-{message.id}",
                    kind="ai",
                    ticket_id=message.ticket_id,
                    ticket_title=message.ticket.title,
                    actor=None,
                    actor_name=ASSISTANT_NAME,
                    field=None,
                    old_value=None,
                    new_value=None,
                    at=as_utc(message.created_at),
                )
            )

        # Sort: czas malejąco, przy równym czasie rodzaj zdarzenia i id wiersza malejąco (stała kolejność).
        items.sort(key=_sort_key, reverse=True)
        return ActivityPage(items=items[:limit])

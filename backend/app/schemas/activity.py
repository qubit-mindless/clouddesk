from datetime import datetime
from typing import Literal

from app.schemas.base import CamelModel

ACTIVITY_DEFAULT_LIMIT = 20
ACTIVITY_MAX_LIMIT = 50


class ActivityItem(CamelModel):
    """Zdarzenie w „Aktywności na żywo”. Bez treści opisu i wiadomości AI – tylko tytuł zgłoszenia."""

    # Unikalne w obrębie listy: h-<id historii>, t-<id zgłoszenia>, a-<id wiadomości AI>.
    id: str
    kind: Literal["change", "created", "ai"]
    ticket_id: int
    ticket_title: str
    # Login autora; None dla odpowiedzi asystenta.
    actor: str | None
    actor_name: str | None
    field: str | None
    old_value: str | None
    new_value: str | None
    at: datetime


class ActivityPage(CamelModel):
    items: list[ActivityItem]

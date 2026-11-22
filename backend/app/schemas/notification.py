from datetime import datetime
from typing import Literal

from pydantic import ConfigDict

from app.schemas.ticket import CamelModel

NotificationKind = Literal["assigned", "new_p1", "sla_breached", "status", "taken"]


class NotificationItem(CamelModel):
    # Unikalne w obrębie listy: n-h-<id historii>, n-t-<id zgłoszenia> (nowe P1), n-sla-<id zgłoszenia>.
    id: str
    kind: NotificationKind
    ticket_id: int
    ticket_title: str
    # Kto wykonał zmianę (imię i nazwisko); None dla przekroczonego terminu SLA.
    actor_name: str | None
    # assigned/taken – login technika, status – nowy status, new_p1/sla_breached – priorytet.
    value: str | None
    at: datetime
    unread: bool


class NotificationList(CamelModel):
    # Nieprzeczytane wśród zwróconych pozycji.
    unread: int
    items: list[NotificationItem]


class NotificationsReadRequest(CamelModel):
    """Ciało POST /api/notifications/read – puste ({})."""

    model_config = ConfigDict(extra="forbid")

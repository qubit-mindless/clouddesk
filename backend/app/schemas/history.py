from datetime import datetime

from app.schemas.base import CamelModel


class HistoryItem(CamelModel):
    """Jedna zmiana jednego pola zgłoszenia (wiersz `ticket_history`)."""

    id: int
    # status, priority, assignee, title, description albo resolution (SELF_AI – zamknął zgłaszający).
    field: str
    # Wartości jak w bazie: kody statusu i priorytetu, login technika; None = brak wartości.
    old_value: str | None
    new_value: str | None
    author: str
    author_name: str
    changed_at: datetime


class HistoryPage(CamelModel):
    items: list[HistoryItem]

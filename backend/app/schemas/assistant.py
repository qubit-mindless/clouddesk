from datetime import datetime
from typing import Annotated, Literal

from pydantic import ConfigDict, StringConstraints

from app.models import AiMessageRole
from app.schemas.base import CamelModel
from app.schemas.validators import StorableText

MAX_MESSAGE_LENGTH = 1000
# StorableText: znak NUL lub surogat → 422 jeszcze przed (płatnym) wywołaniem AI, a nie 500 przy zapisie.
Question = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=MAX_MESSAGE_LENGTH), StorableText
]


class AssistantAsk(CamelModel):
    """Puste ciało ({}) = prośba o pierwszą propozycję rozwiązania na podstawie zgłoszenia."""

    model_config = ConfigDict(extra="forbid")

    message: Question | None = None


class AssistantMessageOut(CamelModel):
    id: int
    role: AiMessageRole
    # Login autora pytania; None dla odpowiedzi asystenta.
    author: str | None
    content: str
    created_at: datetime


class AssistantConversation(CamelModel):
    items: list[AssistantMessageOut]
    enabled: bool
    remaining: int
    # Pytać może tylko osoba zgłaszająca, dopóki zgłoszenie nie jest rozwiązane. Technik i administrator
    # widzą rozmowę do odczytu (not_reporter); po rozwiązaniu zgłoszenia jest zamknięta (resolved).
    can_ask: bool
    read_only_reason: Literal["not_reporter", "resolved"] | None

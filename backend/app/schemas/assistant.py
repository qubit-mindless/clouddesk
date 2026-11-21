from datetime import datetime
from typing import Annotated

from pydantic import ConfigDict, StringConstraints

from app.models import AiMessageRole
from app.schemas.ticket import CamelModel

MAX_MESSAGE_LENGTH = 1000
Question = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=MAX_MESSAGE_LENGTH)
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

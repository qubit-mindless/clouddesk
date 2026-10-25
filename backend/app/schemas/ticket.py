from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints
from pydantic.alias_generators import to_camel

from app.models import TicketPriority, TicketStatus

Title = Annotated[str, StringConstraints(strip_whitespace=True, min_length=5, max_length=200)]
Description = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=5000)]
Login = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]


class CamelModel(BaseModel):
    """JSON w camelCase (createdAt, slaDueAt) – tak jak oczekuje frontend; w Pythonie snake_case."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, from_attributes=True)


class TicketCreate(CamelModel):
    model_config = ConfigDict(extra="forbid")

    title: Title
    description: Description
    priority: TicketPriority


class TicketUpdate(CamelModel):
    """Częściowa zmiana: liczą się tylko pola obecne w żądaniu. `assignee: null` zwalnia zgłoszenie."""

    model_config = ConfigDict(extra="forbid")

    title: Title | None = None
    description: Description | None = None
    priority: TicketPriority | None = None
    status: TicketStatus | None = None
    assignee: Login | None = None


class TicketOut(CamelModel):
    id: int
    title: str
    description: str
    status: TicketStatus
    priority: TicketPriority
    reporter: str
    assignee: str | None
    created_at: datetime
    updated_at: datetime
    sla_due_at: datetime
    resolved_at: datetime | None


class TicketPage(CamelModel):
    items: list[TicketOut]
    total: int
    page: int
    size: int


class TicketQuery(BaseModel):
    status: TicketStatus | None = None
    priority: TicketPriority | None = None
    assignee: Login | None = None
    q: str | None = Field(default=None, max_length=200)
    page: int = Field(default=1, ge=1)
    size: int = Field(default=50, ge=1, le=100)

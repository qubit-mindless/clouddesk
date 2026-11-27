"""DTO panelu administratora: lista, tworzenie i zmiana kont, reset hasła."""

import re
from datetime import datetime
from typing import Annotated

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StringConstraints, model_validator

from app.models import UserRole
from app.schemas.auth import Email
from app.schemas.base import CamelModel
from app.schemas.validators import StorableText

# Prosty format x@y.z: bez spacji, jedna „@”, kropka w domenie. Pełną poprawność sprawdza dopiero poczta.
_EMAIL_FORMAT = re.compile(r"[^@\s]+@[^@\s]+\.[^@\s]+")


def email_format(value: str) -> str:
    if not _EMAIL_FORMAT.fullmatch(value):
        raise ValueError("Nieprawidłowy adres e-mail (oczekiwany format: nazwa@domena.pl).")
    return value


NewEmail = Annotated[Email, AfterValidator(email_format)]
FullName = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=2, max_length=200), StorableText
]


class UserAdmin(CamelModel):
    """Konto w panelu administratora – bez skrótu hasła."""

    id: int
    email: str
    login: str
    full_name: str
    role: UserRole
    is_active: bool
    created_at: datetime


class UserPage(CamelModel):
    items: list[UserAdmin]
    total: int
    page: int
    size: int


class UserQuery(BaseModel):
    # Fragment e-maila albo imienia i nazwiska, bez rozróżniania wielkości liter.
    q: Annotated[str, StringConstraints(strip_whitespace=True, max_length=200), StorableText] | None = None
    role: UserRole | None = None
    page: int = Field(default=1, ge=1)
    size: int = Field(default=50, ge=1, le=100)


class UserCreate(CamelModel):
    model_config = ConfigDict(extra="forbid")

    email: NewEmail
    full_name: FullName
    role: UserRole


class UserCreated(CamelModel):
    """Hasło tymczasowe jest tylko w tej odpowiedzi – w bazie zostaje wyłącznie jego skrót."""

    user: UserAdmin
    temporary_password: str


class UserUpdate(CamelModel):
    """Częściowa zmiana: liczą się tylko pola obecne w żądaniu; puste ciało i `null` → 422."""

    model_config = ConfigDict(extra="forbid")

    full_name: FullName | None = None
    role: UserRole | None = None
    is_active: bool | None = None

    @model_validator(mode="after")
    def at_least_one_value(self) -> "UserUpdate":
        if not self.model_fields_set:
            raise ValueError("Podaj co najmniej jedno pole do zmiany: fullName, role albo isActive.")
        if any(getattr(self, name) is None for name in self.model_fields_set):
            raise ValueError("Pola fullName, role i isActive nie mogą mieć wartości null.")
        return self


class PasswordResetRequest(CamelModel):
    """Ciało POST /api/users/{id}/reset-password – puste ({}) albo brak; inne pola to błąd 422."""

    model_config = ConfigDict(extra="forbid")


class PasswordReset(CamelModel):
    temporary_password: str

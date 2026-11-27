from typing import Annotated

from pydantic import AfterValidator, ConfigDict, StringConstraints

from app.models import UserRole
from app.schemas.base import CamelModel
from app.schemas.validators import StorableText

Email = Annotated[
    str, StringConstraints(strip_whitespace=True, to_lower=True, min_length=3, max_length=255), StorableText
]
# Górny limit chroni przed bardzo długimi hasłami wysyłanymi tylko po to, żeby obciążyć argon2.
Password = Annotated[str, StringConstraints(min_length=1, max_length=128), StorableText]
NEW_PASSWORD_MIN_LENGTH = 12
NEW_PASSWORD_MAX_LENGTH = 128


def new_password_length(value: str) -> str:
    # Długość w znakach (nie bajtach); własny komunikat, bo frontend pokazuje `msg` przy polu formularza.
    if not NEW_PASSWORD_MIN_LENGTH <= len(value) <= NEW_PASSWORD_MAX_LENGTH:
        raise ValueError(
            f"Nowe hasło musi mieć od {NEW_PASSWORD_MIN_LENGTH} do {NEW_PASSWORD_MAX_LENGTH} znaków."
        )
    return value


NewPassword = Annotated[str, AfterValidator(new_password_length), StorableText]


class LoginRequest(CamelModel):
    email: Email
    password: Password


class UserOut(CamelModel):
    id: int
    email: str
    login: str
    full_name: str
    role: UserRole


class TokenOut(CamelModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    user: UserOut


class PasswordChange(CamelModel):
    """Ciało POST /api/auth/password – zmiana własnego hasła przez zalogowanego użytkownika."""

    model_config = ConfigDict(extra="forbid")

    current_password: Password
    new_password: NewPassword

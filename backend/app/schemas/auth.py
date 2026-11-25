from typing import Annotated

from pydantic import StringConstraints

from app.models import UserRole
from app.schemas.base import CamelModel

Email = Annotated[str, StringConstraints(strip_whitespace=True, to_lower=True, min_length=3, max_length=255)]
# Górny limit chroni przed bardzo długimi hasłami wysyłanymi tylko po to, żeby obciążyć argon2.
Password = Annotated[str, StringConstraints(min_length=1, max_length=128)]


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

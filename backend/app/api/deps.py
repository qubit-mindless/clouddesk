"""Zależności FastAPI wspólne dla tras: zalogowany użytkownik z tokenu Bearer."""

from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.security import decode_access_token
from app.db.session import get_db
from app.models import User
from app.repositories.user_repository import UserRepository

_bearer = HTTPBearer(auto_error=False, description="Token z POST /api/auth/login")


def _unauthorized(message: str) -> HTTPException:
    return HTTPException(status.HTTP_401_UNAUTHORIZED, message, headers={"WWW-Authenticate": "Bearer"})


def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
    db: Annotated[Session, Depends(get_db)],
) -> User:
    if credentials is None:
        raise _unauthorized("Wymagane logowanie.")
    user_id = decode_access_token(credentials.credentials)
    # Użytkownika czytamy z bazy przy każdym żądaniu: usunięte lub zablokowane konto albo zmiana roli
    # działa od razu, a nie dopiero po wygaśnięciu tokenu.
    user = UserRepository(db).get(user_id) if user_id is not None else None
    if user is None or not user.is_active:
        raise _unauthorized("Sesja wygasła albo token jest nieprawidłowy. Zaloguj się ponownie.")
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]

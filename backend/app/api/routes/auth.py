from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import CurrentUser
from app.db.session import get_db
from app.schemas.auth import LoginRequest, TokenOut, UserOut
from app.services.auth_service import AuthService, user_dto

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post(
    "/login",
    response_model=TokenOut,
    responses={401: {"description": "Nieprawidłowy e-mail lub hasło"}},
)
def login(data: LoginRequest, db: Annotated[Session, Depends(get_db)]) -> TokenOut:
    result = AuthService(db).login(data.email, data.password)
    if result is None:
        # Jeden komunikat dla nieznanego e-maila i złego hasła – nie zdradzamy, które konta istnieją.
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            "Nieprawidłowy e-mail lub hasło.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return result


@router.get("/me", response_model=UserOut, responses={401: {"description": "Brak lub nieważny token"}})
def me(user: CurrentUser) -> UserOut:
    return user_dto(user)

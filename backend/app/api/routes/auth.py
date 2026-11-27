from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from app.api.deps import CurrentUser
from app.db.session import get_db
from app.schemas.auth import LoginRequest, PasswordChange, TokenOut, UserOut
from app.services.auth_service import AuthService, user_dto
from app.services.errors import FieldValidationError, ForbiddenError

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post(
    "/login",
    response_model=TokenOut,
    responses={
        401: {"description": "Nieprawidłowy e-mail lub hasło"},
        403: {"description": "Konto zablokowane przez administratora (tylko przy poprawnym haśle)"},
    },
)
def login(data: LoginRequest, db: Annotated[Session, Depends(get_db)]) -> TokenOut:
    try:
        result = AuthService(db).login(data.email, data.password)
    except ForbiddenError as exc:
        raise HTTPException(status.HTTP_403_FORBIDDEN, str(exc)) from exc
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


@router.post(
    "/password",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={
        401: {"description": "Brak lub nieważny token"},
        422: {"description": "Złe obecne hasło albo nowe hasło niezgodne z zasadami"},
    },
)
def change_password(
    data: PasswordChange, user: CurrentUser, db: Annotated[Session, Depends(get_db)]
) -> Response:
    """Zmiana własnego hasła (każda rola). Już wydane tokeny działają do wygaśnięcia."""
    try:
        AuthService(db).change_password(user, data.current_password, data.new_password)
    except FieldValidationError as exc:
        # Ten sam kształt co walidacja Pydantic, żeby frontend pokazał błąd przy polu formularza.
        detail = [{"loc": ["body", exc.field], "msg": exc.message, "type": "value_error"}]
        raise HTTPException(422, detail) from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.api.deps import CurrentUser
from app.db.session import get_db
from app.schemas.user import (
    PasswordReset,
    PasswordResetRequest,
    UserAdmin,
    UserCreate,
    UserCreated,
    UserPage,
    UserQuery,
    UserUpdate,
)
from app.services.errors import ConflictError, ForbiddenError, NotFoundError
from app.services.user_service import UserService

NOT_FOUND = {404: {"description": "Konto nie istnieje"}}

router = APIRouter(
    prefix="/api/users",
    tags=["users"],
    responses={
        401: {"description": "Brak lub nieważny token"},
        403: {"description": "Panel kont tylko dla administratora"},
    },
)


def _translate(exc: Exception) -> HTTPException:
    if isinstance(exc, NotFoundError):
        return HTTPException(status.HTTP_404_NOT_FOUND, str(exc))
    if isinstance(exc, ForbiddenError):
        return HTTPException(status.HTTP_403_FORBIDDEN, str(exc))
    if isinstance(exc, ConflictError):
        return HTTPException(status.HTTP_409_CONFLICT, str(exc))
    raise exc


def get_service(db: Annotated[Session, Depends(get_db)], user: CurrentUser) -> UserService:
    service = UserService(db, actor=user)
    # Rola sprawdzana już tutaj: technik i zgłaszający dostają 403 jeszcze przed walidacją ciała (422).
    try:
        service.require_admin()
    except ForbiddenError as exc:
        raise _translate(exc) from exc
    return service


Service = Annotated[UserService, Depends(get_service)]


@router.get("", response_model=UserPage)
def list_users(service: Service, query: Annotated[UserQuery, Query()]) -> UserPage:
    """Konta: filtr `q` (fragment e-maila lub imienia i nazwiska) i `role`, sort po imieniu i nazwisku."""
    return service.list(query)


@router.post(
    "",
    response_model=UserCreated,
    status_code=status.HTTP_201_CREATED,
    responses={409: {"description": "Konto z tym adresem (albo loginem) już istnieje"}},
)
def create_user(data: UserCreate, service: Service) -> UserCreated:
    """Nowe konto z hasłem tymczasowym – hasło jest tylko w tej odpowiedzi."""
    try:
        return service.create(data)
    except ConflictError as exc:
        raise _translate(exc) from exc


@router.patch(
    "/{user_id}",
    response_model=UserAdmin,
    responses={
        **NOT_FOUND,
        409: {"description": "Własna rola lub blokada własnego konta albo ostatni aktywny administrator"},
    },
)
def update_user(user_id: int, data: UserUpdate, service: Service) -> UserAdmin:
    try:
        return service.update(user_id, data)
    except (NotFoundError, ConflictError) as exc:
        raise _translate(exc) from exc


@router.post("/{user_id}/reset-password", response_model=PasswordReset, responses=NOT_FOUND)
def reset_password(user_id: int, service: Service, data: PasswordResetRequest | None = None) -> PasswordReset:
    """Nowe hasło tymczasowe (poprzednie przestaje działać); ciało `{}` albo brak."""
    try:
        return service.reset_password(user_id)
    except NotFoundError as exc:
        raise _translate(exc) from exc

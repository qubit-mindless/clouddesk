from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session

from app.api.deps import CurrentUser
from app.db.session import get_db
from app.schemas.ticket import (
    ResolveRequest,
    TicketCreate,
    TicketOut,
    TicketPage,
    TicketQuery,
    TicketUpdate,
)
from app.services.errors import ConflictError, FieldValidationError, ForbiddenError, NotFoundError
from app.services.ticket_service import TicketService

UNAUTHORIZED = {401: {"description": "Brak lub nieważny token"}}
NOT_FOUND = {404: {"description": "Zgłoszenie nie istnieje albo nie jest widoczne dla użytkownika"}}
FORBIDDEN = {403: {"description": "Rola użytkownika nie pozwala na tę operację"}}
ALREADY_RESOLVED = {409: {"description": "Zgłoszenie jest już rozwiązane lub zamknięte"}}

router = APIRouter(prefix="/api/tickets", tags=["tickets"], responses=UNAUTHORIZED)


def get_service(db: Annotated[Session, Depends(get_db)], user: CurrentUser) -> TicketService:
    return TicketService(db, actor=user)


Service = Annotated[TicketService, Depends(get_service)]


def _translate(exc: Exception) -> HTTPException:
    if isinstance(exc, NotFoundError):
        return HTTPException(status.HTTP_404_NOT_FOUND, str(exc))
    if isinstance(exc, ForbiddenError):
        return HTTPException(status.HTTP_403_FORBIDDEN, str(exc))
    if isinstance(exc, ConflictError):
        return HTTPException(status.HTTP_409_CONFLICT, str(exc))
    if isinstance(exc, FieldValidationError):
        # Ten sam kształt co walidacja Pydantic, żeby frontend pokazał błąd przy polu formularza.
        detail = [{"loc": ["body", exc.field], "msg": exc.message, "type": "value_error"}]
        return HTTPException(422, detail)
    raise exc


@router.get("", response_model=TicketPage, response_model_by_alias=True)
def list_tickets(service: Service, query: Annotated[TicketQuery, Query()]) -> TicketPage:
    return service.list(query)


@router.get("/{ticket_id}", response_model=TicketOut, responses=NOT_FOUND)
def get_ticket(ticket_id: int, service: Service) -> TicketOut:
    try:
        return service.get(ticket_id)
    except NotFoundError as exc:
        raise _translate(exc) from exc


@router.post("", response_model=TicketOut, status_code=status.HTTP_201_CREATED)
def create_ticket(data: TicketCreate, service: Service) -> TicketOut:
    return service.create(data)


@router.patch("/{ticket_id}", response_model=TicketOut, responses={**NOT_FOUND, **FORBIDDEN})
def update_ticket(ticket_id: int, data: TicketUpdate, service: Service) -> TicketOut:
    try:
        return service.update(ticket_id, data)
    except (NotFoundError, ForbiddenError, FieldValidationError) as exc:
        raise _translate(exc) from exc


@router.post(
    "/{ticket_id}/resolve",
    response_model=TicketOut,
    responses={
        **NOT_FOUND,
        403: {"description": "Technik i administrator zamykają zgłoszenie przez PATCH status"},
        **ALREADY_RESOLVED,
    },
)
def resolve_ticket(ticket_id: int, data: ResolveRequest, service: Service) -> TicketOut:
    """Zgłaszający zamyka własne zgłoszenie po pomocy asystenta AI („Pomogło – zamknij zgłoszenie”)."""
    try:
        return service.resolve(ticket_id)
    except (NotFoundError, ForbiddenError, ConflictError) as exc:
        raise _translate(exc) from exc


@router.delete("/{ticket_id}", status_code=status.HTTP_204_NO_CONTENT, responses={**NOT_FOUND, **FORBIDDEN})
def delete_ticket(ticket_id: int, service: Service) -> Response:
    try:
        service.delete(ticket_id)
    except (NotFoundError, ForbiddenError) as exc:
        raise _translate(exc) from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import CurrentUser
from app.db.session import get_db
from app.schemas.assistant import AssistantAsk, AssistantConversation
from app.services.ai_client import AiClient, get_ai_client
from app.services.assistant_service import AssistantService
from app.services.errors import (
    AssistantBusyError,
    AssistantRefusedError,
    AssistantUnavailableError,
    LimitExceededError,
    NotFoundError,
)

router = APIRouter(
    prefix="/api/tickets/{ticket_id}/assistant",
    tags=["assistant"],
    responses={
        401: {"description": "Brak lub nieważny token"},
        404: {"description": "Zgłoszenie nie istnieje albo nie jest widoczne dla użytkownika"},
    },
)


def get_service(
    db: Annotated[Session, Depends(get_db)],
    user: CurrentUser,
    client: Annotated[AiClient, Depends(get_ai_client)],
) -> AssistantService:
    return AssistantService(db, user, client)


Service = Annotated[AssistantService, Depends(get_service)]


@router.get("", response_model=AssistantConversation)
def get_conversation(ticket_id: int, service: Service) -> AssistantConversation:
    try:
        return service.get(ticket_id)
    except NotFoundError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc


@router.post(
    "",
    response_model=AssistantConversation,
    responses={
        409: {"description": "Asystent już odpowiada na inne pytanie w tym zgłoszeniu"},
        422: {"description": "Błędna wiadomość albo odrzucona przez filtr treści"},
        429: {"description": "Wyczerpany limit odpowiedzi asystenta dla zgłoszenia"},
        503: {"description": "Asystent wyłączony albo chwilowo niedostępny"},
    },
)
def ask_assistant(ticket_id: int, data: AssistantAsk, service: Service) -> AssistantConversation:
    try:
        return service.ask(ticket_id, data.message)
    except NotFoundError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc
    except AssistantRefusedError as exc:
        raise HTTPException(422, str(exc)) from exc
    except AssistantBusyError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc
    except LimitExceededError as exc:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, str(exc)) from exc
    except AssistantUnavailableError as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc

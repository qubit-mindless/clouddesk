from typing import Annotated

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from app.api.deps import CurrentUser
from app.db.session import get_db
from app.schemas.notification import NotificationList, NotificationsReadRequest
from app.services.notification_service import NotificationService

router = APIRouter(
    prefix="/api/notifications",
    tags=["notifications"],
    responses={401: {"description": "Brak lub nieważny token"}},
)


def get_service(db: Annotated[Session, Depends(get_db)], user: CurrentUser) -> NotificationService:
    return NotificationService(db, user)


Service = Annotated[NotificationService, Depends(get_service)]


@router.get("", response_model=NotificationList)
def list_notifications(service: Service) -> NotificationList:
    """Powiadomienia z ostatnich 7 dni (najwyżej 20, od najnowszych) – bez własnych zmian użytkownika."""
    return service.list()


@router.post("/read", status_code=status.HTTP_204_NO_CONTENT)
def mark_notifications_read(_: NotificationsReadRequest, service: Service) -> Response:
    """Oznacza wszystkie dotychczasowe powiadomienia jako przeczytane."""
    service.mark_read()
    return Response(status_code=status.HTTP_204_NO_CONTENT)

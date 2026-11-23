from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.deps import CurrentUser
from app.db.session import get_db
from app.schemas.activity import ACTIVITY_DEFAULT_LIMIT, ACTIVITY_MAX_LIMIT, ActivityPage
from app.services.activity_service import ActivityService

router = APIRouter(
    prefix="/api/activity", tags=["activity"], responses={401: {"description": "Brak lub nieważny token"}}
)


def get_service(db: Annotated[Session, Depends(get_db)], user: CurrentUser) -> ActivityService:
    return ActivityService(db, user)


@router.get("", response_model=ActivityPage)
def list_activity(
    service: Annotated[ActivityService, Depends(get_service)],
    limit: Annotated[int, Query(ge=1, le=ACTIVITY_MAX_LIMIT)] = ACTIVITY_DEFAULT_LIMIT,
) -> ActivityPage:
    """Ostatnie zdarzenia w zgłoszeniach widocznych dla użytkownika (zgłaszający – tylko swoje)."""
    return service.activity(limit)

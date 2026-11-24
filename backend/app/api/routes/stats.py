from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.api.deps import CurrentUser
from app.db.session import get_db
from app.schemas.stats import STATS_DEFAULT_DAYS, STATS_MAX_DAYS, STATS_MIN_DAYS, Stats
from app.services.errors import ForbiddenError
from app.services.stats_service import StatsService

router = APIRouter(
    prefix="/api/stats", tags=["stats"], responses={401: {"description": "Brak lub nieważny token"}}
)


def get_service(db: Annotated[Session, Depends(get_db)], user: CurrentUser) -> StatsService:
    return StatsService(db, user)


@router.get(
    "", response_model=Stats, responses={403: {"description": "Pulpit tylko dla technika i administratora"}}
)
def get_stats(
    service: Annotated[StatsService, Depends(get_service)],
    days: Annotated[int, Query(ge=STATS_MIN_DAYS, le=STATS_MAX_DAYS)] = STATS_DEFAULT_DAYS,
) -> Stats:
    """Pulpit SLA: statusy, priorytety otwartych, SLA, MTTR, obciążenie techników, dni i asystent AI."""
    try:
        return service.stats(days)
    except ForbiddenError as exc:
        raise HTTPException(status.HTTP_403_FORBIDDEN, str(exc)) from exc

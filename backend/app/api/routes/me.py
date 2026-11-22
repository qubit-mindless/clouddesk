from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import CurrentUser
from app.db.session import get_db
from app.schemas.summary import MeSummary
from app.services.summary_service import SummaryService

router = APIRouter(prefix="/api/me", tags=["me"], responses={401: {"description": "Brak lub nieważny token"}})


def get_service(db: Annotated[Session, Depends(get_db)], user: CurrentUser) -> SummaryService:
    return SummaryService(db, user)


@router.get("/summary", response_model=MeSummary)
def my_summary(service: Annotated[SummaryService, Depends(get_service)]) -> MeSummary:
    """Liczniki do powitania: moje zgłoszenia, zespół i „Asystent AI dziś” (zespół i AI – technik, admin)."""
    return service.summary()

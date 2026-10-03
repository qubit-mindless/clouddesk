from datetime import UTC, datetime

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from app.core.config import get_settings
from app.db import session
from app.schemas.health import HealthDTO

router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthDTO)
def health() -> JSONResponse:
    """Sonda dla Azure Container Apps / monitoringu: 200 gdy baza odpowiada, 500 gdy nie."""
    version = get_settings().app_version
    now = datetime.now(UTC)
    try:
        session.ping_db()
    except Exception:
        body = HealthDTO(status="DOWN", database="DISCONNECTED", version=version, timestamp=now)
        return JSONResponse(status_code=500, content=body.model_dump(mode="json"))
    body = HealthDTO(status="UP", database="CONNECTED", version=version, timestamp=now)
    return JSONResponse(status_code=200, content=body.model_dump(mode="json"))

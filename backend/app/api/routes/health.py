from fastapi import APIRouter
from fastapi.responses import JSONResponse

from app.core import clock
from app.core.config import get_settings
from app.db import session
from app.schemas.health import HealthDTO, LivenessDTO

router = APIRouter(tags=["health"])

# Moment startu procesu – na /status widać, kiedy replika wstała (np. wybudzenie ze skali 0).
STARTED_AT = clock.utc_now()


# /health – sonda Container Apps i monitoringu; /api/health – ten sam stan z zewnątrz,
# bo Nginx na vm-web przekazuje do backendu tylko ścieżki /api/...
@router.get("/health", response_model=HealthDTO)
@router.get("/api/health", response_model=HealthDTO)
def health() -> JSONResponse:
    """Stan aplikacji: 200 gdy baza odpowiada, 503 gdy nie; wersja i SHA wdrożonego commita."""
    settings = get_settings()
    info = {
        "version": settings.app_version,
        "commit": settings.git_sha,
        "timestamp": clock.utc_now(),
        # Pusta zmienna (np. „APP_REGION=” w .env) to brak wartości – null, nie "".
        "revision": settings.container_app_revision or None,
        "replica": settings.container_app_replica_name or None,
        "region": settings.app_region or None,
        "started_at": STARTED_AT,
        # Tylko konfiguracja – bez wywołania modelu (każde odświeżenie /status kosztowałoby tokeny).
        "assistant": "ENABLED" if settings.azure_openai_endpoint else "DISABLED",
    }
    try:
        session.ping_db()
    except Exception:
        body = HealthDTO(status="DOWN", database="DISCONNECTED", **info)
        return JSONResponse(status_code=503, content=body.model_dump(mode="json", by_alias=True))
    body = HealthDTO(status="UP", database="CONNECTED", **info)
    return JSONResponse(status_code=200, content=body.model_dump(mode="json", by_alias=True))


# Sondy startup/liveness/readiness Container Apps: sprawdzają tylko, czy proces odpowiada – bez bazy, żeby
# chwilowa awaria PostgreSQL nie kończyła się restartem kontenera ani wyłączeniem replik z ruchu.
# Stan bazy raportuje /health (503 przy awarii).
# Tylko wewnątrz VNet – Nginx nie przekazuje tej ścieżki.
# async: działa na pętli zdarzeń, nie w puli wątków, którą przy awarii bazy mogą zająć zablokowane zapytania.
@router.get("/health/live", response_model=LivenessDTO)
async def liveness() -> LivenessDTO:
    """Proces aplikacji działa. Zawsze 200, niezależnie od stanu bazy."""
    return LivenessDTO(status="UP")

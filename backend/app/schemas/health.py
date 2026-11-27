from datetime import datetime
from typing import Literal

from pydantic import BaseModel

from app.schemas.base import CamelModel


class HealthDTO(CamelModel):
    """Publiczny stan wdrożenia dla monitoringu i strony /status (#140).

    Bez danych o infrastrukturze, które ułatwiałyby atak: nazwy hosta, domeny środowiska, adresów IP z VNet,
    nazw Key Vault/Storage ani czegokolwiek z DATABASE_URL.
    """

    status: Literal["UP", "DOWN"]
    database: Literal["CONNECTED", "DISCONNECTED"]
    version: str
    commit: str
    timestamp: datetime
    revision: str | None
    replica: str | None
    region: str | None
    started_at: datetime
    assistant: Literal["ENABLED", "DISABLED"]


class LivenessDTO(BaseModel):
    status: str

from datetime import datetime

from pydantic import BaseModel


class HealthDTO(BaseModel):
    status: str
    database: str
    version: str
    timestamp: datetime

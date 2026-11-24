from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import activity, assistant, auth, health, me, notifications, tickets
from app.core.config import get_settings
from app.core.security import check_configuration

settings = get_settings()
# Brak klucza JWT w Azure zatrzymuje start (rewizja nie przejdzie), zamiast psuć dopiero logowanie.
check_configuration()

app = FastAPI(title="CloudDesk API", version=settings.app_version)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(auth.router)
app.include_router(tickets.router)
app.include_router(assistant.router)
app.include_router(activity.router)
app.include_router(notifications.router)
app.include_router(me.router)

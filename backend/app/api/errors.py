"""Globalna obsługa błędów: klient zawsze dostaje JSON bez śladu stosu i szczegółów połączenia z bazą.

Szczegóły trafiają tylko do logu kontenera (Log Analytics), nigdy do odpowiedzi.
"""

import json
import logging
from typing import Any

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response
from sqlalchemy.exc import DisconnectionError, InterfaceError, OperationalError
from sqlalchemy.exc import TimeoutError as PoolTimeoutError
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint

# Logger uvicorna: wpisy mają poziom ("ERROR:") w tym samym formacie co reszta logu kontenera,
# więc łapie je zapytanie KQL z README (Log_s has "ERROR").
logger = logging.getLogger("uvicorn.error")

# Baza nie odpowiada: brak połączenia, zerwane połączenie, przekroczony connect_timeout albo pool_timeout,
# limit połączeń. Błędy danych (np. IntegrityError) to nie awaria bazy – kończą się ogólnym 500.
DATABASE_UNAVAILABLE = (OperationalError, InterfaceError, DisconnectionError, PoolTimeoutError)

DATABASE_UNAVAILABLE_MESSAGE = "Baza danych jest chwilowo niedostępna. Spróbuj ponownie za chwilę."
INTERNAL_ERROR_MESSAGE = "Wystąpił nieoczekiwany błąd serwera. Spróbuj ponownie później."


class SafeJSONResponse(JSONResponse):
    """JSON, który zawsze da się wysłać: znak spoza UTF-8 (pojedynczy surogat) idzie jako \\uXXXX."""

    def render(self, content: Any) -> bytes:
        try:
            return super().render(content)
        except UnicodeEncodeError:
            return json.dumps(content, ensure_ascii=True, separators=(",", ":")).encode("ascii")


async def validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
    # Ten sam kształt co domyślny handler FastAPI, ale odpowiedź 422 odsyła błędne dane (pole "input"),
    # a te mogą zawierać pojedynczy surogat z JSON-a – domyślny JSONResponse kończy się wtedy błędem 500.
    return SafeJSONResponse(status_code=422, content={"detail": jsonable_encoder(exc.errors())})


async def database_unavailable(request: Request, exc: Exception) -> JSONResponse:
    # Tylko komunikat sterownika (exc.orig): str(exc) SQLAlchemy dokleja SQL i wartości parametrów,
    # czyli e-maile i treść zgłoszeń. Bez śladu stosu – przy awarii bazy nie zalewamy nim logu.
    driver_message = str(getattr(exc, "orig", None) or exc).strip()
    logger.error(
        "Baza niedostępna: %s %s – %s: %s",
        request.method,
        request.url.path,
        type(exc).__name__,
        driver_message,
    )
    return JSONResponse(
        status_code=503, content={"detail": DATABASE_UNAVAILABLE_MESSAGE}, headers={"Retry-After": "10"}
    )


async def catch_unexpected_errors(request: Request, call_next: RequestResponseEndpoint) -> Response:
    """Ostatnia linia obrony: każdy nieobsłużony wyjątek → JSON 500, ślad stosu tylko w logu (jeden raz).

    Middleware, a nie handler `Exception`: ten działa w ServerErrorMiddleware poza CORS (odpowiedź bez
    nagłówków CORS) i po odpowiedzi rzuca wyjątek dalej, więc uvicorn logowałby ślad stosu drugi raz.
    """
    try:
        return await call_next(request)
    except Exception:
        logger.exception("Nieobsłużony wyjątek: %s %s", request.method, request.url.path)
        return JSONResponse(status_code=500, content={"detail": INTERNAL_ERROR_MESSAGE})


def register_error_handlers(app: FastAPI) -> None:
    """Wywołać przed dodaniem CORSMiddleware – middleware dodany później jest bardziej zewnętrzny."""
    app.add_exception_handler(RequestValidationError, validation_error)
    for exc_class in DATABASE_UNAVAILABLE:
        app.add_exception_handler(exc_class, database_unavailable)
    app.add_middleware(BaseHTTPMiddleware, dispatch=catch_unexpected_errors)

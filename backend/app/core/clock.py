"""Czas aplikacji: „teraz” w UTC i dzień kalendarzowy w strefie Europe/Warsaw (liczniki „dziś”)."""

from datetime import UTC, date, datetime, time
from zoneinfo import ZoneInfo

# Bazę stref daje pakiet tzdata z requirements.txt – obraz python:*-slim nie ma /usr/share/zoneinfo.
WARSAW = ZoneInfo("Europe/Warsaw")


def utc_now() -> datetime:
    return datetime.now(UTC)


def as_utc(value: datetime) -> datetime:
    """Data ze strefą UTC. SQLite (testy) zwraca daty bez strefy – zapisujemy je zawsze w UTC."""
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def local_date(value: datetime) -> date:
    """Dzień kalendarzowy w Polsce, do którego należy chwila `value`."""
    return as_utc(value).astimezone(WARSAW).date()


def day_start(day: date) -> datetime:
    """Początek dnia `day` w Polsce (północ czasu lokalnego) jako chwila w UTC."""
    return datetime.combine(day, time(0), WARSAW).astimezone(UTC)

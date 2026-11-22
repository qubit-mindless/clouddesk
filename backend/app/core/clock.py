"""Czas aplikacji: „teraz” w UTC i dzień kalendarzowy w strefie Europe/Warsaw (liczniki „dziś”)."""

from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

CET = timedelta(hours=1)
CEST = timedelta(hours=2)

try:
    _ZONE: ZoneInfo | None = ZoneInfo("Europe/Warsaw")
except ZoneInfoNotFoundError:
    # Obraz python:*-slim może nie mieć bazy stref czasowych (pakiet tzdata) – wtedy liczymy według reguły UE:
    # czas letni od ostatniej niedzieli marca do ostatniej niedzieli października, zmiana o 01:00 UTC.
    _ZONE = None


def utc_now() -> datetime:
    return datetime.now(UTC)


def as_utc(value: datetime) -> datetime:
    """Data ze strefą UTC. SQLite (testy) zwraca daty bez strefy – zapisujemy je zawsze w UTC."""
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def _last_sunday(year: int, month: int) -> date:
    last_day = (date(year + month // 12, month % 12 + 1, 1)) - timedelta(days=1)
    return last_day - timedelta(days=(last_day.weekday() + 1) % 7)


def _eu_offset(moment: datetime) -> timedelta:
    """Przesunięcie czasu polskiego względem UTC w danej chwili (reguła UE, bez bazy stref)."""
    moment = as_utc(moment)
    summer_start = datetime.combine(_last_sunday(moment.year, 3), time(1), UTC)
    summer_end = datetime.combine(_last_sunday(moment.year, 10), time(1), UTC)
    return CEST if summer_start <= moment < summer_end else CET


def local_date(value: datetime) -> date:
    """Dzień kalendarzowy w Polsce, do którego należy chwila `value`."""
    moment = as_utc(value)
    if _ZONE is not None:
        return moment.astimezone(_ZONE).date()
    return (moment + _eu_offset(moment)).date()


def day_start(day: date) -> datetime:
    """Początek dnia `day` w Polsce (północ czasu lokalnego) jako chwila w UTC."""
    if _ZONE is not None:
        return datetime.combine(day, time(0), _ZONE).astimezone(UTC)
    midnight = datetime.combine(day, time(0), UTC)
    # Północ nigdy nie wypada w godzinie zmiany czasu (02:00–03:00) – wystarczy sprawdzić, który czas trwa.
    summer = midnight - CEST
    return summer if _eu_offset(summer) == CEST else midnight - CET

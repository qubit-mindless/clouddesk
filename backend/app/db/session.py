from collections.abc import Iterator

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import get_settings

_database_url = get_settings().database_url
# Krótkie limity dla PostgreSQL: gdy baza nie odpowiada, /health i zapytania kończą się błędem po kilku
# sekundach, zamiast blokować wątki do systemowego timeoutu TCP (~2 min) i 30 s czekania na pulę.
# SQLite (testy) nie obsługuje tych opcji.
_pg_options: dict = {}
if _database_url.startswith("postgresql"):
    _pg_options = {"connect_args": {"connect_timeout": 3}, "pool_timeout": 10}

engine = create_engine(_database_url, pool_pre_ping=True, **_pg_options)
SessionLocal = sessionmaker(bind=engine, autoflush=False)


def get_db() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def ping_db() -> None:
    with engine.connect() as conn:
        conn.execute(text("SELECT 1"))

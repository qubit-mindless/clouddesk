"""Migracje Alembica na pustej bazie: upgrade → zgodność z modelami → downgrade → upgrade → seed.

Zawsze na SQLite (plik tymczasowy). Dodatkowo na PostgreSQL, gdy ustawiono TEST_DATABASE_URL,
np. lokalnie: TEST_DATABASE_URL=postgresql+psycopg://clouddesk:clouddesk@localhost:5432/clouddesk_test pytest
Uwaga: test kasuje tabele, dlatego na PostgreSQL wymaga OSOBNEJ, pustej bazy.
"""

import os
from pathlib import Path

os.environ.setdefault("DATABASE_URL", "sqlite://")

import pytest  # noqa: E402
from alembic import command  # noqa: E402
from alembic.autogenerate import compare_metadata  # noqa: E402
from alembic.config import Config  # noqa: E402
from alembic.runtime.migration import MigrationContext  # noqa: E402
from sqlalchemy import Engine, create_engine, inspect, pool  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from app.db.seed import seed  # noqa: E402
from app.models import Base  # noqa: E402

BACKEND_DIR = Path(__file__).resolve().parents[1]
APP_TABLES = {"users", "tickets", "ticket_history", "comments", "attachments", "ai_messages"}
TICKET_INDEXES = {
    "ix_tickets_status",
    "ix_tickets_priority",
    "ix_tickets_assignee_id",
    "ix_tickets_reporter_id",
    "ix_tickets_sla_due_at",
}


def _alembic(engine: Engine, action: str, revision: str) -> None:
    # Bez pliku alembic.ini – nie nadpisujemy konfiguracji logowania pytesta.
    cfg = Config()
    cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    with engine.connect() as conn:
        cfg.attributes["connection"] = conn
        getattr(command, action)(cfg, revision)
        conn.commit()


@pytest.fixture(params=["sqlite", "postgresql"])
def engine(request, tmp_path):
    if request.param == "sqlite":
        eng = create_engine(f"sqlite:///{tmp_path / 'migrations.db'}", poolclass=pool.NullPool)
    else:
        url = os.environ.get("TEST_DATABASE_URL")
        if not url:
            pytest.skip("brak TEST_DATABASE_URL – test na PostgreSQL pominięty")
        eng = create_engine(url, poolclass=pool.NullPool)
        leftover = set(inspect(eng).get_table_names()) - {"alembic_version"}
        if leftover:
            pytest.skip(f"baza z TEST_DATABASE_URL nie jest pusta: {sorted(leftover)}")
    yield eng
    _alembic(eng, "downgrade", "base")
    eng.dispose()


def test_migrations_on_empty_db(engine):
    _alembic(engine, "upgrade", "head")
    insp = inspect(engine)
    assert APP_TABLES <= set(insp.get_table_names())
    assert TICKET_INDEXES <= {ix["name"] for ix in insp.get_indexes("tickets")}

    # Migracja odpowiada modelom – zmiana modelu bez nowej migracji wywali ten test.
    with engine.connect() as conn:
        assert compare_metadata(MigrationContext.configure(conn), Base.metadata) == []

    _alembic(engine, "downgrade", "base")
    assert not APP_TABLES & set(inspect(engine).get_table_names())

    _alembic(engine, "upgrade", "head")
    with Session(engine) as db:
        added = seed(db)
        assert added == {
            "users": 11,
            "accounts_activated": 0,
            "tickets": 8,
            "ticket_history": 9,
            "comments": 3,
            "attachments": 1,
            "ai_messages": 3,
        }
        assert not any(seed(db).values())


def test_seed_sets_demo_password_once(monkeypatch, tmp_path):
    """Bez DEMO_PASSWORD konta z seeda nie logują się; z nim – logują; zmiana hasła trafia do kont."""
    import secrets

    from app.core import config
    from app.services.auth_service import AuthService

    # Hasła losowane w teście – w repo nie ma stałych, które skaner sekretów wziąłby za prawdziwe.
    first, second = secrets.token_urlsafe(12), secrets.token_urlsafe(12)

    engine = create_engine(f"sqlite:///{tmp_path / 'seed.db'}")
    _alembic(engine, "upgrade", "head")
    monkeypatch.setattr(config.get_settings(), "demo_password", None)
    with Session(engine) as db:
        seed(db)
        assert AuthService(db).login("admin@clouddesk.example", first) is None

        monkeypatch.setattr(config.get_settings(), "demo_password", first)
        assert seed(db)["accounts_activated"] == 11
        token = AuthService(db).login("admin@clouddesk.example", first)
        assert token is not None and token.user.role == "ADMIN"

        assert seed(db)["accounts_activated"] == 0  # to samo hasło – bez zmian

        monkeypatch.setattr(config.get_settings(), "demo_password", second)
        assert seed(db)["accounts_activated"] == 11
        assert AuthService(db).login("admin@clouddesk.example", first) is None
        assert AuthService(db).login("admin@clouddesk.example", second) is not None
    engine.dispose()

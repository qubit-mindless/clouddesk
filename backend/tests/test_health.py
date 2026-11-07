import os

os.environ.setdefault("DATABASE_URL", "sqlite://")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.core.config import get_settings  # noqa: E402
from app.db import session  # noqa: E402
from app.main import app  # noqa: E402

client = TestClient(app)


@pytest.fixture(autouse=True)
def fresh_settings(monkeypatch):
    # Ustawienia są cache'owane (lru_cache) – czyścimy je, żeby każdy test czytał własne zmienne środowiskowe.
    monkeypatch.delenv("GIT_SHA", raising=False)
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def test_health_up(monkeypatch):
    monkeypatch.setattr(session, "ping_db", lambda: None)
    res = client.get("/health")
    assert res.status_code == 200
    assert res.json()["status"] == "UP"


def test_health_down(monkeypatch):
    def fail():
        raise RuntimeError("db down")

    monkeypatch.setattr(session, "ping_db", fail)
    res = client.get("/health")
    assert res.status_code == 503
    assert res.json()["database"] == "DISCONNECTED"


def test_health_commit_defaults_to_local(monkeypatch):
    monkeypatch.setattr(session, "ping_db", lambda: None)
    assert client.get("/health").json()["commit"] == "local"


def test_health_commit_from_env(monkeypatch):
    monkeypatch.setattr(session, "ping_db", lambda: None)
    monkeypatch.setenv("GIT_SHA", "3f2a9c1d")
    get_settings.cache_clear()
    assert client.get("/health").json()["commit"] == "3f2a9c1d"


@pytest.mark.parametrize("db_up", [True, False])
def test_api_health_matches_health(monkeypatch, db_up):
    def ping():
        if not db_up:
            raise RuntimeError("db down")

    monkeypatch.setattr(session, "ping_db", ping)
    monkeypatch.setenv("GIT_SHA", "3f2a9c1d")
    get_settings.cache_clear()

    plain, api = client.get("/health"), client.get("/api/health")
    assert api.status_code == plain.status_code == (200 if db_up else 503)
    # Wszystko poza znacznikiem czasu musi być identyczne.
    without_time = [{k: v for k, v in r.json().items() if k != "timestamp"} for r in (plain, api)]
    assert without_time[0] == without_time[1]
    assert without_time[1]["commit"] == "3f2a9c1d"

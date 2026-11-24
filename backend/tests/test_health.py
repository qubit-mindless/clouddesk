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
    for name in ("GIT_SHA", "CONTAINER_APP_REVISION", "CONTAINER_APP_REPLICA_NAME", "APP_REGION"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("AZURE_OPENAI_ENDPOINT", "")
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


def test_liveness_ignores_database(monkeypatch):
    # Baza naprawdę niedostępna: każda próba połączenia przez silnik albo sesję kończy się błędem.
    def fail(*args, **kwargs):
        raise RuntimeError("db down")

    monkeypatch.setattr(session.engine, "connect", fail)
    monkeypatch.setattr(session, "SessionLocal", fail)
    assert client.get("/health").status_code == 503
    res = client.get("/health/live")
    assert res.status_code == 200
    assert res.json() == {"status": "UP"}


def test_liveness_not_exposed_under_api():
    # Nginx przekazuje do backendu tylko /api/... – sonda liveness ma zostać wewnętrzna.
    assert client.get("/api/health/live").status_code == 404


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


def test_health_deployment_fields_outside_azure(monkeypatch):
    monkeypatch.setattr(session, "ping_db", lambda: None)
    body = client.get("/api/health").json()
    assert body["revision"] is None
    assert body["replica"] is None
    assert body["region"] is None
    assert body["assistant"] == "DISABLED"
    assert body["startedAt"] <= body["timestamp"]


def test_health_empty_env_is_null(monkeypatch):
    monkeypatch.setattr(session, "ping_db", lambda: None)
    monkeypatch.setenv("APP_REGION", "")
    get_settings.cache_clear()
    assert client.get("/api/health").json()["region"] is None


def test_health_deployment_fields_from_azure_env(monkeypatch):
    monkeypatch.setattr(session, "ping_db", lambda: None)
    monkeypatch.setenv("CONTAINER_APP_REVISION", "ca-clouddesk-backend--0000042")
    monkeypatch.setenv("CONTAINER_APP_REPLICA_NAME", "ca-clouddesk-backend--0000042-abc")
    monkeypatch.setenv("APP_REGION", "polandcentral")
    monkeypatch.setenv("AZURE_OPENAI_ENDPOINT", "https://example.openai.azure.com/")
    get_settings.cache_clear()
    body = client.get("/api/health").json()
    assert body["revision"] == "ca-clouddesk-backend--0000042"
    assert body["replica"] == "ca-clouddesk-backend--0000042-abc"
    assert body["region"] == "polandcentral"
    assert body["assistant"] == "ENABLED"


def test_health_down_keeps_deployment_fields(monkeypatch):
    # Przy awarii bazy /status nadal pokazuje wersję i rewizję – to wtedy najbardziej potrzebne.
    def fail():
        raise RuntimeError("db down")

    monkeypatch.setattr(session, "ping_db", fail)
    monkeypatch.setenv("CONTAINER_APP_REVISION", "ca-clouddesk-backend--0000042")
    get_settings.cache_clear()
    res = client.get("/api/health")
    assert res.status_code == 503
    assert res.json()["revision"] == "ca-clouddesk-backend--0000042"


def test_health_exposes_only_contract_fields(monkeypatch):
    # Nic ponad kontrakt (docs/api-kontrakty.md) – nowe pole w /health to świadoma decyzja, nie przypadek.
    monkeypatch.setattr(session, "ping_db", lambda: None)
    monkeypatch.setenv("CONTAINER_APP_HOSTNAME", "ca-clouddesk-backend.internal.example")
    get_settings.cache_clear()
    body = client.get("/api/health").json()
    assert set(body) == {
        "status",
        "database",
        "version",
        "commit",
        "timestamp",
        "revision",
        "replica",
        "region",
        "startedAt",
        "assistant",
    }
    assert "internal.example" not in str(body)

import os

os.environ.setdefault("DATABASE_URL", "sqlite://")

from fastapi.testclient import TestClient  # noqa: E402

from app.db import session  # noqa: E402
from app.main import app  # noqa: E402

client = TestClient(app)


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
    assert res.status_code == 500
    assert res.json()["database"] == "DISCONNECTED"

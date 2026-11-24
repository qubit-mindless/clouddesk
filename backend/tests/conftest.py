"""Wspólne fixtury: baza SQLite w pamięci z kontami testowymi i klienci API zalogowani na różne role."""

import os
import secrets

os.environ.setdefault("DATABASE_URL", "sqlite://")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine, event  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

from app.core.security import hash_password  # noqa: E402
from app.db.session import get_db  # noqa: E402
from app.main import app  # noqa: E402
from app.models import AiMessage, AiMessageRole, Base, User, UserRole  # noqa: E402

# Losowane przy każdym uruchomieniu – bez stałych haseł w repo (skaner sekretów).
PASSWORD = secrets.token_urlsafe(12)
# Liczymy raz – argon2 jest celowo wolny.
PASSWORD_HASH = hash_password(PASSWORD)
USERS = [
    ("admin", "Administrator", UserRole.ADMIN, PASSWORD_HASH),
    ("tech.jan", "Jan Kowalski", UserRole.TECHNICIAN, PASSWORD_HASH),
    ("anna.k", "Anna Kaczmarek", UserRole.REPORTER, PASSWORD_HASH),
    ("piotr.m", "Piotr Mazur", UserRole.REPORTER, PASSWORD_HASH),
    ("bez.hasla", "Konto bez hasła", UserRole.REPORTER, "!"),
]


def email(login: str) -> str:
    return f"{login}@clouddesk.example"


@pytest.fixture
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    # SQLite domyślnie ignoruje klucze obce – bez tego testy nie wyłapałyby błędów CASCADE/RESTRICT.
    event.listen(engine, "connect", lambda dbapi_conn, _: dbapi_conn.execute("PRAGMA foreign_keys=ON"))
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False)
    with session_factory() as session:
        for login, name, role, password_hash in USERS:
            session.add(User(email=email(login), full_name=name, role=role, password_hash=password_hash))
        session.commit()

    def override():
        with session_factory() as session:
            yield session

    app.dependency_overrides[get_db] = override
    yield session_factory
    app.dependency_overrides.clear()
    engine.dispose()


@pytest.fixture
def anonymous(db):
    return TestClient(app)


@pytest.fixture
def login_as(db):
    """login_as("anna.k") → klient API z tokenem tego użytkownika."""

    def make(login: str) -> TestClient:
        res = TestClient(app).post("/api/auth/login", json={"email": email(login), "password": PASSWORD})
        assert res.status_code == 200, res.text
        return TestClient(app, headers={"Authorization": f"Bearer {res.json()['accessToken']}"})

    return make


@pytest.fixture
def client(login_as):
    """Domyślnie administrator – testy CRUD sprawdzają logikę zgłoszeń, a role osobno (test_auth.py)."""
    return login_as("admin")


def add_assistant_answer(session_factory, ticket_id: int) -> None:
    """Odpowiedź asystenta AI zapisana wprost w bazie – bez wywołania usługi AI (np. przed /resolve)."""
    with session_factory() as session:
        session.add(
            AiMessage(ticket_id=ticket_id, role=AiMessageRole.ASSISTANT, content="Odpowiedź asystenta.")
        )
        session.commit()

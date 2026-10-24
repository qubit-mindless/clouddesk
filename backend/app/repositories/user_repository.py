from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import User, UserRole


class UserRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def get_by_login(self, login: str) -> User | None:
        """Login = część e-maila przed „@” (np. tech.jan → tech.jan@clouddesk.example)."""
        escaped = login.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        return self.db.scalars(select(User).where(User.email.like(f"{escaped}@%", escape="\\"))).first()

    def get_or_create(self, email: str, full_name: str, role: UserRole) -> User:
        user = self.db.scalars(select(User).where(User.email == email)).first()
        if user is None:
            # Konto bez możliwości logowania („!” nie jest poprawnym skrótem hasła).
            user = User(email=email, full_name=full_name, role=role, password_hash="!")
            self.db.add(user)
            self.db.flush()
        return user

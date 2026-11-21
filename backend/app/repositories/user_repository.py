from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import User


class UserRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def get_by_login(self, login: str) -> User | None:
        """Login = część e-maila przed „@” (np. tech.jan → tech.jan@clouddesk.example)."""
        escaped = login.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        return self.db.scalars(select(User).where(User.email.like(f"{escaped}@%", escape="\\"))).first()

    def get(self, user_id: int) -> User | None:
        return self.db.get(User, user_id)

    def get_by_email(self, email: str) -> User | None:
        # Bez względu na wielkość liter – także dla kont zapisanych kiedyś z wielkimi literami.
        return self.db.scalars(select(User).where(func.lower(User.email) == email.lower())).first()

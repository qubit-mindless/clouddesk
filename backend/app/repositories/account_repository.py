"""Zapytania panelu administratora o konta (lista, unikalność loginu, ostatni administrator).

Osobno od UserRepository (logowanie, sesja, przypisania), żeby tamten plik został bez zmian.
"""

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.models import User, UserRole

LIKE_ESCAPE = "\\"


def escape_like(text: str) -> str:
    """%, _ i \\ z wyszukiwarki traktujemy dosłownie, a nie jako symbole wieloznaczne LIKE."""
    return text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


class AccountRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def search(
        self, *, q: str | None, role: UserRole | None, offset: int, limit: int
    ) -> tuple[list[User], int]:
        """Konta posortowane po imieniu i nazwisku (potem id); `q` – fragment e-maila lub nazwiska."""
        filters = []
        if role:
            filters.append(User.role == role)
        if q:
            pattern = f"%{escape_like(q)}%"
            filters.append(
                or_(
                    User.email.ilike(pattern, escape=LIKE_ESCAPE),
                    User.full_name.ilike(pattern, escape=LIKE_ESCAPE),
                )
            )
        total = self.db.scalar(select(func.count()).select_from(User).where(*filters)) or 0
        rows = self.db.scalars(
            select(User).where(*filters).order_by(User.full_name, User.id).offset(offset).limit(limit)
        ).all()
        return list(rows), total

    def login_taken(self, login: str) -> bool:
        """Czy jakieś konto ma już ten login (część e-maila przed „@”), bez względu na wielkość liter."""
        pattern = f"{escape_like(login.lower())}@%"
        query = select(User.id).where(func.lower(User.email).like(pattern, escape=LIKE_ESCAPE)).limit(1)
        return self.db.scalar(query) is not None

    def lock_active_admin_ids(self) -> list[int]:
        """ID aktywnych administratorów z blokadą wierszy (SELECT … FOR UPDATE na PostgreSQL).

        Dwie równoległe zmiany (np. dwóch administratorów odbiera sobie nawzajem rolę) czekają wtedy
        na siebie i druga widzi już skutek pierwszej – nie zostaniemy bez aktywnego administratora.
        """
        query = select(User.id).where(User.role == UserRole.ADMIN, User.is_active.is_(True)).with_for_update()
        return list(self.db.scalars(query))

    def add(self, user: User) -> User:
        self.db.add(user)
        self.db.flush()
        return user

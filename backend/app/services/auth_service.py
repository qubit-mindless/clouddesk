from sqlalchemy.orm import Session

from app.core.security import create_access_token, hash_password, needs_rehash, verify_password
from app.models import User
from app.repositories.user_repository import UserRepository
from app.schemas.auth import TokenOut, UserOut


def user_dto(user: User) -> UserOut:
    return UserOut(
        id=user.id,
        email=user.email,
        login=user.login,
        full_name=user.full_name,
        role=user.role,
    )


class AuthService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.users = UserRepository(db)

    def login(self, email: str, password: str) -> TokenOut | None:
        """Token dla poprawnych danych; None dla nieznanego konta i złego hasła (bez rozróżnienia)."""
        user = self.users.get_by_email(email)
        if not verify_password(user.password_hash if user else None, password):
            return None
        assert user is not None
        if needs_rehash(user.password_hash):
            user.password_hash = hash_password(password)
            self.db.commit()
        token, expires_in = create_access_token(user.id, user.role.value)
        return TokenOut(access_token=token, expires_in=expires_in, user=user_dto(user))

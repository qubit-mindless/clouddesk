import logging

from sqlalchemy.orm import Session

from app.core.security import create_access_token, hash_password, needs_rehash, verify_password
from app.models import User
from app.repositories.user_repository import UserRepository
from app.schemas.auth import TokenOut, UserOut
from app.services.errors import FieldValidationError, ForbiddenError

# Logger uvicorna (jak w app/api/errors.py): wpisy INFO trafiają do logu kontenera.
logger = logging.getLogger("uvicorn.error")

ACCOUNT_LOCKED = "Konto jest zablokowane. Skontaktuj się z administratorem."
WRONG_CURRENT_PASSWORD = "Nieprawidłowe obecne hasło."
SAME_PASSWORD = "Nowe hasło musi się różnić od obecnego."


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
        """Token dla poprawnych danych; None dla nieznanego konta i złego hasła (bez rozróżnienia).

        Blokadę sprawdzamy dopiero po poprawnym haśle – bez hasła nie da się sprawdzić, czy konto istnieje.
        """
        user = self.users.get_by_email(email)
        if not verify_password(user.password_hash if user else None, password):
            return None
        assert user is not None
        if not user.is_active:
            raise ForbiddenError(ACCOUNT_LOCKED)
        if needs_rehash(user.password_hash):
            user.password_hash = hash_password(password)
            self.db.commit()
        token, expires_in = create_access_token(user.id, user.role.value)
        return TokenOut(access_token=token, expires_in=expires_in, user=user_dto(user))

    def change_password(self, user: User, current_password: str, new_password: str) -> None:
        """Zmiana własnego hasła. Błędy przy polach formularza (422): złe obecne hasło, nowe = obecne."""
        if not verify_password(user.password_hash, current_password):
            raise FieldValidationError("currentPassword", WRONG_CURRENT_PASSWORD)
        if new_password == current_password:
            raise FieldValidationError("newPassword", SAME_PASSWORD)
        user.password_hash = hash_password(new_password)
        self.db.commit()
        logger.info("Konta: %s – zmiana własnego hasła", user.email.split("@", 1)[0])

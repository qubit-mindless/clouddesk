"""Panel administratora: konta użytkowników (lista, nowe konto, rola, blokada, reset hasła)."""

import logging
import secrets

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.security import hash_password
from app.models import User, UserRole
from app.repositories.account_repository import AccountRepository
from app.repositories.user_repository import UserRepository
from app.schemas.user import (
    PasswordReset,
    UserAdmin,
    UserCreate,
    UserCreated,
    UserPage,
    UserQuery,
    UserUpdate,
)
from app.services.errors import ConflictError, ForbiddenError, NotFoundError

# Logger uvicorna (jak w app/api/errors.py): wpisy INFO trafiają do logu kontenera. Bez haseł.
logger = logging.getLogger("uvicorn.error")

# secrets.token_urlsafe(12) → 16 znaków z alfabetu URL-safe (96 bitów losowości).
TEMPORARY_PASSWORD_BYTES = 12

ADMIN_ONLY = "Zarządzanie kontami jest dostępne tylko dla administratora."
USER_NOT_FOUND = "Konto nie istnieje."
EMAIL_TAKEN = "Konto z tym adresem już istnieje."
SELF_LOCKOUT = "Nie możesz odebrać sobie roli administratora ani zablokować własnego konta."
LAST_ADMIN = (
    "To ostatni aktywny administrator – nie można go zablokować ani odebrać mu roli. "
    "Najpierw nadaj rolę administratora innemu aktywnemu kontu."
)


def login_of(user: User) -> str:
    """Login = część e-maila przed „@” (jak w UserOut)."""
    return user.email.split("@", 1)[0]


def admin_dto(user: User) -> UserAdmin:
    return UserAdmin(
        id=user.id,
        email=user.email,
        login=login_of(user),
        full_name=user.full_name,
        role=user.role,
        is_active=user.is_active,
        created_at=user.created_at,
    )


def temporary_password() -> str:
    return secrets.token_urlsafe(TEMPORARY_PASSWORD_BYTES)


class UserService:
    def __init__(self, db: Session, actor: User) -> None:
        self.db = db
        self.actor = actor
        self.users = UserRepository(db)
        self.accounts = AccountRepository(db)

    def require_admin(self) -> None:
        if self.actor.role != UserRole.ADMIN:
            raise ForbiddenError(ADMIN_ONLY)

    def list(self, query: UserQuery) -> UserPage:
        self.require_admin()
        rows, total = self.accounts.search(
            q=query.q or None, role=query.role, offset=(query.page - 1) * query.size, limit=query.size
        )
        return UserPage(items=[admin_dto(u) for u in rows], total=total, page=query.page, size=query.size)

    def create(self, data: UserCreate) -> UserCreated:
        self.require_admin()
        if self.users.get_by_email(data.email) is not None:
            raise ConflictError(EMAIL_TAKEN)
        login = data.email.split("@", 1)[0]
        # Login identyfikuje konto w API (np. przypisanie technika), więc musi być jednoznaczny.
        if self.accounts.login_taken(login):
            raise ConflictError(
                f"Login „{login}” (część adresu przed „@”) ma już inne konto – użyj innego adresu e-mail."
            )
        password = temporary_password()
        user = User(
            email=data.email,
            full_name=data.full_name,
            role=data.role,
            password_hash=hash_password(password),
            is_active=True,
        )
        try:
            self.accounts.add(user)
            self.db.commit()
        except IntegrityError as exc:
            # Równoległe utworzenie konta z tym samym adresem – ograniczenie UNIQUE w bazie.
            self.db.rollback()
            raise ConflictError(EMAIL_TAKEN) from exc
        logger.info("Konta: %s – nowe konto %s (rola %s)", login_of(self.actor), login, user.role.value)
        return UserCreated(user=admin_dto(user), temporary_password=password)

    def update(self, user_id: int, data: UserUpdate) -> UserAdmin:
        self.require_admin()
        user = self._get(user_id)
        changes = data.model_dump(exclude_unset=True)
        demotes = "role" in changes and changes["role"] != UserRole.ADMIN
        blocks = changes.get("is_active") is False
        if (demotes or blocks) and user.id == self.actor.id:
            raise ConflictError(SELF_LOCKOUT)
        if demotes or blocks:
            active_admins = self.accounts.lock_active_admin_ids()
            if user.id in active_admins and len(active_admins) <= 1:
                raise ConflictError(LAST_ADMIN)

        actions = []
        if "full_name" in changes and changes["full_name"] != user.full_name:
            # Bez wartości w logu – to dane osobowe.
            actions.append("zmiana imienia i nazwiska")
            user.full_name = changes["full_name"]
        if "role" in changes and changes["role"] != user.role:
            actions.append(f"rola {user.role.value} → {changes['role'].value}")
            user.role = changes["role"]
        if "is_active" in changes and changes["is_active"] != user.is_active:
            actions.append("odblokowanie" if changes["is_active"] else "blokada")
            user.is_active = changes["is_active"]
        self.db.commit()
        if actions:
            logger.info("Konta: %s – konto %s: %s", login_of(self.actor), login_of(user), ", ".join(actions))
        return admin_dto(user)

    def reset_password(self, user_id: int) -> PasswordReset:
        self.require_admin()
        user = self._get(user_id)
        password = temporary_password()
        user.password_hash = hash_password(password)
        self.db.commit()
        logger.info("Konta: %s – reset hasła konta %s", login_of(self.actor), login_of(user))
        return PasswordReset(temporary_password=password)

    def _get(self, user_id: int) -> User:
        user = self.users.get(user_id)
        if user is None:
            raise NotFoundError(USER_NOT_FOUND)
        return user

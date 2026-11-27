"""Hasła (argon2id) i tokeny dostępu (JWT HS256)."""

import secrets
import threading
from datetime import UTC, datetime, timedelta
from functools import lru_cache

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

from app.core.config import get_settings

ALGORITHM = "HS256"
ISSUER = "clouddesk"
MIN_SECRET_LENGTH = 32

# argon2id z parametrami minimalnymi wg OWASP (19 MiB, 2 przebiegi, 1 wątek) zamiast domyślnych 64 MiB:
# kontener backendu ma 0,5 GiB RAM, a każde logowanie liczy skrót (także dla nieznanego e-maila).
_hasher = PasswordHasher(time_cost=2, memory_cost=19 * 1024, parallelism=1)
# Najwyżej 2 skróty naraz: zalew żądań logowania czeka w kolejce, zamiast zużyć całą pamięć repliki.
_hash_slots = threading.BoundedSemaphore(2)
# Skrót porównywany, gdy konto nie istnieje – odpowiedź trwa tyle samo, co przy złym haśle,
# więc po czasie odpowiedzi nie da się sprawdzić, które e-maile mają konto.
_DUMMY_HASH = _hasher.hash(secrets.token_urlsafe(16))


def hash_password(password: str) -> str:
    with _hash_slots:
        return _hasher.hash(password)


def verify_password(password_hash: str | None, password: str) -> bool:
    """False także dla nieistniejącego konta i kont bez hasła ("!" z seeda)."""
    with _hash_slots:
        try:
            if not password_hash or not password_hash.startswith("$argon2"):
                # Wyrównanie czasu: brak konta odpowiada tak samo wolno jak złe hasło.
                _hasher.verify(_DUMMY_HASH, password)
                return False
            return _hasher.verify(password_hash, password)
        except (VerificationError, InvalidHashError):
            return False


def needs_rehash(password_hash: str) -> bool:
    return _hasher.check_needs_rehash(password_hash)


@lru_cache
def _signing_key() -> str:
    settings = get_settings()
    if settings.jwt_secret:
        if len(settings.jwt_secret) < MIN_SECRET_LENGTH:
            raise RuntimeError(f"JWT_SECRET musi mieć co najmniej {MIN_SECRET_LENGTH} znaki.")
        return settings.jwt_secret
    if settings.app_env != "local":
        raise RuntimeError("Brak JWT_SECRET – poza APP_ENV=local klucz do tokenów jest wymagany.")
    return secrets.token_urlsafe(48)


def check_configuration() -> None:
    """Wywoływane przy starcie aplikacji: brak klucza w Azure ma zatrzymać start, a nie pierwsze logowanie."""
    _signing_key()


def create_access_token(user_id: int, role: str) -> tuple[str, int]:
    """Zwraca token i jego czas życia w sekundach."""
    ttl = timedelta(minutes=get_settings().jwt_ttl_minutes)
    # Celowo zegar systemowy, nie clock.utc_now(): PyJWT sprawdza `exp` względem prawdziwego czasu, więc token
    # z czasem zamrożonym w teście byłby od razu przeterminowany.
    now = datetime.now(UTC)
    claims = {"sub": str(user_id), "role": role, "iss": ISSUER, "iat": now, "exp": now + ttl}
    return jwt.encode(claims, _signing_key(), algorithm=ALGORITHM), int(ttl.total_seconds())


def decode_access_token(token: str) -> int | None:
    """ID użytkownika z poprawnego, ważnego tokenu; None dla każdego innego."""
    try:
        claims = jwt.decode(
            token,
            _signing_key(),
            algorithms=[ALGORITHM],
            issuer=ISSUER,
            options={"require": ["sub", "exp", "iat", "iss"]},
        )
        return int(claims["sub"])
    except (jwt.PyJWTError, ValueError):
        return None

"""Walidacja tekstu, który trafia do bazy: odrzucamy znaki, których PostgreSQL nie zapisze."""

from pydantic import AfterValidator


def storable_text(value: str) -> str:
    """Zwraca tekst bez zmian albo zgłasza błąd walidacji (FastAPI odpowiada 422 przy polu).

    - Znak NUL (U+0000): PostgreSQL odrzuca go w kolumnach tekstowych, więc bez tej kontroli zapis kończy
      się błędem bazy i odpowiedzią 500.
    - Pojedyncze surogaty (U+D800–U+DFFF, np. "\\ud800" w JSON-ie): nie da się ich zakodować w UTF-8.
    Pozostały Unicode (polskie znaki, emoji, alfabety niełacińskie) przechodzi bez zmian.
    """
    if "\x00" in value:
        raise ValueError("Tekst nie może zawierać znaku NUL (\\u0000).")
    if any("\ud800" <= char <= "\udfff" for char in value):
        raise ValueError("Tekst zawiera nieprawidłowy znak Unicode (pojedynczy surogat).")
    return value


StorableText = AfterValidator(storable_text)

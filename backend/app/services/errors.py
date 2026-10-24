class NotFoundError(Exception):
    """Zasób nie istnieje – router zamienia na 404."""


class FieldValidationError(Exception):
    """Błąd danych wykryty w logice (np. nieznany technik) – router zamienia na 422 w formacie FastAPI."""

    def __init__(self, field: str, message: str) -> None:
        super().__init__(message)
        self.field = field
        self.message = message

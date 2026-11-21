class NotFoundError(Exception):
    """Zasób nie istnieje – router zamienia na 404."""


class ForbiddenError(Exception):
    """Użytkownik jest zalogowany, ale jego rola nie pozwala na operację – router zamienia na 403."""


class FieldValidationError(Exception):
    """Błąd danych wykryty w logice (np. nieznany technik) – router zamienia na 422 w formacie FastAPI."""

    def __init__(self, field: str, message: str) -> None:
        super().__init__(message)
        self.field = field
        self.message = message


class LimitExceededError(Exception):
    """Przekroczony limit (np. pytań do asystenta) – router zamienia na 429."""


class AssistantUnavailableError(Exception):
    """Usługa AI wyłączona, niedostępna albo zwróciła błąd – router zamienia na 503."""


class AssistantRefusedError(Exception):
    """Filtr treści usługi AI odrzucił wiadomość – router zamienia na 422 z komunikatem."""


class AssistantBusyError(Exception):
    """Asystent już odpowiada na pytanie w tym zgłoszeniu – router zamienia na 409."""

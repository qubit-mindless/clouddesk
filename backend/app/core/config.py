from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Cała konfiguracja pochodzi ze zmiennych środowiskowych (.env lokalnie, App Settings w Azure)."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_env: str = "local"
    app_version: str = "0.1.0"
    database_url: str
    cors_origins: str = "http://localhost:5173"
    # Konto, na które zapisujemy zgłoszenia i zmiany, dopóki nie ma logowania (#14).
    demo_user_email: str = "demo@clouddesk.example"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()

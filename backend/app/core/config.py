from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Cała konfiguracja pochodzi ze zmiennych środowiskowych (.env lokalnie, App Settings w Azure)."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_env: str = "local"
    app_version: str = "0.1.0"
    # SHA commita, z którego zbudowano obraz (build-arg GIT_SHA w Dockerfile); lokalnie "local".
    git_sha: str = "local"
    database_url: str
    cors_origins: str = "http://localhost:5173"
    # Klucz HMAC do podpisywania tokenów JWT. W Azure z Key Vault (sekret jwt-secret);
    # poza APP_ENV=local wymagany.
    # Lokalnie może zostać pusty: wtedy klucz jest losowany przy starcie (tokeny tracą ważność po restarcie).
    jwt_secret: str | None = None
    jwt_ttl_minutes: int = 60
    # Asystent AI (Azure OpenAI). Bez endpointu jest wyłączony: GET zwraca enabled=false, POST → 503.
    azure_openai_endpoint: str | None = None
    azure_openai_deployment: str = "gpt-4o-mini"
    azure_openai_api_version: str = "2024-10-21"
    # Klucz tylko lokalnie/awaryjnie; w Azure tożsamość zarządzana (AZURE_CLIENT_ID = jej client ID).
    azure_openai_api_key: str | None = None
    azure_client_id: str | None = None
    ai_timeout_seconds: float = 30.0
    ai_max_output_tokens: int = 500
    # Ile odpowiedzi asystenta może mieć jedno zgłoszenie – górna granica kosztu.
    ai_max_answers_per_ticket: int = 10
    # Hasło kont demo ustawiane przez seed (python -m app.db.seed). Puste = konta bez możliwości logowania.
    demo_password: str | None = None

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()

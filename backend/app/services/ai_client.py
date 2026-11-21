"""Klient Azure OpenAI (chat completions) przez REST – bez SDK, żeby obraz został mały.

Uwierzytelnienie: w Azure tożsamość zarządzana backendu (token z endpointu tożsamości Container Apps),
lokalnie opcjonalnie klucz AZURE_OPENAI_API_KEY. Treść rozmów nie trafia do logów.
"""

import logging
import os
import threading
import time
from typing import Protocol

import httpx

from app.core.config import Settings, get_settings
from app.services.errors import AssistantRefusedError, AssistantUnavailableError

log = logging.getLogger(__name__)

COGNITIVE_SCOPE = "https://cognitiveservices.azure.com"
Message = dict[str, str]


class AiClient(Protocol):
    enabled: bool

    def complete(self, messages: list[Message]) -> str: ...


class DisabledClient:
    enabled = False

    def complete(self, messages: list[Message]) -> str:
        raise AssistantUnavailableError("Asystent AI nie jest skonfigurowany na tym serwerze.")


class ManagedIdentityToken:
    """Token dostępu z tożsamości zarządzanej Container Apps (IDENTITY_ENDPOINT / IDENTITY_HEADER)."""

    def __init__(self, http: httpx.Client, client_id: str | None) -> None:
        self.http = http
        self.client_id = client_id
        self._token: str | None = None
        self._expires_at = 0.0
        self._lock = threading.Lock()

    def get(self) -> str:
        with self._lock:
            # Odświeżamy z 5-minutowym zapasem.
            if self._token and time.time() < self._expires_at - 300:
                return self._token
            endpoint, header = os.environ.get("IDENTITY_ENDPOINT"), os.environ.get("IDENTITY_HEADER")
            if not endpoint or not header:
                raise AssistantUnavailableError("Brak tożsamości zarządzanej do logowania w Azure OpenAI.")
            params = {"resource": COGNITIVE_SCOPE, "api-version": "2019-08-01"}
            if self.client_id:
                params["client_id"] = self.client_id
            try:
                res = self.http.get(endpoint, params=params, headers={"X-IDENTITY-HEADER": header})
                res.raise_for_status()
                body = res.json()
                self._token = body["access_token"]
                self._expires_at = float(body["expires_on"])
            except (httpx.HTTPError, KeyError, TypeError, ValueError) as exc:
                log.warning("Tożsamość zarządzana: nie udało się pobrać tokenu (%s)", type(exc).__name__)
                raise AssistantUnavailableError("Asystent AI jest chwilowo niedostępny.") from exc
            return self._token


class AzureOpenAIClient:
    enabled = True

    def __init__(self, settings: Settings, http: httpx.Client | None = None) -> None:
        assert settings.azure_openai_endpoint
        self.settings = settings
        self.http = http or httpx.Client(timeout=settings.ai_timeout_seconds)
        self.url = (
            f"{settings.azure_openai_endpoint.rstrip('/')}/openai/deployments/"
            f"{settings.azure_openai_deployment}/chat/completions"
        )
        self.token = (
            None
            if settings.azure_openai_api_key
            else ManagedIdentityToken(self.http, settings.azure_client_id)
        )

    def _auth_headers(self) -> dict[str, str]:
        if self.settings.azure_openai_api_key:
            return {"api-key": self.settings.azure_openai_api_key}
        assert self.token is not None
        return {"Authorization": f"Bearer {self.token.get()}"}

    def complete(self, messages: list[Message]) -> str:
        payload = {"messages": messages, "max_tokens": self.settings.ai_max_output_tokens, "temperature": 0.3}
        try:
            res = self.http.post(
                self.url,
                params={"api-version": self.settings.azure_openai_api_version},
                json=payload,
                headers=self._auth_headers(),
            )
        except httpx.HTTPError as exc:
            log.warning("Azure OpenAI: brak odpowiedzi (%s)", type(exc).__name__)
            raise AssistantUnavailableError("Asystent AI jest chwilowo niedostępny.") from exc

        if res.status_code == 400 and _is_content_filter(res):
            raise AssistantRefusedError(
                "Asystent nie może odpowiedzieć na tę wiadomość. Sformułuj ją inaczej."
            )
        if res.status_code >= 400:
            # Tylko kod – treść odpowiedzi może zawierać fragmenty rozmowy.
            log.warning("Azure OpenAI: HTTP %s", res.status_code)
            raise AssistantUnavailableError("Asystent AI jest chwilowo niedostępny.")
        try:
            choice = res.json()["choices"][0]
            if choice.get("finish_reason") == "content_filter":
                raise AssistantRefusedError(
                    "Asystent nie może odpowiedzieć na tę wiadomość. Sformułuj ją inaczej."
                )
            content = (choice["message"]["content"] or "").strip()
        except (AttributeError, KeyError, IndexError, TypeError, ValueError) as exc:
            log.warning("Azure OpenAI: nieoczekiwany format odpowiedzi")
            raise AssistantUnavailableError("Asystent AI jest chwilowo niedostępny.") from exc
        if not content:
            raise AssistantUnavailableError("Asystent AI nie zwrócił odpowiedzi.")
        return content


def _is_content_filter(res: httpx.Response) -> bool:
    try:
        error = res.json().get("error")
        return isinstance(error, dict) and error.get("code") == "content_filter"
    except (AttributeError, ValueError):
        return False


_client: AiClient | None = None
_client_lock = threading.Lock()


def get_ai_client() -> AiClient:
    """Jeden klient na proces (wspólne połączenia i token); w testach podmieniany (dependency_overrides)."""
    global _client
    with _client_lock:
        if _client is None:
            settings = get_settings()
            _client = AzureOpenAIClient(settings) if settings.azure_openai_endpoint else DisabledClient()
        return _client

# /config – konfiguracje lokalne i środowiskowe

| Plik | Do czego |
|---|---|
| `docker-compose.yml` | Lokalny PostgreSQL 16 (odpowiednik bazy w Private Subnet B) |
| `nginx.conf` | Konfiguracja warstwy WEB: statyczny frontend + reverse proxy `/api` do backendu |

Zasady:
- Żadnych adresów, haseł ani kluczy w kodzie. Wszystko przez zmienne środowiskowe.
- Wzory zmiennych: `backend/.env.example`, `frontend/.env.example`.
- W Azure sekrety trzymamy w Key Vault / Container Apps secrets, a w GitHub Actions w Secrets (z OIDC).

# /config – konfiguracje lokalne i środowiskowe

| Plik | Do czego |
|---|---|
| `docker-compose.yml` | Lokalny PostgreSQL 16 (odpowiednik bazy w Private Subnet B) |
| `nginx.conf` | Konfiguracja warstwy WEB: statyczny frontend + reverse proxy `/api` do backendu (szablon z `${BACKEND_INTERNAL_URL}`) |
| `cloud-init-web.yaml` | Pierwsze uruchomienie VM w `snet-web`: Nginx, `envsubst`, usunięcie domyślnej strony |
| `package-web.sh` | Buduje frontend i pakuje go z `nginx.conf` i `deploy-web.sh` do `build/clouddesk-web.tar.gz` |
| `deploy-web.sh` | Uruchamiany na VM: wgrywa build, wstawia adres backendu, `nginx -t`, przeładowanie; przy błędzie przywraca poprzednią wersję |

Zasady:
- Żadnych adresów, haseł ani kluczy w kodzie. Wszystko przez zmienne środowiskowe.
- Wzory zmiennych: `backend/.env.example`, `frontend/.env.example`.
- W Azure sekrety trzymamy w Key Vault / Container Apps secrets, a w GitHub Actions w Secrets (z OIDC).

## Wdrożenie frontendu w warstwie WEB

Zmienne:

| Zmienna | Gdzie | Opis |
|---|---|---|
| `BACKEND_INTERNAL_URL` | VM w `snet-web` | Wewnętrzny adres backendu (ingress Container Apps w `snet-app`), np. `https://<nazwa>.internal.<środowisko>.azurecontainerapps.io`. Zapisywany w `/etc/clouddesk/web.env`. |

Kroki:

1. VM powstaje z `custom_data = filebase64("${path.module}/../config/cloud-init-web.yaml")`. Po starcie ma działający Nginx.
2. Lokalnie albo w CI: `config/package-web.sh` → `build/clouddesk-web.tar.gz`.
3. Archiwum trafia na VM i jest rozpakowywane do katalogu tymczasowego.
4. Na VM: `sudo BACKEND_INTERNAL_URL=<adres> ./deploy-web.sh`. Przy kolejnych wdrożeniach adres można pominąć, skrypt odczyta go z `/etc/clouddesk/web.env`.

Do zrobienia (Terraform, Mateusz):

- VM Linux (Ubuntu LTS) w `snet-web` z publicznym IP i `custom_data` jak wyżej;
- sposób dostarczenia archiwum na VM bez otwierania portu 22 na Internet, np. `az vm run-command`, Azure Bastion albo pobranie z Blob Storage przez managed identity (docelowo krok deployu w CI, Blok 08);
- wartość `BACKEND_INTERNAL_URL` jako output Terraformu, gdy powstanie środowisko Container Apps.

Sprawdzone lokalnie (Nginx 1.28 z pakietu Ubuntu): `nginx -t`, trasy SPA (`/tickets/3` → `index.html`), 404 dla brakujących plików w `/assets`, nagłówek cache dla plików z hashem, proxy `/api/...` z zachowaniem ścieżki i parametrów, przywracanie poprzedniej wersji przy błędnym adresie.

# /config – konfiguracje lokalne i środowiskowe

| Plik | Do czego |
|---|---|
| `docker-compose.yml` | Lokalny PostgreSQL 16 (odpowiednik bazy w Private Subnet B) |
| `nginx.conf` | Konfiguracja warstwy WEB: statyczny frontend + reverse proxy `/api` do backendu (szablon z `${BACKEND_INTERNAL_URL}`) |
| `package-web.sh` | Buduje frontend i pakuje go z `nginx.conf` i `deploy-web.sh` do `build/clouddesk-web.tar.gz` |
| `deploy-web.sh` | Uruchamiany na VM: wgrywa build do `/var/www/clouddesk`, instaluje `nginx.conf` jako stronę `clouddesk` z adresem backendu, `nginx -t`, przeładowanie; przy błędzie przywraca poprzednią wersję |

Zasady:
- Żadnych adresów, haseł ani kluczy w kodzie. Wszystko przez zmienne środowiskowe.
- Wzory zmiennych: `backend/.env.example`, `frontend/.env.example`.
- W Azure sekrety trzymamy w Key Vault / Container Apps secrets, a w GitHub Actions w Secrets (z OIDC).

## Wdrożenie frontendu w warstwie WEB

Zmienne:

| Zmienna | Gdzie | Opis |
|---|---|---|
| `BACKEND_INTERNAL_URL` | VM w `snet-web` | Wewnętrzny adres backendu (ingress Container Apps w `snet-app`), np. `https://<nazwa>.internal.<środowisko>.azurecontainerapps.io`. **Bez ścieżki i bez końcowego `/`**: inaczej `proxy_pass` utnie prefiks `/api`. Skrypt odrzuca taki adres. Zapisywany w `/etc/clouddesk/web.env`. |

Kroki:

1. VM `vm-web` stawia Terraform (`terraform/web.tf`, `terraform/cloud-init-web.yaml`, PR #41): Nginx z tymczasową stroną w `/var/www/clouddesk`.
2. Lokalnie albo w CI: `config/package-web.sh` → `build/clouddesk-web.tar.gz`.
3. Archiwum trafia na VM i jest rozpakowywane do katalogu tymczasowego. Port 22 jest zamknięty w NSG, więc przez `az vm run-command` (docelowo krok deployu w CI, Blok 08).
4. Na VM: `sudo BACKEND_INTERNAL_URL=<adres> ./deploy-web.sh`. Skrypt nadpisuje stronę tymczasową (`/etc/nginx/sites-available/clouddesk`). Przy kolejnych wdrożeniach adres można pominąć, skrypt odczyta go z `/etc/clouddesk/web.env`.

Do zrobienia (Terraform):

- wartość `BACKEND_INTERNAL_URL` jako output, gdy powstanie środowisko Container Apps.

Sprawdzone lokalnie (Nginx 1.28 z pakietu Ubuntu): `nginx -t`, nagłówki bezpieczeństwa także dla `/assets`, zastąpienie strony tymczasowej, odrzucenie adresu ze ścieżką, trasy SPA (`/tickets/3` → `index.html`), 404 dla brakujących plików w `/assets`, nagłówek cache dla plików z hashem, proxy `/api/...` z zachowaniem ścieżki i parametrów, przywracanie poprzedniej wersji przy błędnym adresie.

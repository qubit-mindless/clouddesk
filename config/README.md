# /config – konfiguracje lokalne i środowiskowe

| Plik | Do czego |
|---|---|
| `docker-compose.yml` | Lokalny PostgreSQL 16 (odpowiednik bazy w Private Subnet B) |
| `nginx.conf` | Docelowa konfiguracja warstwy WEB: 443 z certyfikatem TLS dla `${WEB_DOMAIN}`, port 80 tylko dla certbota i przekierowania 301 na HTTPS |
| `nginx-http.conf` | Konfiguracja przejściowa przed pierwszym certyfikatem (nowa VM): strona po HTTP + ścieżka `/.well-known/acme-challenge/` |
| `nginx-app.conf` | Wspólna część obu: statyczny frontend, nagłówki bezpieczeństwa (w tym HSTS), reverse proxy `/api` do backendu (`${BACKEND_INTERNAL_URL}`). Na VM: `/etc/nginx/snippets/clouddesk-app.conf` |
| `package-web.sh` | Buduje frontend i pakuje go z szablonami Nginx i `deploy-web.sh` do `build/clouddesk-web.tar.gz` (używa go też job `deploy-web` w CD) |
| `deploy-web.sh` | Uruchamiany na VM: wgrywa build do `/var/www/clouddesk`, instaluje konfigurację Nginx z adresem backendu i domeną, w razie potrzeby pobiera certyfikat (certbot), `nginx -t`, przeładowanie; przy błędzie przywraca poprzednią wersję |

Zasady:
- Żadnych adresów, haseł ani kluczy w kodzie. Wszystko przez zmienne środowiskowe.
- Wzory zmiennych: `backend/.env.example`, `frontend/.env.example`.
- W Azure sekrety trzymamy w Key Vault / Container Apps secrets, a w GitHub Actions w Secrets (z OIDC).

## Wdrożenie frontendu w warstwie WEB

Zmienne:

| Zmienna | Gdzie | Opis |
|---|---|---|
| `VITE_APP_VERSION` | build frontendu | SHA commita pokazywany w stopce strony (`data-testid="app-version"`). W CD ustawia go `deploy.yml`; bez niego stopka pokazuje `local`. |
| `BACKEND_INTERNAL_URL` | VM w `snet-web` | Wewnętrzny adres backendu (ingress Container Apps w `snet-app`), np. `https://<nazwa>.internal.<środowisko>.azurecontainerapps.io`. **Bez ścieżki i bez końcowego `/`**: inaczej `proxy_pass` utnie prefiks `/api`. Skrypt odrzuca taki adres. Zapisywany w `/etc/clouddesk/web.env`. |
| `WEB_DOMAIN` | VM w `snet-web` | Publiczna nazwa DNS VM (`clouddesk-qubit.polandcentral.cloudapp.azure.com`): na nią wystawiany jest certyfikat i na nią przekierowuje port 80. Sama nazwa, bez `https://`. W CD odczytywana z publicznego IP `pip-web`. Zapisywana w `/etc/clouddesk/web.env`. |

### Automatycznie (CD, `deploy.yml`)

Po zielonym CI na `main` i wdrożeniu backendu job `deploy-web`:

1. buduje paczkę `config/package-web.sh` z `VITE_APP_VERSION` = SHA commita;
2. loguje się do Azure przez OIDC i odczytuje adres backendu z Container Apps (`properties.configuration.ingress.fqdn`);
3. wysyła na `vm-web` przez `az vm run-command` skrypt z paczką osadzoną jako base64, który ją rozpakowuje i uruchamia `deploy-web.sh`. Run-command nie przekazuje kodu wyjścia, więc job sprawdza w wyjściu komunikat „Frontend wdrożony”. Skrypt z paczką ma ok. 125 KB; job przerywa wdrożenie powyżej 200 KB;
4. sprawdza z zewnątrz stronę (bundle zawiera SHA) i `/api/health` (pole `commit` = SHA, kilka prób na zimny start backendu). Wynik trafia do podsumowania przebiegu.

### Ręcznie

Kroki:

1. VM `vm-web` stawia Terraform (`terraform/web.tf`, `terraform/cloud-init-web.yaml`, PR #41): Nginx z tymczasową stroną w `/var/www/clouddesk`.
2. Lokalnie albo w CI: `config/package-web.sh` → `build/clouddesk-web.tar.gz`.
3. Archiwum trafia na VM i jest rozpakowywane do katalogu tymczasowego. Port 22 jest zamknięty w NSG, więc przez `az vm run-command` (tak samo robi to job `deploy-web`).
4. Na VM: `sudo BACKEND_INTERNAL_URL=<adres> WEB_DOMAIN=<nazwa DNS> ./deploy-web.sh`. Skrypt nadpisuje stronę tymczasową (`/etc/nginx/sites-available/clouddesk`). Przy kolejnych wdrożeniach oba adresy można pominąć, skrypt odczyta je z `/etc/clouddesk/web.env`.

## HTTPS (certyfikat Let's Encrypt)

- Certyfikat dla `WEB_DOMAIN` wystawia Let's Encrypt przez certbota na VM. Weryfikacja HTTP-01 idzie przez katalog `/var/www/letsencrypt`, który Nginx serwuje pod `/.well-known/acme-challenge/` na porcie 80.
- **Nowa VM:** `deploy-web.sh` najpierw stawia stronę po HTTP (`nginx-http.conf`), instaluje certbota, pobiera certyfikat i przełącza się na `nginx.conf`. Gdy certbot zawiedzie (np. limit Let's Encrypt), strona działa dalej po HTTP, a skrypt kończy się błędem, więc job `deploy-web` jest czerwony.
- **Odnawianie:** robi je timer `certbot.timer` z pakietu (dwa razy dziennie; odnawia na 30 dni przed wygaśnięciem). Po odnowieniu hook `systemctl reload nginx` wczytuje nowy certyfikat. Ręczny test: `sudo certbot renew --dry-run`.
- **TLS:** tylko 1.2 i 1.3. HSTS na rok (bez subdomen, bo domena należy do Azure).
- Bez adresu e-mail w koncie ACME: nie przekazujemy prywatnych adresów zespołu zewnętrznej usłudze.

HTTPS sprawdzone lokalnie w kontenerze Ubuntu 24.04 (Nginx 1.24, jak na VM; certbot i systemd jako atrapy): pierwsze wdrożenie (HTTP → certyfikat → HTTPS), nieudany certbot (strona zostaje po HTTP, kod błędu), przekierowanie 301 z zachowaniem ścieżki i parametrów, ścieżka ACME na porcie 80 bez przekierowania, HSTS i nagłówki także dla `/assets`, `/api` przez HTTPS, odrzucenie TLS 1.1, kolejne wdrożenie z `web.env` bez ponownego certbota, przywrócenie poprzedniej wersji po błędnym szablonie.

Wcześniej sprawdzone lokalnie (Nginx 1.28 z pakietu Ubuntu): `nginx -t`, nagłówki bezpieczeństwa także dla `/assets`, zastąpienie strony tymczasowej, odrzucenie adresu ze ścieżką, trasy SPA (`/tickets/3` → `index.html`), 404 dla brakujących plików w `/assets`, nagłówek cache dla plików z hashem, proxy `/api/...` z zachowaniem ścieżki i parametrów, przywracanie poprzedniej wersji przy błędnym adresie.

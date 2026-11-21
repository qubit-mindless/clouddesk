#!/usr/bin/env bash
# Wdrożenie frontendu na VM w snet-web. Uruchamiane jako root z katalogu rozpakowanego archiwum
# z package-web.sh:
#   sudo BACKEND_INTERNAL_URL=https://<wewnętrzny-adres-backendu> WEB_DOMAIN=<nazwa-DNS-VM> ./deploy-web.sh
# Oba adresy zapisujemy w /etc/clouddesk/web.env, więc kolejne wdrożenia mogą je pominąć.
# Ścieżki odpowiadają VM z terraform/cloud-init-web.yaml: nasza konfiguracja zastępuje stronę tymczasową.
#
# HTTPS (Blok 9): certyfikat Let's Encrypt dla WEB_DOMAIN pobiera certbot (wyzwanie HTTP-01 przez webroot).
#   - certyfikat jest → nginx.conf: 443 z TLS, port 80 tylko ACME + 301 na HTTPS;
#   - certyfikatu nie ma (nowa VM) → najpierw nginx-http.conf (strona po HTTP + ścieżka ACME),
#     certbot certonly, a po sukcesie przełączenie na nginx.conf. Gdy certbot zawiedzie, strona zostaje
#     po HTTP, a skrypt kończy się błędem (wdrożenie w CD jest czerwone).
# Odnawianie: timer certbota z pakietu (2× dziennie), po odnowieniu hook przeładowuje Nginx.
# Gdy nowa konfiguracja nie przejdzie `nginx -t`, przywracamy poprzednią wersję i kończymy błędem.
set -euo pipefail

src="$(cd "$(dirname "$0")" && pwd)"
env_file="${CLOUDDESK_ENV_FILE:-/etc/clouddesk/web.env}"
web_root="${WEB_ROOT:-/var/www/clouddesk}"
nginx_conf="${NGINX_CONF:-/etc/nginx/sites-available/clouddesk}"
nginx_enabled="${NGINX_ENABLED:-/etc/nginx/sites-enabled/clouddesk}"
# Te dwie ścieżki są wpisane na stałe w szablonach Nginx (include, root dla ACME).
nginx_snippet=/etc/nginx/snippets/clouddesk-app.conf
acme_root=/var/www/letsencrypt

# Wartości podane przy wywołaniu mają pierwszeństwo przed zapisanymi w web.env.
backend_arg="${BACKEND_INTERNAL_URL:-}"
domain_arg="${WEB_DOMAIN:-}"
if [[ -f "$env_file" ]]; then
  # shellcheck source=/dev/null
  source "$env_file"
fi
BACKEND_INTERNAL_URL="${backend_arg:-${BACKEND_INTERNAL_URL:-}}"
WEB_DOMAIN="${domain_arg:-${WEB_DOMAIN:-}}"

# Tylko schemat, host i ewentualnie port. Ścieżka albo końcowy "/" sprawiłyby, że proxy_pass
# obetnie prefiks /api i backend dostanie np. /tickets zamiast /api/tickets.
if [[ ! "$BACKEND_INTERNAL_URL" =~ ^https?://[A-Za-z0-9.-]+(:[0-9]+)?$ ]]; then
  echo "Błędny BACKEND_INTERNAL_URL: oczekiwany adres https://host[:port], bez ścieżki i końcowego \"/\"." >&2
  exit 1
fi
# Pełna nazwa DNS (co najmniej dwa człony), bez schematu i ścieżki – trafia do certyfikatu i przekierowania.
label='[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?'
if [[ ! "$WEB_DOMAIN" =~ ^$label(\.$label)+$ ]]; then
  echo "Błędny WEB_DOMAIN: oczekiwana nazwa DNS VM, np. <etykieta>.<region>.cloudapp.azure.com." >&2
  exit 1
fi
mkdir -p "$(dirname "$env_file")"
printf 'BACKEND_INTERNAL_URL=%q\nWEB_DOMAIN=%q\n' "$BACKEND_INTERNAL_URL" "$WEB_DOMAIN" > "$env_file"

# Kopia zapasowa bieżącej wersji na wypadek błędu.
backup="$(mktemp -d)"
trap 'rm -rf "$backup"' EXIT
[[ -d "$web_root" ]] && cp -a "$web_root" "$backup/html"
[[ -f "$nginx_conf" ]] && cp -a "$nginx_conf" "$backup/nginx.conf"
[[ -f "$nginx_snippet" ]] && cp -a "$nginx_snippet" "$backup/snippet.conf"

restore() {
  echo "Konfiguracja Nginx jest błędna, przywracam poprzednią wersję." >&2
  rm -rf "$web_root" "$nginx_conf" "$nginx_snippet"
  [[ -d "$backup/html" ]] && cp -a "$backup/html" "$web_root"
  [[ -f "$backup/snippet.conf" ]] && cp -a "$backup/snippet.conf" "$nginx_snippet"
  if [[ -f "$backup/nginx.conf" ]]; then
    cp -a "$backup/nginx.conf" "$nginx_conf"
  else
    rm -f "$nginx_enabled"
  fi
  # Nginx mógł już działać na nowej wersji (przełączenie na HTTPS jest drugim przeładowaniem).
  nginx -t && systemctl reload-or-restart nginx || true
  exit 1
}

# Podstawiamy tylko nasze zmienne; $uri, $scheme itd. muszą zostać dla Nginx.
render() { # szablon cel
  local text
  text="$(<"$1")"
  text="${text//'${BACKEND_INTERNAL_URL}'/$BACKEND_INTERNAL_URL}"
  text="${text//'${WEB_DOMAIN}'/$WEB_DOMAIN}"
  printf '%s\n' "$text" > "$2"
}

has_cert() {
  [[ -s "/etc/letsencrypt/live/$WEB_DOMAIN/fullchain.pem" && -s "/etc/letsencrypt/live/$WEB_DOMAIN/privkey.pem" ]]
}

mkdir -p "$(dirname "$nginx_conf")" "$(dirname "$nginx_enabled")" "$(dirname "$nginx_snippet")" "$acme_root"
render "$src/nginx-app.conf" "$nginx_snippet"
if has_cert; then
  render "$src/nginx.conf" "$nginx_conf"
else
  render "$src/nginx-http.conf" "$nginx_conf"
fi
ln -sfn "$nginx_conf" "$nginx_enabled"

rm -rf "$web_root"
mkdir -p "$web_root"
cp -r "$src/html/." "$web_root/"
chmod -R a+rX "$web_root"

nginx -t || restore

# Po nieudanym starcie (np. restart przy aktualizacji pakietów) systemd próbuje ponownie.
override=/etc/systemd/system/nginx.service.d/restart.conf
if [[ ! -f "$override" ]]; then
  mkdir -p "$(dirname "$override")"
  printf '[Unit]\nStartLimitIntervalSec=0\n\n[Service]\nRestart=on-failure\nRestartSec=10s\n' > "$override"
  systemctl daemon-reload
fi

systemctl reload-or-restart nginx   # start, jeśli Nginx stał (np. po nieudanym restarcie)

if ! has_cert; then
  echo "Brak certyfikatu dla $WEB_DOMAIN – pobieram go z Let's Encrypt."
  if ! command -v certbot >/dev/null; then
    # Lock::Timeout: unattended-upgrades może akurat trzymać blokadę dpkg.
    apt-get -o DPkg::Lock::Timeout=300 update -q
    DEBIAN_FRONTEND=noninteractive apt-get -o DPkg::Lock::Timeout=300 install -y -q certbot
  fi
  # Bez adresu e-mail: nie przekazujemy prywatnych adresów zespołu zewnętrznej usłudze
  # (Let's Encrypt i tak nie wysyła już przypomnień o wygasaniu – odnawia timer certbota).
  # --cert-name: certyfikat zawsze w live/$WEB_DOMAIN/ (bez przyrostków -0001), tam szuka go nginx.conf.
  # --deploy-hook zapisuje się w konfiguracji odnowień: po każdym nowym certyfikacie Nginx się przeładuje.
  if ! certbot certonly --webroot -w "$acme_root" -d "$WEB_DOMAIN" --cert-name "$WEB_DOMAIN" \
      --non-interactive --agree-tos --register-unsafely-without-email \
      --deploy-hook "systemctl reload nginx"; then
    echo "Nie udało się pobrać certyfikatu dla $WEB_DOMAIN – strona działa dalej po HTTP." >&2
    exit 1
  fi
  render "$src/nginx.conf" "$nginx_conf"
  if ! nginx -t; then
    # Nowy frontend już działa po HTTP – zostawiamy go i wracamy tylko do konfiguracji bez TLS.
    echo "Konfiguracja HTTPS jest błędna – strona zostaje po HTTP." >&2
    render "$src/nginx-http.conf" "$nginx_conf"
    nginx -t && systemctl reload nginx
    exit 1
  fi
  systemctl reload nginx
fi

echo "Frontend wdrożony: https://$WEB_DOMAIN, backend: $BACKEND_INTERNAL_URL"

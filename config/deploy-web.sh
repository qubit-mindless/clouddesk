#!/usr/bin/env bash
# Wdrożenie frontendu na VM w snet-web. Uruchamiane jako root z katalogu rozpakowanego archiwum
# z package-web.sh:
#   sudo BACKEND_INTERNAL_URL=https://<wewnętrzny-adres-backendu> ./deploy-web.sh
# Adres backendu zapisujemy w /etc/clouddesk/web.env, więc kolejne wdrożenia mogą go pominąć.
# Ścieżki odpowiadają VM z terraform/cloud-init-web.yaml: nasza konfiguracja zastępuje stronę tymczasową.
# Gdy nowa konfiguracja nie przejdzie `nginx -t`, przywracamy poprzednią wersję i kończymy błędem.
set -euo pipefail

src="$(cd "$(dirname "$0")" && pwd)"
env_file="${CLOUDDESK_ENV_FILE:-/etc/clouddesk/web.env}"
web_root="${WEB_ROOT:-/var/www/clouddesk}"
nginx_conf="${NGINX_CONF:-/etc/nginx/sites-available/clouddesk}"
nginx_enabled="${NGINX_ENABLED:-/etc/nginx/sites-enabled/clouddesk}"

if [[ -z "${BACKEND_INTERNAL_URL:-}" && -f "$env_file" ]]; then
  # shellcheck source=/dev/null
  source "$env_file"
fi
# Tylko schemat, host i ewentualnie port. Ścieżka albo końcowy "/" sprawiłyby, że proxy_pass
# obetnie prefiks /api i backend dostanie np. /tickets zamiast /api/tickets.
if [[ ! "${BACKEND_INTERNAL_URL:-}" =~ ^https?://[A-Za-z0-9.-]+(:[0-9]+)?$ ]]; then
  echo "Błędny BACKEND_INTERNAL_URL: oczekiwany adres https://host[:port], bez ścieżki i końcowego \"/\"." >&2
  exit 1
fi
mkdir -p "$(dirname "$env_file")"
printf 'BACKEND_INTERNAL_URL=%q\n' "$BACKEND_INTERNAL_URL" > "$env_file"

# Kopia zapasowa bieżącej wersji na wypadek błędu.
backup="$(mktemp -d)"
trap 'rm -rf "$backup"' EXIT
[[ -d "$web_root" ]] && cp -a "$web_root" "$backup/html"
[[ -f "$nginx_conf" ]] && cp -a "$nginx_conf" "$backup/nginx.conf"

restore() {
  echo "Konfiguracja Nginx jest błędna, przywracam poprzednią wersję." >&2
  rm -rf "$web_root" "$nginx_conf"
  [[ -d "$backup/html" ]] && cp -a "$backup/html" "$web_root"
  if [[ -f "$backup/nginx.conf" ]]; then
    cp -a "$backup/nginx.conf" "$nginx_conf"
  else
    rm -f "$nginx_enabled"
  fi
  exit 1
}

# Podstawiamy tylko naszą zmienną; $uri, $scheme itd. muszą zostać dla Nginx.
template="$(<"$src/nginx.conf")"
mkdir -p "$(dirname "$nginx_conf")" "$(dirname "$nginx_enabled")"
printf '%s\n' "${template//'${BACKEND_INTERNAL_URL}'/$BACKEND_INTERNAL_URL}" > "$nginx_conf"
ln -sfn "$nginx_conf" "$nginx_enabled"

rm -rf "$web_root"
mkdir -p "$web_root"
cp -r "$src/html/." "$web_root/"
chmod -R a+rX "$web_root"

nginx -t || restore
systemctl reload nginx
echo "Frontend wdrożony, backend: $BACKEND_INTERNAL_URL"

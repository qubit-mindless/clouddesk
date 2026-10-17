#!/usr/bin/env bash
# Wdrożenie frontendu na VM w snet-web. Uruchamiane jako root z katalogu rozpakowanego archiwum
# z package-web.sh:
#   sudo BACKEND_INTERNAL_URL=https://<wewnętrzny-adres-backendu> ./deploy-web.sh
# Adres backendu zapisujemy w /etc/clouddesk/web.env, więc kolejne wdrożenia mogą go pominąć.
# Gdy nowa konfiguracja nie przejdzie `nginx -t`, przywracamy poprzednią wersję i kończymy błędem.
set -euo pipefail

src="$(cd "$(dirname "$0")" && pwd)"
env_file="${CLOUDDESK_ENV_FILE:-/etc/clouddesk/web.env}"
web_root="${WEB_ROOT:-/usr/share/nginx/html}"
nginx_conf="${NGINX_CONF:-/etc/nginx/conf.d/clouddesk.conf}"

if [[ -z "${BACKEND_INTERNAL_URL:-}" && -f "$env_file" ]]; then
  # shellcheck source=/dev/null
  source "$env_file"
fi
if [[ ! "${BACKEND_INTERNAL_URL:-}" =~ ^https?:// ]]; then
  echo "Brak BACKEND_INTERNAL_URL (oczekiwany adres http:// lub https://)." >&2
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
  [[ -f "$backup/nginx.conf" ]] && cp -a "$backup/nginx.conf" "$nginx_conf"
  exit 1
}

# Podstawiamy tylko naszą zmienną; $uri, $scheme itd. muszą zostać dla Nginx.
mkdir -p "$(dirname "$nginx_conf")"
BACKEND_INTERNAL_URL="$BACKEND_INTERNAL_URL" envsubst '${BACKEND_INTERNAL_URL}' < "$src/nginx.conf" > "$nginx_conf"

rm -rf "$web_root"
mkdir -p "$web_root"
cp -r "$src/html/." "$web_root/"
chmod -R a+rX "$web_root"

nginx -t || restore
systemctl reload nginx
echo "Frontend wdrożony, backend: $BACKEND_INTERNAL_URL"

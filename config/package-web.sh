#!/usr/bin/env bash
# Buduje frontend i pakuje wszystko, czego potrzebuje VM w snet-web, do jednego archiwum:
#   html/          zbudowany React (frontend/dist)
#   nginx.conf     szablon konfiguracji z ${BACKEND_INTERNAL_URL}
#   deploy-web.sh  skrypt wdrożenia uruchamiany na VM
# Użycie: config/package-web.sh [plik_wyjściowy]   (domyślnie build/clouddesk-web.tar.gz)
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
out="${1:-$repo_root/build/clouddesk-web.tar.gz}"

cd "$repo_root/frontend"
npm ci
npm run build

staging="$(mktemp -d)"
trap 'rm -rf "$staging"' EXIT
cp -r "$repo_root/frontend/dist" "$staging/html"
cp "$repo_root/config/nginx.conf" "$repo_root/config/deploy-web.sh" "$staging/"

mkdir -p "$(dirname "$out")"
tar -czf "$out" -C "$staging" html nginx.conf deploy-web.sh
echo "Gotowe: $out"

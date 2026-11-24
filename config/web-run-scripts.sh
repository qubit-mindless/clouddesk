#!/usr/bin/env bash
# Dzieli paczkę frontendu na skrypty dla `az vm run-command invoke` – każdy mieści się w limicie treści skryptu.
# Port 22 jest zamknięty, więc paczka jedzie na VM w treści skryptów (base64), kawałek po kawałku:
#   run-000.sh … run-(N-2).sh  dopisują kolejne kawałki base64 do pliku w /var/tmp na VM,
#   run-(N-1).sh               dopisuje ostatni kawałek, sprawdza SHA-256 złożonej paczki, rozpakowuje ją
#                              i uruchamia deploy-web.sh (koniec: „Frontend wdrożony…”).
# Skrypty są w czystym sh i uruchamia się je po kolei, w kolejności nazw.
# Generowanie wymaga GNU coreutils (base64 -w, split -d, sha256sum) – działa w CI (Ubuntu), nie na macOS.
#
# Użycie: config/web-run-scripts.sh <paczka.tar.gz> <katalog_wyjściowy> <BACKEND_INTERNAL_URL> <WEB_DOMAIN> <sha_commita>
# LINES_PER_PART (domyślnie 1900 linii × 77 B ≈ 146 kB base64 na skrypt) – tylko do testów podziału
# (np. w kontenerze ubuntu:24.04); pipeline go nie ustawia.
set -euo pipefail

pkg="$1" out="$2" backend="$3" domain="$4" id="$5"
lines_per_part="${LINES_PER_PART:-1900}"

# Wartości trafiają do skryptu uruchamianego jako root – tylko bezpieczne znaki.
[[ "$backend" =~ ^https://[A-Za-z0-9.-]+$ ]] || { echo "Nieprawidłowy BACKEND_INTERNAL_URL: '$backend'." >&2; exit 1; }
[[ "$domain" =~ ^[A-Za-z0-9.-]+$ ]] || { echo "Nieprawidłowy WEB_DOMAIN: '$domain'." >&2; exit 1; }
[[ "$id" =~ ^[0-9a-f]{7,40}$ ]] || { echo "Nieprawidłowy identyfikator wdrożenia: '$id'." >&2; exit 1; }
[[ "$lines_per_part" =~ ^[1-9][0-9]*$ ]] || { echo "Nieprawidłowe LINES_PER_PART: '$lines_per_part'." >&2; exit 1; }

sum="$(sha256sum "$pkg" | cut -d' ' -f1)"
remote="/var/tmp/clouddesk-web-$id.b64"

mkdir -p "$out"
rm -f "$out"/part-* "$out"/run-*.sh
base64 -w 76 "$pkg" | split -l "$lines_per_part" -d -a 3 - "$out/part-"
parts=("$out"/part-*)
n="${#parts[@]}"

for i in "${!parts[@]}"; do
  script="$out/run-$(printf '%03d' "$i").sh"
  {
    echo 'set -eu'
    echo "remote='$remote'"
    # Ostatni skrypt sprząta po sobie zawsze – także gdy padnie już przy dopisywaniu kawałka.
    if (( i == n - 1 )); then
      cat <<'EOF'
trap 'rm -f "$remote"; if [ -n "${dir:-}" ]; then rm -rf "$dir"; fi' EXIT
EOF
    fi
    # Pierwszy kawałek: nowy plik dla tego wdrożenia i sprzątanie pozostałości po przerwanych wdrożeniach
    # sprzed ponad godziny (świeższych nie ruszamy – mogą należeć do wdrożenia, które właśnie trwa).
    if (( i == 0 )); then
      cat <<'EOF'
rm -f "$remote"
find /var/tmp -maxdepth 1 -name 'clouddesk-web-*.b64' -mmin +60 -delete
EOF
    fi
    # umask tylko dla pliku z kawałkami (root-only). Nie może przejść do deploy-web.sh, który tworzy pliki
    # i katalogi czytane przez Nginx (np. /var/www/letsencrypt).
    echo "(umask 077; cat >> \"\$remote\") <<'CHUNK'"
    cat "${parts[$i]}"
    echo 'CHUNK'
    if (( i < n - 1 )); then
      echo "echo 'Część $((i + 1))/$n zapisana'"
    else
      echo 'dir="$(mktemp -d)"'
      echo 'base64 -d "$remote" > "$dir/web.tar.gz"'
      # Paczka złożona z kawałków musi być identyczna z tą zbudowaną w CI.
      echo "echo '$sum  '\"\$dir/web.tar.gz\" | sha256sum -c --quiet - || { echo 'Suma SHA-256 paczki się nie zgadza.' >&2; exit 1; }"
      echo 'tar -xzf "$dir/web.tar.gz" -C "$dir"'
      echo "BACKEND_INTERNAL_URL='$backend' WEB_DOMAIN='$domain' bash \"\$dir/deploy-web.sh\""
    fi
  } > "$script"
  rm -f "${parts[$i]}"
done

echo "Paczka $(stat -c %s "$pkg") B → $n skrypt(y) run-command w $out"

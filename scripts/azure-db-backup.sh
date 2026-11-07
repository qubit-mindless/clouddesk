#!/usr/bin/env bash
# Kopie bazy w Azure (zadanie caj-clouddesk-backup → udział Azure Files db-backups w rg-clouddesk-backup).
#   scripts/azure-db-backup.sh run                  – zrób kopię teraz (poza harmonogramem 02:00 UTC)
#   scripts/azure-db-backup.sh list                 – lista kopii w udziale
#   scripts/azure-db-backup.sh download [plik] [katalog]
#                                                   – pobierz kopię (domyślnie najnowszą) poza Azure
#   scripts/azure-db-backup.sh restore <plik>       – przywróć bazę w Azure z kopii (nadpisuje dane!)
# Wymaga: az login, jq; run/restore – Contributor na rg-clouddesk; list/download – odczyt kluczy konta kopii.
set -euo pipefail

rg="${RG:-rg-clouddesk}"
backup_rg="${BACKUP_RG:-rg-clouddesk-backup}"
job="${JOB:-caj-clouddesk-backup}"
share="db-backups"

account="$(az storage account list -g "$backup_rg" --query "[0].name" -o tsv)"
storage_key() { az storage account keys list -g "$backup_rg" -n "$account" --query "[0].value" -o tsv; }

latest() {
  az storage file list --account-name "$account" --account-key "$(storage_key)" --share-name "$share" \
    --query "sort_by([?ends_with(name, '.dump')], &name)[-1].name" -o tsv
}

# Uruchamia zadanie i czeka na wynik. Z argumentem – nadpisuje polecenie kontenera (jak scripts/azure-migrate.sh).
start_job() {
  local job_id execution status url="https://management.azure.com"
  job_id="$(az containerapp job show -g "$rg" -n "$job" --query id -o tsv)"
  if [[ -n "${1:-}" ]]; then
    local image body
    image="$(az containerapp job show -g "$rg" -n "$job" --query 'properties.template.containers[0].image' -o tsv)"
    # jq składa JSON, bo polecenie zawiera cudzysłowy.
    body="$(jq -n --arg image "$image" --arg cmd "$1" '{containers: [{name: "backup", image: $image,
      command: ["sh", "-c", $cmd], env: [{name: "DATABASE_URL", secretRef: "database-url"}],
      resources: {cpu: 0.25, memory: "0.5Gi"}, volumeMounts: [{volumeName: "backups", mountPath: "/backups"}]}]}')"
    execution="$(az rest --method post --url "$url${job_id}/start?api-version=2024-03-01" --body "$body" --query name -o tsv)"
  else
    execution="$(az rest --method post --url "$url${job_id}/start?api-version=2024-03-01" --query name -o tsv)"
  fi
  echo "Uruchomiono: $execution"
  for _ in $(seq 1 90); do
    status="$(az containerapp job execution show -g "$rg" -n "$job" --job-execution-name "$execution" \
      --query properties.status -o tsv)"
    case "$status" in
      Succeeded) echo "Zakończone powodzeniem."; return 0 ;;
      Failed) echo "Nie powiodło się – logi: Log Analytics → ContainerAppConsoleLogs_CL." >&2; return 1 ;;
    esac
    sleep 10
  done
  echo "Przekroczono czas oczekiwania (status: $status)." >&2
  return 1
}

case "${1:-}" in
  run)
    start_job
    ;;
  list)
    az storage file list --account-name "$account" --account-key "$(storage_key)" --share-name "$share" \
      --query "sort_by([?ends_with(name, '.dump')], &name)[].{plik:name, bajty:properties.contentLength}" -o table
    ;;
  download)
    file="${2:-$(latest)}"
    dir="${3:-$HOME/clouddesk-backups}"
    [[ -n "$file" ]] || { echo "Brak kopii w udziale." >&2; exit 1; }
    mkdir -p "$dir"
    az storage file download --account-name "$account" --account-key "$(storage_key)" --share-name "$share" \
      --path "$file" --dest "$dir/$file" -o none
    echo "Pobrano: $dir/$file"
    ;;
  restore)
    file="${2:?Podaj nazwę pliku kopii (scripts/azure-db-backup.sh list).}"
    [[ "$file" =~ ^clouddesk-[0-9]{8}T[0-9]{6}Z\.dump$ ]] || { echo "Nieprawidłowa nazwa pliku: $file" >&2; exit 1; }
    read -r -p "Przywrócić bazę w Azure z $file? Obecne dane zostaną nadpisane. [tak/N] " answer
    [[ "$answer" == "tak" ]] || { echo "Przerwano."; exit 1; }
    start_job "url=\$(printf '%s' \"\$DATABASE_URL\" | sed 's/+psycopg//') && pg_restore --clean --if-exists --no-owner --no-acl --dbname=\"\$url\" /backups/$file && echo Przywrócono: $file"
    ;;
  *)
    sed -n '2,8p' "$0"
    exit 1
    ;;
esac

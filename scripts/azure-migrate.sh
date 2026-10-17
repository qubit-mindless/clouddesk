#!/usr/bin/env bash
# Uruchamia migracje bazy w Azure (zadanie Container Apps caj-clouddesk-migrate) i czeka na wynik.
#   scripts/azure-migrate.sh          – alembic upgrade head
#   scripts/azure-migrate.sh --seed   – migracje + dane przykładowe (seed jest idempotentny)
# Wymaga: az login, rola co najmniej Contributor na rg-clouddesk.
set -euo pipefail

rg="${RG:-rg-clouddesk}"
job="${JOB:-caj-clouddesk-migrate}"
cmd="alembic upgrade head"
[[ "${1:-}" == "--seed" ]] && cmd="$cmd && python -m app.db.seed"

job_id="$(az containerapp job show -g "$rg" -n "$job" --query id -o tsv)"
image="$(az containerapp job show -g "$rg" -n "$job" --query 'properties.template.containers[0].image' -o tsv)"

# `az containerapp job start --args` nie przyjmuje argumentów zaczynających się od "-", dlatego
# nadpisanie polecenia idzie przez API. Lista containers zastępuje szablon, więc powtarzamy env z sekretem.
body="$(cat <<JSON
{"containers":[{"name":"migrate","image":"$image","command":["sh","-c","$cmd && alembic current"],
 "env":[{"name":"DATABASE_URL","secretRef":"database-url"}],"resources":{"cpu":0.25,"memory":"0.5Gi"}}]}
JSON
)"
execution="$(az rest --method post --url "https://management.azure.com${job_id}/start?api-version=2024-03-01" \
  --body "$body" --query name -o tsv)"
echo "Uruchomiono: $execution ($cmd)"

for _ in $(seq 1 60); do
  status="$(az containerapp job execution show -g "$rg" -n "$job" --job-execution-name "$execution" \
    --query properties.status -o tsv)"
  case "$status" in
    Succeeded) echo "Migracje zakończone powodzeniem."; exit 0 ;;
    Failed) echo "Migracje nie powiodły się – logi: Log Analytics → ContainerAppConsoleLogs_CL." >&2; exit 1 ;;
  esac
  sleep 10
done
echo "Przekroczono czas oczekiwania (status: $status)." >&2
exit 1

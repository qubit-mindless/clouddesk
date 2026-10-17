#!/usr/bin/env bash
# Jednorazowe przygotowanie zdalnego stanu Terraforma (backend azurerm).
# Tworzy osobną grupę zasobów z kontem Storage i kontenerem "tfstate".
# Uruchamia PM/DevOps po `az login`. Skrypt jest idempotentny.
set -euo pipefail

LOCATION="${LOCATION:-polandcentral}"
RG="${TFSTATE_RG:-rg-clouddesk-tfstate}"
CONTAINER="tfstate"

az group create --name "$RG" --location "$LOCATION" \
  --tags project=clouddesk purpose=tfstate -o none

# Nazwa konta Storage musi być globalnie unikalna: bierzemy istniejące albo tworzymy nowe.
SA=$(az storage account list -g "$RG" --query "[0].name" -o tsv)
if [ -z "$SA" ]; then
  SA="stclouddesktf$(openssl rand -hex 3)"
  az storage account create --name "$SA" --resource-group "$RG" --location "$LOCATION" \
    --sku Standard_LRS --kind StorageV2 --min-tls-version TLS1_2 \
    --allow-blob-public-access false --https-only true \
    --tags project=clouddesk purpose=tfstate -o none
fi

az storage account blob-service-properties update --account-name "$SA" --resource-group "$RG" \
  --enable-versioning true -o none
az storage container create --name "$CONTAINER" --account-name "$SA" --auth-mode login -o none

cat <<OUT
Gotowe. Wpisz do terraform/backend.hcl:
resource_group_name  = "$RG"
storage_account_name = "$SA"
container_name       = "$CONTAINER"
key                  = "clouddesk.tfstate"
use_azuread_auth     = true
OUT

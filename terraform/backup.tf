# Kopia bazy: codzienny pg_dump jako zadanie Container Apps zapisujące plik do udziału Azure Files.
#   scripts/azure-db-backup.sh run|list|download|restore
# Kopie leżą w osobnej grupie zasobów z blokadą usunięcia, więc przetrwają usunięcie rg-clouddesk
# (incydent 27.10.2026). Przed usunięciem całej subskrypcji chroni tylko kopia pobrana poza Azure (download).

resource "azurerm_resource_group" "backup" {
  name     = "rg-${var.prefix}-backup"
  location = var.location
  tags     = local.tags
}

resource "azurerm_storage_account" "backup" {
  name                            = "st${var.prefix}bk${random_string.suffix.result}"
  resource_group_name             = azurerm_resource_group.backup.name
  location                        = azurerm_resource_group.backup.location
  account_tier                    = "Standard"
  account_replication_type        = "LRS"
  min_tls_version                 = "TLS1_2"
  https_traffic_only_enabled      = true
  allow_nested_items_to_be_public = false
  # Montowanie Azure Files w Container Apps wymaga klucza konta (SMB); klucz zna tylko środowisko CAE.
  shared_access_key_enabled = true
  tags                      = local.tags

  share_properties {
    retention_policy {
      days = 7 # kosz udziału: usunięty plik da się przywrócić przez 7 dni
    }
  }
}

resource "azurerm_storage_share" "backup" {
  name               = "db-backups"
  storage_account_id = azurerm_storage_account.backup.id
  quota              = 5
}

# CanNotDelete: grupy, konta ani udziału nie da się usunąć bez wcześniejszego zdjęcia blokady
# (terraform destroy też się zatrzyma – to celowe).
resource "azurerm_management_lock" "backup" {
  name       = "lock-${var.prefix}-backup"
  scope      = azurerm_resource_group.backup.id
  lock_level = "CanNotDelete"
  notes      = "Kopie bazy CloudDesk. Usunięcie tylko po uzgodnieniu w zespole."

  depends_on = [azurerm_storage_share.backup]
}

resource "azurerm_container_app_environment_storage" "backup" {
  name                         = "db-backups"
  container_app_environment_id = azurerm_container_app_environment.main.id
  account_name                 = azurerm_storage_account.backup.name
  share_name                   = azurerm_storage_share.backup.name
  access_key                   = azurerm_storage_account.backup.primary_access_key
  access_mode                  = "ReadWrite"
}

resource "azurerm_container_app_job" "backup" {
  name                         = "caj-${var.prefix}-backup"
  location                     = azurerm_resource_group.main.location
  resource_group_name          = azurerm_resource_group.main.name
  container_app_environment_id = azurerm_container_app_environment.main.id
  workload_profile_name        = "Consumption"
  replica_timeout_in_seconds   = 900
  replica_retry_limit          = 1
  tags                         = local.tags

  schedule_trigger_config {
    cron_expression          = "0 2 * * *" # codziennie 02:00 UTC
    parallelism              = 1
    replica_completion_count = 1
  }

  # Ta sama tożsamość co backend: jedyne, co potrzebne, to odczyt DATABASE_URL z Key Vault.
  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.backend.id]
  }

  secret {
    name                = "database-url"
    key_vault_secret_id = azurerm_key_vault_secret.database_url.versionless_id
    identity            = azurerm_user_assigned_identity.backend.id
  }

  template {
    volume {
      name         = "backups"
      storage_type = "AzureFile"
      storage_name = azurerm_container_app_environment_storage.backup.name
    }

    container {
      name   = "backup"
      image  = var.backup_image
      cpu    = 0.25
      memory = "0.5Gi"
      # DATABASE_URL jest w formacie SQLAlchemy (postgresql+psycopg://…); pg_dump potrzebuje postgresql://…
      # Plik powstaje jako .part i dostaje docelową nazwę dopiero po udanym zrzucie.
      command = ["sh", "-c", <<-SH
        set -eu
        url=$(printf '%s' "$DATABASE_URL" | sed 's/+psycopg//')
        f="/backups/clouddesk-$(date -u +%Y%m%dT%H%M%SZ).dump"
        pg_dump --format=custom --no-owner --no-acl --dbname="$url" --file="$f.part"
        mv "$f.part" "$f"
        find /backups -name 'clouddesk-*.dump' -mtime +"$RETENTION_DAYS" -print -delete
        ls -l /backups
      SH
      ]

      env {
        name        = "DATABASE_URL"
        secret_name = "database-url"
      }
      env {
        name  = "RETENTION_DAYS"
        value = tostring(var.backup_retention_days)
      }

      volume_mounts {
        name = "backups"
        path = "/backups"
      }
    }
  }

  depends_on = [azurerm_role_assignment.backend_kv]
}

# Migracje bazy (Alembic) jako jednorazowe zadanie Container Apps, uruchamiane ręcznie po wdrożeniu nowego obrazu:
#   scripts/azure-migrate.sh          – alembic upgrade head
#   scripts/azure-migrate.sh --seed   – migracje + dane przykładowe
# Ten sam obraz, tożsamość i DATABASE_URL z Key Vault co backend; działa w snet-app, więc ma dostęp do bazy (nsg-db).

resource "azurerm_container_app_job" "migrate" {
  name                         = "caj-${var.prefix}-migrate"
  location                     = azurerm_resource_group.main.location
  resource_group_name          = azurerm_resource_group.main.name
  container_app_environment_id = azurerm_container_app_environment.main.id
  workload_profile_name        = "Consumption"
  replica_timeout_in_seconds   = 600
  replica_retry_limit          = 0
  tags                         = local.tags

  manual_trigger_config {
    parallelism              = 1
    replica_completion_count = 1
  }

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
    container {
      name    = "migrate"
      image   = var.backend_image
      cpu     = 0.25
      memory  = "0.5Gi"
      command = ["alembic", "upgrade", "head"]

      env {
        name        = "DATABASE_URL"
        secret_name = "database-url"
      }
    }
  }

  depends_on = [azurerm_role_assignment.backend_kv]
}

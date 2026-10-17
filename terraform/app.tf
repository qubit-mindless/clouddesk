# Warstwa APP: środowisko Container Apps w podsieci snet-app, tylko z wewnętrznym load balancerem.
# Backend nie ma publicznego adresu – dostaje się do niego wyłącznie Nginx z snet-web.
# Tylko profil Consumption: bez planu Dedicated, Private Endpointa i okien serwisowych, więc bez stałej opłaty
# za środowisko (płacimy za użycie ponad darmową pulę: 180 tys. vCPU-s, 360 tys. GiB-s, 2 mln żądań/mies.).

resource "azurerm_log_analytics_workspace" "main" {
  name                = "log-${var.prefix}"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  sku                 = "PerGB2018"
  retention_in_days   = 30
  # Limit dzienny trzyma logi w darmowej puli 5 GB/mies.
  daily_quota_gb = 0.15
  tags           = local.tags
}

resource "azurerm_container_app_environment" "main" {
  name                               = "cae-${var.prefix}"
  location                           = azurerm_resource_group.main.location
  resource_group_name                = azurerm_resource_group.main.name
  log_analytics_workspace_id         = azurerm_log_analytics_workspace.main.id
  infrastructure_subnet_id           = azurerm_subnet.app.id
  infrastructure_resource_group_name = "rg-${var.prefix}-cae-infra"
  internal_load_balancer_enabled     = true
  tags                               = local.tags

  workload_profile {
    name                  = "Consumption"
    workload_profile_type = "Consumption"
  }
}

# Prywatna strefa DNS dla domeny środowiska: VM w snet-web rozwiązuje adres backendu na wewnętrzny IP.
resource "azurerm_private_dns_zone" "app" {
  name                = azurerm_container_app_environment.main.default_domain
  resource_group_name = azurerm_resource_group.main.name
  tags                = local.tags
}

resource "azurerm_private_dns_a_record" "app_wildcard" {
  name                = "*"
  zone_name           = azurerm_private_dns_zone.app.name
  resource_group_name = azurerm_resource_group.main.name
  ttl                 = 300
  records             = [azurerm_container_app_environment.main.static_ip_address]
}

resource "azurerm_private_dns_zone_virtual_network_link" "app" {
  name                  = "link-${var.prefix}-app"
  resource_group_name   = azurerm_resource_group.main.name
  private_dns_zone_name = azurerm_private_dns_zone.app.name
  virtual_network_id    = azurerm_virtual_network.main.id
  registration_enabled  = false
  tags                  = local.tags
}

# Tożsamość backendu: czyta sekrety z Key Vault. Tożsamość przypisana przez użytkownika, bo rola musi
# istnieć, zanim Container Apps pierwszy raz pobierze sekret.
resource "azurerm_user_assigned_identity" "backend" {
  name                = "id-${var.prefix}-backend"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  tags                = local.tags
}

resource "azurerm_role_assignment" "backend_kv" {
  scope                = azurerm_key_vault.main.id
  role_definition_name = "Key Vault Secrets User"
  principal_id         = azurerm_user_assigned_identity.backend.principal_id
}

resource "azurerm_key_vault_secret" "database_url" {
  name         = "database-url"
  value        = "postgresql+psycopg://${var.db_admin_login}:${random_password.db_admin.result}@${azurerm_postgresql_flexible_server.main.fqdn}:5432/${azurerm_postgresql_flexible_server_database.app.name}?sslmode=require"
  key_vault_id = azurerm_key_vault.main.id
  content_type = "SQLAlchemy URL dla backendu"

  depends_on = [azurerm_role_assignment.kv_deployer]
}

resource "azurerm_container_app" "backend" {
  name                         = "ca-${var.prefix}-backend"
  container_app_environment_id = azurerm_container_app_environment.main.id
  resource_group_name          = azurerm_resource_group.main.name
  revision_mode                = "Single"
  workload_profile_name        = "Consumption"
  tags                         = local.tags

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.backend.id]
  }

  secret {
    name                = "database-url"
    key_vault_secret_id = azurerm_key_vault_secret.database_url.versionless_id
    identity            = azurerm_user_assigned_identity.backend.id
  }

  ingress {
    # „external” w środowisku z wewnętrznym LB oznacza: dostępny w VNet, nie z Internetu.
    external_enabled = true
    target_port      = var.backend_port
    transport        = "auto"

    traffic_weight {
      latest_revision = true
      percentage      = 100
    }
  }

  template {
    min_replicas = 0
    max_replicas = 2

    container {
      name   = "backend"
      image  = var.backend_image
      cpu    = 0.25
      memory = "0.5Gi"

      env {
        name  = "APP_ENV"
        value = "azure"
      }
      env {
        name        = "DATABASE_URL"
        secret_name = "database-url"
      }
      env {
        name  = "CORS_ORIGINS"
        value = "http://${azurerm_public_ip.web.fqdn},https://${azurerm_public_ip.web.fqdn}"
      }
    }
  }

  depends_on = [azurerm_role_assignment.backend_kv]
}

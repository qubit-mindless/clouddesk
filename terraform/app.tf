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

# Klucz podpisu tokenów JWT (HMAC) – generowany raz, trzymany tylko w Key Vault i stanie Terraform.
resource "random_password" "jwt_secret" {
  length  = 64
  special = false
}

resource "azurerm_key_vault_secret" "jwt_secret" {
  name         = "jwt-secret"
  value        = random_password.jwt_secret.result
  key_vault_id = azurerm_key_vault.main.id
  content_type = "Klucz HMAC do podpisu JWT backendu"

  depends_on = [azurerm_role_assignment.kv_deployer]
}

# Wspólne hasło kont demo (ustawia je seed). Bez znaków specjalnych, bo jest wpisywane ręcznie w formularzu logowania.
resource "random_password" "demo_password" {
  length      = 20
  special     = false
  min_upper   = 2
  min_lower   = 2
  min_numeric = 2
}

resource "azurerm_key_vault_secret" "demo_password" {
  name         = "demo-password"
  value        = random_password.demo_password.result
  key_vault_id = azurerm_key_vault.main.id
  content_type = "Hasło kont demo (seed)"

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

  secret {
    name                = "jwt-secret"
    key_vault_secret_id = azurerm_key_vault_secret.jwt_secret.versionless_id
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
        name        = "JWT_SECRET"
        secret_name = "jwt-secret"
      }
      env {
        name  = "CORS_ORIGINS"
        value = "http://${azurerm_public_ip.web.fqdn},https://${azurerm_public_ip.web.fqdn}"
      }
      # Asystent AI (ai.tf): backend loguje się do Azure OpenAI tożsamością zarządzaną – AZURE_CLIENT_ID wskazuje,
      # której tożsamości użyć (kontener ma przypisaną tylko tę jedną, ale jawnie jest pewniej).
      env {
        name  = "AZURE_OPENAI_ENDPOINT"
        value = azurerm_cognitive_account.openai.endpoint
      }
      env {
        name  = "AZURE_OPENAI_DEPLOYMENT"
        value = azurerm_cognitive_deployment.chat.name
      }
      env {
        name  = "AZURE_CLIENT_ID"
        value = azurerm_user_assigned_identity.backend.client_id
      }
      # Na końcu listy – plan pokazuje wtedy tylko dodaną zmienną. Region na stronie /status (#140). Rewizję i replikę Container Apps ustawia sam (CONTAINER_APP_REVISION…).
      env {
        name  = "APP_REGION"
        value = azurerm_resource_group.main.location
      }

      # Sondy zdrowia – wszystkie na /health/live (proces odpowiada, bez bazy):
      # - liveness: restart tylko wtedy, gdy zawiesił się sam proces. Awaria PostgreSQL nie powoduje pętli
      #   restartów, bo restart i tak by jej nie naprawił.
      # - readiness: celowo bez bazy. Baza jest jedna dla wszystkich replik, więc przy jej awarii readiness
      #   zależna od bazy wyłączyłaby z ruchu wszystkie repliki naraz: zamiast naszego JSON-a 503 z /api/health
      #   użytkownik dostałby błąd Envoya, a deploy w CD nie doczekałby się gotowej rewizji.
      # Stan bazy raportuje /health (200/503) – na nim opiera się monitoring i sprawdzenie po deployu.
      # min_replicas = 0, więc każdy start to zimny start (~15 s na 0,25 vCPU) – startup daje do ~53 s,
      # a liveness i readiness zaczynają działać dopiero po udanym startup.
      startup_probe {
        transport               = "HTTP"
        port                    = var.backend_port
        path                    = "/health/live"
        initial_delay           = 3
        interval_seconds        = 5
        timeout                 = 3
        failure_count_threshold = 10
      }

      liveness_probe {
        transport               = "HTTP"
        port                    = var.backend_port
        path                    = "/health/live"
        initial_delay           = 1
        interval_seconds        = 30
        timeout                 = 5
        failure_count_threshold = 3
      }

      readiness_probe {
        transport               = "HTTP"
        port                    = var.backend_port
        path                    = "/health/live"
        interval_seconds        = 10
        timeout                 = 5
        failure_count_threshold = 3
        success_count_threshold = 1
      }
    }
  }


  # Obraz podmienia pipeline CD (deploy.yml) przy każdym merge do main – Terraform zarządza resztą konfiguracji.
  # backend_image zostaje obrazem startowym przy tworzeniu środowiska od zera.
  lifecycle {
    ignore_changes = [template[0].container[0].image]
  }
  # Role przed nową rewizją. Uwaga: Azure rozpropagowuje nadanie roli do kilku minut, więc tuż po pierwszym apply
  # asystent może chwilę dostawać 403 – backend (#108) zwraca wtedy 503 „chwilowo niedostępny”.
  depends_on = [azurerm_role_assignment.backend_kv, azurerm_role_assignment.backend_openai]
}

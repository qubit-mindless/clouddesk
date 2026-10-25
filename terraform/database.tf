# Warstwa DATA: PostgreSQL Flexible Server tylko z dostępem prywatnym (podsieć delegowana snet-db).
# Hasło administratora generuje Terraform i zapisuje w Key Vault – nie ma go w repozytorium ani w tfvars.

data "azurerm_client_config" "current" {}

resource "random_string" "suffix" {
  length  = 6
  upper   = false
  special = false
}

resource "random_password" "db_admin" {
  length           = 32
  special          = true
  override_special = "-_.~"
}

# Prywatna strefa DNS: nazwa serwera rozwiązuje się na prywatny adres tylko wewnątrz VNet.
resource "azurerm_private_dns_zone" "db" {
  name                = "${var.prefix}.private.postgres.database.azure.com"
  resource_group_name = azurerm_resource_group.main.name
  tags                = local.tags
}

resource "azurerm_private_dns_zone_virtual_network_link" "db" {
  name                  = "link-${var.prefix}-db"
  resource_group_name   = azurerm_resource_group.main.name
  private_dns_zone_name = azurerm_private_dns_zone.db.name
  virtual_network_id    = azurerm_virtual_network.main.id
  registration_enabled  = false
  tags                  = local.tags
}

resource "azurerm_postgresql_flexible_server" "main" {
  name                          = "psql-${var.prefix}-${random_string.suffix.result}"
  location                      = azurerm_resource_group.main.location
  resource_group_name           = azurerm_resource_group.main.name
  version                       = "16"
  sku_name                      = var.db_sku
  storage_mb                    = 32768
  storage_tier                  = "P4"
  backup_retention_days         = 7
  geo_redundant_backup_enabled  = false
  delegated_subnet_id           = azurerm_subnet.db.id
  private_dns_zone_id           = azurerm_private_dns_zone.db.id
  public_network_access_enabled = false
  administrator_login           = var.db_admin_login
  administrator_password        = random_password.db_admin.result
  tags                          = local.tags

  depends_on = [azurerm_private_dns_zone_virtual_network_link.db]

  lifecycle {
    # Azure sam wybiera strefę dostępności; nie chcemy, żeby kolejny plan próbował ją zmieniać.
    ignore_changes = [zone]
  }
}

resource "azurerm_postgresql_flexible_server_database" "app" {
  name      = var.prefix
  server_id = azurerm_postgresql_flexible_server.main.id
  charset   = "UTF8"
  collation = "en_US.utf8"
}

# Key Vault z autoryzacją RBAC: sekrety bazy (a później klucz Azure OpenAI) dla backendu.
resource "azurerm_key_vault" "main" {
  name                       = "kv-${var.prefix}-${random_string.suffix.result}"
  location                   = azurerm_resource_group.main.location
  resource_group_name        = azurerm_resource_group.main.name
  tenant_id                  = data.azurerm_client_config.current.tenant_id
  sku_name                   = "standard"
  rbac_authorization_enabled = true
  soft_delete_retention_days = 7
  purge_protection_enabled   = false
  tags                       = local.tags
}

# Osoba uruchamiająca Terraform musi móc zapisać sekret.
resource "azurerm_role_assignment" "kv_deployer" {
  scope                = azurerm_key_vault.main.id
  role_definition_name = "Key Vault Secrets Officer"
  principal_id         = data.azurerm_client_config.current.object_id
}

resource "azurerm_key_vault_secret" "db_admin_password" {
  name         = "db-admin-password"
  value        = random_password.db_admin.result
  key_vault_id = azurerm_key_vault.main.id
  content_type = "PostgreSQL ${azurerm_postgresql_flexible_server.main.name} / ${var.db_admin_login}"

  depends_on = [azurerm_role_assignment.kv_deployer]
}

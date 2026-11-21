output "resource_group_name" {
  value = azurerm_resource_group.main.name
}

output "budget_id" {
  value = azurerm_consumption_budget_resource_group.monthly.id
}

output "vnet_id" {
  value = azurerm_virtual_network.main.id
}

output "subnet_ids" {
  value = {
    web = azurerm_subnet.web.id
    app = azurerm_subnet.app.id
    db  = azurerm_subnet.db.id
  }
}

output "web_public_ip" {
  value = azurerm_public_ip.web.ip_address
}

output "web_url" {
  value = "https://${azurerm_public_ip.web.fqdn}"
}

output "db_host" {
  value = azurerm_postgresql_flexible_server.main.fqdn
}

output "db_name" {
  value = azurerm_postgresql_flexible_server_database.app.name
}

output "key_vault_name" {
  value = azurerm_key_vault.main.name
}

output "backend_internal_url" {
  description = "Adres backendu dla Nginx na VM (BACKEND_INTERNAL_URL, bez końcowego /)."
  value       = "https://${azurerm_container_app.backend.ingress[0].fqdn}"
}

output "github_deploy_client_id" {
  description = "Client ID tożsamości dla deploy.yml (sekret AZURE_CLIENT_ID w środowisku GitHub „azure”)."
  value       = azurerm_user_assigned_identity.github.client_id
}

output "backup_storage_account" {
  description = "Konto Storage z kopiami bazy (udział db-backups) – scripts/azure-db-backup.sh."
  value       = azurerm_storage_account.backup.name
}

output "demo_password_hint" {
  description = "Jak odczytać hasło kont demo (samo hasło nie jest wyświetlane)"
  value       = "az keyvault secret show --vault-name ${azurerm_key_vault.main.name} --name demo-password --query value -o tsv"
}

output "dashboard_url" {
  description = "Dashboard monitoringu w portalu Azure"
  value       = "https://portal.azure.com/#dashboard/arm${azurerm_portal_dashboard.monitoring.id}"
}

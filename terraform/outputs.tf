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
  value = "http://${azurerm_public_ip.web.fqdn}"
}

output "resource_group_name" {
  value = azurerm_resource_group.main.name
}

output "budget_id" {
  value = azurerm_consumption_budget_resource_group.monthly.id
}

# Dostęp zespołu (Entra ID): role RBAC tylko na grupie zasobów projektu.
# Konta szukamy po UPN, więc w terraform.tfvars wystarczą uczelniane maile.
data "azuread_user" "team" {
  for_each            = var.team_members
  user_principal_name = each.key
}

resource "azurerm_role_assignment" "team" {
  for_each             = var.team_members
  scope                = azurerm_resource_group.main.id
  role_definition_name = each.value
  principal_id         = data.azuread_user.team[each.key].object_id
  description          = "CloudDesk: ${data.azuread_user.team[each.key].display_name}"
}

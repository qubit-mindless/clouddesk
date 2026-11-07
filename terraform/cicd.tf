# CD (Blok 8): GitHub Actions loguje się do Azure przez OIDC – bez haseł i kluczy w GitHubie.
# GitHub wystawia krótkotrwały token JWT dla joba; Entra ID przyjmuje go tylko wtedy, gdy temat (subject)
# zgadza się dokładnie z federated credential: to repozytorium (po numerach ID, nie nazwie) i środowisko „azure”
# (dopuszczona tylko gałąź main).

resource "azurerm_user_assigned_identity" "github" {
  name                = "id-${var.prefix}-github"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  tags                = local.tags
}

resource "azurerm_federated_identity_credential" "github_main" {
  name                      = "github-${var.github_environment}"
  user_assigned_identity_id = azurerm_user_assigned_identity.github.id
  issuer                    = "https://token.actions.githubusercontent.com"
  audience                  = ["api://AzureADTokenExchange"]
  subject                   = "${var.github_subject_prefix}:environment:${var.github_environment}"
}

# Contributor tylko na rg-clouddesk: aktualizacja Container App (wymaga też przypisania tożsamości backendu),
# start zadania migracji i az vm run-command. Bez dostępu do stanu Terraform, kopii bazy i subskrypcji;
# bez prawa nadawania ról.
resource "azurerm_role_assignment" "github_deploy" {
  scope                = azurerm_resource_group.main.id
  role_definition_name = "Contributor"
  principal_id         = azurerm_user_assigned_identity.github.principal_id
}

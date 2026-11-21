# Asystent AI (#15): Azure OpenAI z modelem gpt-4o-mini dla backendu.
#
# - Bez kluczy: local_auth_enabled = false, więc konto przyjmuje tylko tokeny Entra ID. Backend loguje się
#   tożsamością zarządzaną (id-clouddesk-backend) z rolą „Cognitive Services OpenAI User” – może tylko
#   wywoływać model, nie zarządza kontem ani wdrożeniami. W repozytorium i w Key Vault nie ma żadnego klucza.
# - DataZoneStandard: zapytania przetwarzane są wyłącznie w centrach danych w UE (strefa danych EU).
# - Koszty: płacimy tylko za tokeny (bez stałej opłaty). Pojemność wdrożenia ogranicza przepustowość
#   (1 jednostka = 1000 tokenów/min), a backend ogranicza liczbę odpowiedzi na zgłoszenie i ich długość.
# - Punkt końcowy jest publiczny (Private Endpoint to stała opłata, jak w app.tf), ale bez klucza nikt spoza
#   zespołu i backendu nie dostanie tokenu z uprawnieniem do modelu.

resource "azurerm_cognitive_account" "openai" {
  name                  = "oai-${var.prefix}-${random_string.suffix.result}"
  location              = var.openai_location
  resource_group_name   = azurerm_resource_group.main.name
  kind                  = "OpenAI"
  sku_name              = "S0"
  custom_subdomain_name = "oai-${var.prefix}-${random_string.suffix.result}" # wymagana do logowania Entra ID
  local_auth_enabled    = false
  tags                  = local.tags
}

resource "azurerm_cognitive_deployment" "chat" {
  name                 = var.openai_model.name
  cognitive_account_id = azurerm_cognitive_account.openai.id

  model {
    format  = "OpenAI"
    name    = var.openai_model.name
    version = var.openai_model.version
  }

  sku {
    name     = "DataZoneStandard"
    capacity = var.openai_capacity
  }

  # Wersję modelu zmieniamy świadomie (PR), a nie automatycznie po stronie Azure.
  version_upgrade_option = "NoAutoUpgrade"
}

# Backend może tylko wywoływać model (inference) – bez dostępu do kluczy i konfiguracji konta.
resource "azurerm_role_assignment" "backend_openai" {
  scope                = azurerm_cognitive_account.openai.id
  role_definition_name = "Cognitive Services OpenAI User"
  principal_id         = azurerm_user_assigned_identity.backend.principal_id
}

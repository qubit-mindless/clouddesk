locals {
  tags = {
    project = var.prefix
    owner   = "qubit-mindless"
    managed = "terraform"
  }
}

resource "azurerm_resource_group" "main" {
  name     = "rg-${var.prefix}"
  location = var.location
  tags     = local.tags
}

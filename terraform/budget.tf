# FinOps: miesięczny budżet grupy zasobów z alertami e-mail dla zespołu.
resource "azurerm_consumption_budget_resource_group" "monthly" {
  name              = "budget-${var.prefix}-monthly"
  resource_group_id = azurerm_resource_group.main.id
  amount            = var.budget_amount
  time_grain        = "Monthly"

  time_period {
    start_date = var.budget_start_date
  }

  dynamic "notification" {
    for_each = [50, 80, 100]
    content {
      enabled        = true
      threshold      = notification.value
      operator       = "GreaterThanOrEqualTo"
      threshold_type = "Actual"
      contact_emails = var.budget_emails
    }
  }

  # Ostrzeżenie z wyprzedzeniem: prognoza przekroczy 100% budżetu.
  notification {
    enabled        = true
    threshold      = 100
    operator       = "GreaterThanOrEqualTo"
    threshold_type = "Forecasted"
    contact_emails = var.budget_emails
  }

  lifecycle {
    ignore_changes = [time_period]
  }
}

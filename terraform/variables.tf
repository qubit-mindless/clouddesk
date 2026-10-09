variable "subscription_id" {
  description = "ID subskrypcji Azure (w terraform.tfvars, poza repozytorium)."
  type        = string
}

variable "location" {
  description = "Region projektu. Subskrypcja dopuszcza: polandcentral, swedencentral, germanywestcentral, norwayeast, switzerlandnorth."
  type        = string
  default     = "polandcentral"
}

variable "prefix" {
  description = "Prefiks nazw zasobów."
  type        = string
  default     = "clouddesk"
}

variable "budget_amount" {
  description = "Miesięczny budżet projektu w walucie rozliczeniowej konta (EUR)."
  type        = number
  default     = 35
}

variable "budget_start_date" {
  description = "Początek okresu budżetu – pierwszy dzień miesiąca (RFC3339)."
  type        = string
  default     = "2026-10-01T00:00:00Z"
}

variable "budget_emails" {
  description = "Adresy e-mail, na które trafiają alerty budżetowe (cały zespół)."
  type        = list(string)
}

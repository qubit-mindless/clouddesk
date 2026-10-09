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

variable "vnet_cidr" {
  description = "Pula adresów sieci VNet."
  type        = string
  default     = "10.0.0.0/16"
}

variable "subnet_cidrs" {
  description = "Podsieci warstw: web (publiczna), app i db (prywatne)."
  type = object({
    web = string
    app = string
    db  = string
  })
  default = {
    web = "10.0.1.0/24"
    app = "10.0.2.0/24"
    db  = "10.0.3.0/24"
  }
}

variable "web_vm_size" {
  description = "Rozmiar maszyny warstwy WEB (B1s mieści się w darmowej puli 750 h/mies.)."
  type        = string
  default     = "Standard_B1s"
}

variable "web_dns_label" {
  description = "Etykieta DNS publicznego IP: <label>.<region>.cloudapp.azure.com"
  type        = string
  default     = "clouddesk-qubit"
}

variable "web_ssh_public_key_path" {
  description = "Klucz publiczny administratora VM (logowanie tylko kluczem; port 22 zamknięty w NSG)."
  type        = string
  default     = "~/.ssh/clouddesk_vm.pub"
}

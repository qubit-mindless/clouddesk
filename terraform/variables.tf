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

variable "team_members" {
  description = "Członkowie zespołu: UPN (mail uczelniany) => rola RBAC na grupie zasobów. PM ma rolę Owner na subskrypcji, więc go tu nie ma."
  type        = map(string)
  default     = {}
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

variable "db_sku" {
  description = "Rozmiar serwera PostgreSQL (Burstable B1ms wystarcza na projekt)."
  type        = string
  default     = "B_Standard_B1ms"
}

variable "db_admin_login" {
  description = "Login administratora PostgreSQL (hasło generuje Terraform i trzyma w Key Vault)."
  type        = string
  default     = "clouddeskadmin"
}

variable "backend_image" {
  description = "Obraz backendu przypięty po skrócie (repo@sha256:...), nie po tagu – adres z podsumowania workflow „Backend image”."
  type        = string
  default     = "ghcr.io/qubit-mindless/clouddesk-backend@sha256:30f3bb9797ba600b3e0f38d3ef6321f52c34fe75f9bb3b5ba07cb6c3ce44ccde"

  validation {
    condition     = can(regex("@sha256:[0-9a-f]{64}$", var.backend_image))
    error_message = "Podaj obraz po digeście (…@sha256:<64 znaki hex>), nie po tagu."
  }
}

variable "backend_port" {
  description = "Port, na którym słucha kontener backendu (uvicorn w backend/Dockerfile)."
  type        = number
  default     = 8000
}

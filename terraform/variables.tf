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
  default     = "ghcr.io/qubit-mindless/clouddesk-backend@sha256:f7eae06f29659a7077c2bacff870526dcb47a21f5ce686c121c60e3bff1aa31e"

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

variable "github_subject_prefix" {
  description = "Początek tematu (sub) tokenu OIDC GitHuba. Repozytorium używa formatu niezmiennego (immutable subject) z numerami ID organizacji i repo – zmiana nazwy repo nie przejmie dostępu. Sprawdzenie: gh api repos/<org>/<repo>/actions/oidc/customization/sub."
  type        = string
  default     = "repo:qubit-mindless@337266726/clouddesk@1402929245"
}

variable "github_environment" {
  description = "Środowisko GitHub (Settings → Environments) ograniczone do gałęzi main; tylko ono dostaje token do Azure."
  type        = string
  default     = "azure"
}

variable "backup_image" {
  description = "Obraz z pg_dump w wersji serwera (PostgreSQL 16), przypięty po digeście."
  type        = string
  default     = "postgres:16-alpine@sha256:0cefaabd882e42bcb2a2f3dc56d3ce4770560ba62fd7f197f1a2e008fd5731ab"

  validation {
    condition     = can(regex("@sha256:[0-9a-f]{64}$", var.backup_image))
    error_message = "Podaj obraz po digeście (…@sha256:<64 znaki hex>), nie po tagu."
  }
}

variable "backup_retention_days" {
  description = "Ile dni trzymać kopie bazy w udziale plików."
  type        = number
  default     = 30
}

variable "openai_location" {
  # swedencentral, nie polandcentral: subskrypcja pozwala na jedno konto Azure OpenAI na region
  # (OpenAI.S0.AccountCount = 1), a w polandcentral zajmuje go inny projekt na tej subskrypcji
  # (apply kończył się InsufficientQuota). W swedencentral jest limit gpt-4o-mini DataZoneStandard (1000).
  # Backend zostaje w polandcentral – zapytanie do modelu przechodzi w obrębie UE.
  description = "Region konta Azure OpenAI (strefa danych EU). Sprawdzenie limitu kont: az cognitiveservices usage list -l <region>."
  type        = string
  default     = "swedencentral"

  # DataZoneStandard trzyma dane w strefie regionu konta – region spoza UE złamałby zasadę „dane w UE”.
  validation {
    condition     = contains(["polandcentral", "swedencentral", "germanywestcentral"], var.openai_location)
    error_message = "Asystent AI tylko w regionie UE: polandcentral, swedencentral albo germanywestcentral."
  }
}

variable "openai_model" {
  description = "Model asystenta AI i jego wersja (nazwa wdrożenia = nazwa modelu, backend: AZURE_OPENAI_DEPLOYMENT). Wersja 2024-07-18 jest wycofywana 14.04.2027."
  type = object({
    name    = string
    version = string
  })
  default = {
    name    = "gpt-4o-mini"
    version = "2024-07-18"
  }
}

variable "openai_capacity" {
  description = "Pojemność wdrożenia w tysiącach tokenów na minutę (DataZoneStandard). 10 = ok. 10 odpowiedzi asystenta na minutę – wystarczy na demo, a ogranicza koszt przy nadużyciu."
  type        = number
  default     = 10

  validation {
    condition     = var.openai_capacity >= 1 && var.openai_capacity <= 50
    error_message = "Pojemność 1–50 (tys. tokenów/min) – więcej nie jest potrzebne w projekcie."
  }
}

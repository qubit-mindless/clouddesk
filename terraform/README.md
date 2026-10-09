# /terraform – infrastruktura Azure jako kod

Region: **polandcentral** (polityka subskrypcji dopuszcza też swedencentral, germanywestcentral, norwayeast, switzerlandnorth).

## Co jest w kodzie
| Plik | Zasoby |
|---|---|
| `main.tf` | grupa zasobów `rg-clouddesk` |
| `budget.tf` | budżet miesięczny grupy zasobów z alertami e-mail: 50%, 80%, 100% (rzeczywiste) i 100% (prognoza) |
| `versions.tf` | provider `azurerm`, stan zdalny w Azure Storage |

W kolejnych etapach: sieć VNet 10.0.0.0/16 z podsieciami web / app / db i NSG, baza, backend, frontend.

## Pierwsze uruchomienie (PM/DevOps)
```bash
az login
./bootstrap/bootstrap.sh            # jednorazowo: konto Storage na stan Terraforma
cp terraform.tfvars.example terraform.tfvars   # uzupełnij subscription_id i maile zespołu
terraform init -backend-config=backend.hcl
terraform plan
terraform apply
```

Dostęp do stanu odbywa się przez Entra ID (`use_azuread_auth`), bez kluczy dostępu. Osoba uruchamiająca Terraform potrzebuje roli **Storage Blob Data Contributor** na koncie Storage ze stanem.

`terraform.tfvars` zawiera ID subskrypcji i adresy e-mail, więc nie trafia do repozytorium.

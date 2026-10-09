# /terraform – infrastruktura Azure jako kod

Region: **polandcentral** (polityka subskrypcji dopuszcza też swedencentral, germanywestcentral, norwayeast, switzerlandnorth).

## Co jest w kodzie
| Plik | Zasoby |
|---|---|
| `main.tf` | grupa zasobów `rg-clouddesk` |
| `budget.tf` | budżet miesięczny grupy zasobów z alertami e-mail: 50%, 80%, 100% (rzeczywiste) i 100% (prognoza) |
| `network.tf` | VNet 10.0.0.0/16, podsieci `snet-web` / `snet-app` / `snet-db`, NSG dla każdej warstwy |
| `versions.tf` | provider `azurerm`, stan zdalny w Azure Storage |

W kolejnych etapach: baza, backend, frontend.

## Reguły sieciowe (NSG)
| NSG | Priorytet | Reguła | Źródło | Port |
|---|---|---|---|---|
| nsg-web | 100 | Allow | Internet | 443 |
| nsg-web | 110 | Allow | Internet | 80 (przekierowanie na HTTPS) |
| nsg-app | 100 | Allow | snet-web 10.0.1.0/24 | 80, 443 (ingress Container Apps → kontener :8000) |
| nsg-app | 110 | Allow | snet-app (ruch wewnątrz środowiska) | * |
| nsg-app | 120 | Allow | AzureLoadBalancer | * |
| nsg-db | 100 | Allow | snet-app 10.0.2.0/24 | 5432 |
| wszystkie | 4000 | **Deny** | VirtualNetwork | * |

Reguła `DenyVnetInBound` (4000) wyłącza domyślne `AllowVnetInBound` Azure, więc ruch płynie wyłącznie kaskadowo: web → app → db. SSH (22) nie jest otwarty w żadnej podsieci.

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

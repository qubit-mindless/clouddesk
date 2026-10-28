# /terraform – infrastruktura Azure jako kod

Region: **polandcentral** (polityka subskrypcji dopuszcza też swedencentral, germanywestcentral, norwayeast, switzerlandnorth).

## Co jest w kodzie
| Plik | Zasoby |
|---|---|
| `main.tf` | grupa zasobów `rg-clouddesk` |
| `budget.tf` | budżet miesięczny grupy zasobów z alertami e-mail: 50%, 80%, 100% (rzeczywiste) i 100% (prognoza) |
| `rbac.tf` | role zespołu na `rg-clouddesk` (konta Entra ID po UPN, mapa `team_members`) |
| `network.tf` | VNet 10.0.0.0/16, podsieci `snet-web` / `snet-app` / `snet-db`, NSG dla każdej warstwy |
| `web.tf` | VM `vm-web` z Nginx, publiczny IP z nazwą DNS |
| `database.tf` | PostgreSQL 16 Flexible (B1ms, tylko prywatny dostęp w `snet-db`), prywatna strefa DNS, Key Vault z hasłem administratora |
| `app.tf` | środowisko Container Apps (tylko wewnętrzny LB, profil Consumption) w `snet-app`, prywatna strefa DNS, Log Analytics, backend z tożsamością czytającą `DATABASE_URL` z Key Vault |
| `migrations.tf` | zadanie Container Apps `caj-clouddesk-migrate` uruchamiające migracje Alembic (ręcznie, po wdrożeniu nowego obrazu) |
| `backup.tf` | codzienna kopia bazy (`pg_dump`, zadanie `caj-clouddesk-backup`, 02:00 UTC) do udziału Azure Files w osobnej grupie `rg-clouddesk-backup` z blokadą usunięcia |
| `versions.tf` | provider `azurerm`, stan zdalny w Azure Storage |

Infrastruktura obejmuje już wszystkie trzy warstwy (WEB, APP, DATA). W kolejnych etapach: HTTPS, monitoring i usługi zarządzane (Azure OpenAI, Blob Storage, e-mail).

## Reguły sieciowe (NSG)
| NSG | Priorytet | Reguła | Źródło | Port |
|---|---|---|---|---|
| nsg-web | 100 | Allow | Internet | 443 |
| nsg-web | 110 | Allow | Internet | 80 (przekierowanie na HTTPS) |
| nsg-app | 100 | Allow | snet-web 10.0.1.0/24 | 80, 443 oraz 31080, 31443 (ingress Container Apps za wewnętrznym LB → kontener :8000) |
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

## Kopie bazy
Zadanie `caj-clouddesk-backup` co noc (02:00 UTC) robi `pg_dump` (format custom) do udziału `db-backups` w `rg-clouddesk-backup`. Kopie starsze niż `backup_retention_days` (30) są usuwane, a usunięty plik można jeszcze przez 7 dni odzyskać z kosza udziału. Grupa ma blokadę **CanNotDelete**, więc usunięcie `rg-clouddesk` nie zabiera kopii.

```bash
../scripts/azure-db-backup.sh run                 # kopia teraz
../scripts/azure-db-backup.sh list                # lista kopii
../scripts/azure-db-backup.sh download            # najnowsza kopia do ~/clouddesk-backups (poza Azure)
../scripts/azure-db-backup.sh restore <plik>      # przywrócenie bazy w Azure (nadpisuje dane, pyta o potwierdzenie)
```

Kopia w Azure nie chroni przed usunięciem całej subskrypcji – dlatego przed dłuższą przerwą i po większych zmianach danych pobierz najnowszą kopię (`download`). Lokalnie przywrócisz ją do bazy z `docker compose`: `pg_restore --clean --if-exists --no-owner -d postgresql://… plik.dump`.

## Odbudowa od zera
Gdy grupy zasobów zniknęły (tak było 27.10.2026), cała infrastruktura wraca z kodu w około 30 minut:

```bash
az login
# 1. Stan Terraforma: konto Storage pod nazwą z backend.hcl (wtedy backend.hcl się nie zmienia).
az group create -n rg-clouddesk-tfstate -l polandcentral --tags project=clouddesk purpose=tfstate
az storage account create -n <storage_account_name z backend.hcl> -g rg-clouddesk-tfstate -l polandcentral \
  --sku Standard_LRS --kind StorageV2 --min-tls-version TLS1_2 --allow-blob-public-access false --https-only true
./bootstrap/bootstrap.sh
az role assignment create --assignee "$(az ad signed-in-user show --query id -o tsv)" \
  --role "Storage Blob Data Contributor" --scope "$(az storage account show -n <nazwa> -g rg-clouddesk-tfstate --query id -o tsv)"
# 2. Infrastruktura.
terraform init -reconfigure -backend-config=backend.hcl
terraform plan -out=tfplan && terraform apply tfplan
# Budżet przeżywa usunięcie grupy – jeśli apply zgłosi „already exists”:
#   terraform import azurerm_consumption_budget_resource_group.monthly <ID z komunikatu> && terraform apply
# 3. Dane: schemat i dane przykładowe albo ostatnia kopia.
../scripts/azure-migrate.sh --seed               # albo: ../scripts/azure-db-backup.sh restore <plik>
# 4. Frontend na nowej VM – adres backendu podajemy jawnie (nowa VM nie ma /etc/clouddesk/web.env).
../config/package-web.sh
#    wdrożenie przez az vm run-command (config/README.md) z BACKEND_INTERNAL_URL="$(terraform output -raw backend_internal_url)"
```

Po odbudowie nazwy bazy i Key Vault dostają nowy sufiks, a VM nowy publiczny IP – adres DNS strony zostaje ten sam. Zespół musi zalogować się ponownie w portalu (role RBAC są nowe).

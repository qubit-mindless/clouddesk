# /terraform – infrastruktura jako kod (Blok 3, ocena 5.0)

Planowana zawartość:
- `main.tf`: provider azurerm, Resource Group, VNet 10.0.0.0/16, podsieci, NSG;
- `variables.tf`: region, prefiks nazw, zakresy CIDR;
- `outputs.tf`: ID VNet i podsieci.

Stan (`.tfstate`) trzymany zdalnie w Azure Storage (backend `azurerm`), żeby zespół nie nadpisywał sobie stanu.

```bash
terraform init
terraform plan
terraform apply
```

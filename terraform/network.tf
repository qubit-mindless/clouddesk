# Sieć 3-tier: każda warstwa w osobnej podsieci, ruch dopuszczony tylko z warstwy powyżej.
#
#   Internet --443/80--> snet-web --80/443 (ingress)--> snet-app --5432--> snet-db
#
# Domyślna reguła Azure AllowVnetInBound wpuszcza ruch z całej sieci VNet, dlatego każda NSG
# kończy się jawną regułą DenyVnetInBound – inaczej np. snet-web mógłby łączyć się bezpośrednio z bazą.
#
# Priorytety: 100–199 Allow, 200–299 jawne Deny z Internetu (porty zarządcze), 4000 DenyVnetInBound.

resource "azurerm_virtual_network" "main" {
  name                = "vnet-${var.prefix}"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  address_space       = [var.vnet_cidr]
  tags                = local.tags
}

# ---------------------------------------------------------------- WEB (publiczna)
resource "azurerm_subnet" "web" {
  name                 = "snet-web"
  resource_group_name  = azurerm_resource_group.main.name
  virtual_network_name = azurerm_virtual_network.main.name
  address_prefixes     = [var.subnet_cidrs.web]
}

resource "azurerm_network_security_group" "web" {
  name                = "nsg-web"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  tags                = local.tags

  security_rule {
    name                       = "AllowHttpsFromInternet"
    priority                   = 100
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_address_prefix      = "Internet"
    source_port_range          = "*"
    destination_address_prefix = var.subnet_cidrs.web
    destination_port_range     = "443"
  }

  # Port 80 tylko po to, żeby Nginx przekierował ruch na HTTPS (i dla walidacji certyfikatu Let's Encrypt).
  security_rule {
    name                       = "AllowHttpFromInternet"
    priority                   = 110
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_address_prefix      = "Internet"
    source_port_range          = "*"
    destination_address_prefix = var.subnet_cidrs.web
    destination_port_range     = "80"
  }

  # Porty zarządcze zamknięte jawnie. Domyślna reguła Azure DenyAllInBound też by je zablokowała, ale jawną
  # regułę widać w portalu i w planie, a przypadkowe Allow z numerem priorytetu powyżej 200 jej nie ominie.
  # Nowe Allow na 22/3389 w paśmie 100–199 wygrałyby z tą regułą – takich nie dodajemy.
  # VM obsługujemy przez `az vm run-command` (Azure control plane), więc SSH/RDP nie są potrzebne.
  security_rule {
    name                       = "DenyMgmtFromInternet"
    priority                   = 200
    direction                  = "Inbound"
    access                     = "Deny"
    protocol                   = "*"
    source_address_prefix      = "Internet"
    source_port_range          = "*"
    destination_address_prefix = "*"
    destination_port_ranges    = ["22", "3389"]
  }

  security_rule {
    name                       = "DenyVnetInBound"
    priority                   = 4000
    direction                  = "Inbound"
    access                     = "Deny"
    protocol                   = "*"
    source_address_prefix      = "VirtualNetwork"
    source_port_range          = "*"
    destination_address_prefix = "*"
    destination_port_range     = "*"
  }
}

resource "azurerm_subnet_network_security_group_association" "web" {
  subnet_id                 = azurerm_subnet.web.id
  network_security_group_id = azurerm_network_security_group.web.id
}

# ---------------------------------------------------------------- APP (prywatna)
# Podsieć delegowana dla środowiska Azure Container Apps (workload profiles, ingress wewnętrzny).
resource "azurerm_subnet" "app" {
  name                 = "snet-app"
  resource_group_name  = azurerm_resource_group.main.name
  virtual_network_name = azurerm_virtual_network.main.name
  address_prefixes     = [var.subnet_cidrs.app]

  delegation {
    name = "container-apps"
    service_delegation {
      name    = "Microsoft.App/environments"
      actions = ["Microsoft.Network/virtualNetworks/subnets/join/action"]
    }
  }
}

resource "azurerm_network_security_group" "app" {
  name                = "nsg-app"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  tags                = local.tags

  # Wewnętrzny ingress Container Apps: klient łączy się na 80/443 adresu ILB, a load balancer przekazuje ruch
  # do proxy środowiska na 31080/31443 (środowisko z workload profiles) – NSG widzi oba porty.
  # Proxy przekazuje dalej do kontenera FastAPI (:8000).
  security_rule {
    name                       = "AllowIngressFromWeb"
    priority                   = 100
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_address_prefix      = var.subnet_cidrs.web
    source_port_range          = "*"
    destination_address_prefix = var.subnet_cidrs.app
    destination_port_ranges    = ["80", "443", "31080", "31443"]
  }

  # Komunikacja wewnątrz środowiska Container Apps.
  security_rule {
    name                       = "AllowIntraSubnet"
    priority                   = 110
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "*"
    source_address_prefix      = var.subnet_cidrs.app
    source_port_range          = "*"
    destination_address_prefix = var.subnet_cidrs.app
    destination_port_range     = "*"
  }

  security_rule {
    name                       = "AllowAzureLoadBalancer"
    priority                   = 120
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "*"
    source_address_prefix      = "AzureLoadBalancer"
    source_port_range          = "*"
    destination_address_prefix = "*"
    destination_port_range     = "*"
  }

  # Backend nie ma publicznego IP, ale z Internetu blokujemy jawnie – na wypadek publicznego adresu albo
  # zewnętrznego LB dodanego kiedyś przez pomyłkę: porty zarządcze (22, 3389), porty ingress Container Apps
  # (80/443 na LB, 31080/31443 na proxy środowiska) i port kontenera (var.backend_port, 8080 jako alternatywny).
  # Ruch z snet-web i AzureLoadBalancer przechodzi wcześniej przez reguły Allow 100–120, więc to go nie dotyczy.
  security_rule {
    name                       = "DenyMgmtAndAppFromInternet"
    priority                   = 200
    direction                  = "Inbound"
    access                     = "Deny"
    protocol                   = "*"
    source_address_prefix      = "Internet"
    source_port_range          = "*"
    destination_address_prefix = "*"
    destination_port_ranges    = distinct(["22", "3389", "80", "443", "31080", "31443", tostring(var.backend_port), "8080"])
  }

  security_rule {
    name                       = "DenyVnetInBound"
    priority                   = 4000
    direction                  = "Inbound"
    access                     = "Deny"
    protocol                   = "*"
    source_address_prefix      = "VirtualNetwork"
    source_port_range          = "*"
    destination_address_prefix = "*"
    destination_port_range     = "*"
  }
}

resource "azurerm_subnet_network_security_group_association" "app" {
  subnet_id                 = azurerm_subnet.app.id
  network_security_group_id = azurerm_network_security_group.app.id
}

# ---------------------------------------------------------------- DATA (prywatna)
# Podsieć delegowana dla PostgreSQL Flexible Server z dostępem prywatnym (bez publicznego IP).
resource "azurerm_subnet" "db" {
  name                 = "snet-db"
  resource_group_name  = azurerm_resource_group.main.name
  virtual_network_name = azurerm_virtual_network.main.name
  address_prefixes     = [var.subnet_cidrs.db]
  # PostgreSQL Flexible dodaje ten punkt końcowy przy tworzeniu serwera (kopie zapasowe w Storage).
  service_endpoints = ["Microsoft.Storage"]

  delegation {
    name = "postgresql-flexible"
    service_delegation {
      name    = "Microsoft.DBforPostgreSQL/flexibleServers"
      actions = ["Microsoft.Network/virtualNetworks/subnets/join/action"]
    }
  }
}

resource "azurerm_network_security_group" "db" {
  name                = "nsg-db"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  tags                = local.tags

  security_rule {
    name                       = "AllowPostgresFromApp"
    priority                   = 100
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_address_prefix      = var.subnet_cidrs.app
    source_port_range          = "*"
    destination_address_prefix = var.subnet_cidrs.db
    destination_port_range     = "5432"
  }

  security_rule {
    name                       = "DenyVnetInBound"
    priority                   = 4000
    direction                  = "Inbound"
    access                     = "Deny"
    protocol                   = "*"
    source_address_prefix      = "VirtualNetwork"
    source_port_range          = "*"
    destination_address_prefix = "*"
    destination_port_range     = "*"
  }
}

resource "azurerm_subnet_network_security_group_association" "db" {
  subnet_id                 = azurerm_subnet.db.id
  network_security_group_id = azurerm_network_security_group.db.id
}

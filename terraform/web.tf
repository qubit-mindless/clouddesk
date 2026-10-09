# Warstwa WEB: maszyna z Nginx w podsieci publicznej – jedyny publiczny punkt wejścia do aplikacji.
# SSH nie jest otwarty w NSG; administracja przez `az vm run-command` (Azure control plane).

resource "azurerm_public_ip" "web" {
  name                = "pip-web"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  allocation_method   = "Static"
  sku                 = "Standard"
  domain_name_label   = var.web_dns_label
  tags                = local.tags
}

resource "azurerm_network_interface" "web" {
  name                = "nic-web"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  tags                = local.tags

  ip_configuration {
    name                          = "primary"
    subnet_id                     = azurerm_subnet.web.id
    private_ip_address_allocation = "Dynamic"
    public_ip_address_id          = azurerm_public_ip.web.id
  }
}

resource "azurerm_linux_virtual_machine" "web" {
  name                            = "vm-web"
  location                        = azurerm_resource_group.main.location
  resource_group_name             = azurerm_resource_group.main.name
  size                            = var.web_vm_size
  admin_username                  = "clouddesk"
  disable_password_authentication = true
  network_interface_ids           = [azurerm_network_interface.web.id]
  custom_data                     = base64encode(file("${path.module}/cloud-init-web.yaml"))
  tags                            = local.tags

  admin_ssh_key {
    username   = "clouddesk"
    public_key = file(pathexpand(var.web_ssh_public_key_path))
  }

  os_disk {
    name                 = "osdisk-web"
    caching              = "ReadWrite"
    storage_account_type = "StandardSSD_LRS"
    disk_size_gb         = 32
  }

  source_image_reference {
    publisher = "Canonical"
    offer     = "ubuntu-24_04-lts"
    sku       = "server"
    version   = "latest"
  }

  identity {
    type = "SystemAssigned"
  }

  boot_diagnostics {}
}

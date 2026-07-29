# infra/azure/main.tf
# ── Azure: one customer's Private-tier GPU VM ────────────────────────────────
#
# Same shape as infra/aws/main.tf and infra/gcp/main.tf — run with the
# CUSTOMER's own Azure subscription (az login against their tenant), never
# Quorum's. See infra/aws/main.tf's top comment for the overall design.
#
# GPU sizing note: Standard_NC24ads_A100_v4 (1x A100 80GB) is the default —
# again, not symmetric with the other two clouds' defaults on purpose, this
# is what's commonly available on Azure. Same validate-before-production
# caveat as the other two modules.
#
# GPU quota note: Azure subscriptions need a quota increase request for
# NCADS_A100_v4 family vCPUs in most regions/subscription tiers before this
# apply will succeed (Quotas → Compute → search the VM family). Same
# lead-time caveat as AWS/GCP — flag to the customer early.
#
# Note on Azure Container Instances: this module deliberately does NOT use
# ACI — Microsoft retired ACI's GPU support in July 2025. This uses a
# regular Azure VM instead, same as the AWS/GCP modules use regular
# GPU-attached VMs rather than betting on each cloud's still-maturing
# serverless-GPU-container offerings (see the original architecture
# decision this whole infra/ directory is built against).
# ─────────────────────────────────────────────────────────────────────────────

terraform {
  required_providers {
    azurerm = { source = "hashicorp/azurerm", version = "~> 3.0" }
  }
}

variable "customer_user_id" { type = string }
variable "model_family"     { type = string }
variable "fast_model"       { type = string }
variable "premium_model"    { type = string }
variable "api_key" {
  type      = string
  sensitive = true
}
variable "admin_key" {
  type      = string
  sensitive = true
}
variable "domain" { type = string }
variable "quorum_image" {
  type    = string
  default = "ghcr.io/quorum/private-inference:stable"
}
variable "vm_size" {
  type    = string
  default = "Standard_NC24ads_A100_v4"
}
variable "azure_location" {
  type    = string
  default = "Central India"
}
variable "azure_resource_group" { type = string }  # customer creates/provides this — no sensible default across subscriptions

provider "azurerm" {
  features {}
}

resource "azurerm_network_security_group" "quorum_private" {
  name                = "quorum-private-${var.customer_user_id}-nsg"
  location            = var.azure_location
  resource_group_name = var.azure_resource_group

  security_rule {
    name                       = "AllowHTTPS"
    priority                   = 100
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "443"
    source_address_prefix      = "*"  # tighten to Quorum's backend IP range if wanted, same note as the other two modules
    destination_address_prefix = "*"
  }
}

resource "azurerm_virtual_network" "quorum_private" {
  name                = "quorum-private-${var.customer_user_id}-vnet"
  address_space       = ["10.10.0.0/16"]
  location            = var.azure_location
  resource_group_name = var.azure_resource_group
}

resource "azurerm_subnet" "quorum_private" {
  name                 = "quorum-private-${var.customer_user_id}-subnet"
  resource_group_name  = var.azure_resource_group
  virtual_network_name = azurerm_virtual_network.quorum_private.name
  address_prefixes     = ["10.10.1.0/24"]
}

resource "azurerm_public_ip" "quorum_private" {
  name                = "quorum-private-${var.customer_user_id}-ip"
  location            = var.azure_location
  resource_group_name = var.azure_resource_group
  allocation_method   = "Static"
  sku                 = "Standard"
}

resource "azurerm_network_interface" "quorum_private" {
  name                = "quorum-private-${var.customer_user_id}-nic"
  location            = var.azure_location
  resource_group_name = var.azure_resource_group

  ip_configuration {
    name                          = "internal"
    subnet_id                     = azurerm_subnet.quorum_private.id
    private_ip_address_allocation = "Dynamic"
    public_ip_address_id          = azurerm_public_ip.quorum_private.id
  }
}

resource "azurerm_network_interface_security_group_association" "quorum_private" {
  network_interface_id     = azurerm_network_interface.quorum_private.id
  network_security_group_id = azurerm_network_security_group.quorum_private.id
}

resource "azurerm_linux_virtual_machine" "quorum_private" {
  name                = "quorum-private-${var.customer_user_id}"
  location            = var.azure_location
  resource_group_name = var.azure_resource_group
  size                = var.vm_size
  admin_username      = "quorumadmin"
  network_interface_ids = [azurerm_network_interface.quorum_private.id]

  admin_ssh_key {
    username   = "quorumadmin"
    public_key = file("~/.ssh/id_rsa.pub")  # infra/deploy.sh generates a deploy-specific keypair — see that script
  }

  os_disk {
    caching              = "ReadWrite"
    storage_account_type = "Premium_LRS"
    disk_size_gb         = 200
  }

  # Azure's Data Science VM image — same rationale as AWS/GCP's equivalents:
  # NVIDIA drivers pre-installed.
  source_image_reference {
    publisher = "microsoft-dsvm"
    offer     = "ubuntu-hpc"
    sku       = "2204"
    version   = "latest"
  }

  custom_data = base64encode(templatefile("${path.module}/../shared/bootstrap.sh.tpl", {
    customer_user_id = var.customer_user_id
    model_family     = var.model_family
    fast_model       = var.fast_model
    premium_model    = var.premium_model
    api_key          = var.api_key
    admin_key        = var.admin_key
    domain           = var.domain
    quorum_image     = var.quorum_image
  }))

  tags = {
    ManagedBy  = "quorum-infra-terraform"
    CustomerID = var.customer_user_id
  }
}

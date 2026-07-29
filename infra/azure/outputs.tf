# infra/azure/outputs.tf

output "vm_name" {
  value = azurerm_linux_virtual_machine.quorum_private.name
}

output "endpoint_url" {
  value = "https://${var.domain}"
}

output "public_ip" {
  value       = azurerm_public_ip.quorum_private.ip_address
  description = "Point var.domain's DNS A record here before terraform apply — same requirement as the other two modules."
}

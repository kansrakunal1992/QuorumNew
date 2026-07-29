# infra/aws/outputs.tf
# infra/deploy.sh reads these (via `terraform output -json`) to call
# /api/admin/register-private-deployment once the VM is up.

output "instance_id" {
  value = aws_instance.quorum_private.id
}

output "endpoint_url" {
  value = "https://${var.domain}"
}

output "public_ip" {
  value       = aws_instance.quorum_private.public_ip
  description = "Point var.domain's DNS A record here before terraform apply — Caddy's automatic HTTPS needs DNS already resolving."
}

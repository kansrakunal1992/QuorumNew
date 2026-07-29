# infra/gcp/outputs.tf

output "instance_name" {
  value = google_compute_instance.quorum_private.name
}

output "endpoint_url" {
  value = "https://${var.domain}"
}

output "public_ip" {
  value       = google_compute_instance.quorum_private.network_interface[0].access_config[0].nat_ip
  description = "Point var.domain's DNS A record here before terraform apply — same requirement as the AWS module."
}

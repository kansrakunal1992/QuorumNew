# infra/gcp/main.tf
# ── GCP: one customer's Private-tier GPU VM ──────────────────────────────────
#
# Same shape as infra/aws/main.tf — run with the CUSTOMER's own GCP project
# and credentials (gcloud auth application-default login, or a service
# account key they provide), never Quorum's. See that file's top comment for
# the overall design; only the differences are noted here.
#
# GPU sizing note: a2-highgpu-1g (1x A100 40GB) is the default below. A100s
# are a meaningfully different (better) GPU than AWS's default A10G — sizing
# is NOT symmetric across the three cloud modules by design; each defaults
# to a reasonable, commonly-available GPU shape for that cloud. Validate
# against your actual chosen model sizes before production use, same
# caveat as the AWS module.
#
# GPU quota note: GCP projects default to 0 quota for GPU-family instances
# in most regions too. Request a quota increase (IAM & Admin → Quotas →
# filter "GPUs (all regions)" or the specific accelerator type) before this
# apply will succeed.
# ─────────────────────────────────────────────────────────────────────────────

terraform {
  required_providers {
    google = { source = "hashicorp/google", version = "~> 5.0" }
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
variable "machine_type" {
  type    = string
  default = "a2-highgpu-1g"
}
variable "gcp_project" { type = string }             # customer's own project ID — required, no sensible default
variable "gcp_zone" {
  type    = string
  default = "asia-south1-a"  # Mumbai
}

provider "google" {
  project = var.gcp_project
  zone    = var.gcp_zone
}

resource "google_compute_firewall" "quorum_private" {
  name    = "quorum-private-${var.customer_user_id}-https"
  network = "default"

  allow {
    protocol = "tcp"
    ports    = ["443"]
  }

  source_ranges = ["0.0.0.0/0"]  # tighten to Quorum's backend IP range if wanted, same note as the AWS module
}

resource "google_compute_instance" "quorum_private" {
  name         = "quorum-private-${var.customer_user_id}"
  machine_type = var.machine_type
  zone         = var.gcp_zone

  boot_disk {
    initialize_params {
      # GCP's Deep Learning VM image family — same rationale as AWS's Deep
      # Learning AMI: NVIDIA drivers pre-installed, avoids the most fragile
      # part of a from-scratch GPU setup.
      image = "projects/ml-images/global/images/family/common-gpu-debian-11"
      size  = 200
      type  = "pd-ssd"
    }
  }

  guest_accelerator {
    type  = "nvidia-tesla-a100"
    count = 1
  }

  scheduling {
    on_host_maintenance = "TERMINATE"  # required for GPU-attached instances on GCP
    automatic_restart    = true
  }

  network_interface {
    network = "default"
    access_config {}  # ephemeral public IP — same trust model as the AWS module (TLS + API key, not network obscurity)
  }

  metadata_startup_script = templatefile("${path.module}/../shared/bootstrap.sh.tpl", {
    customer_user_id = var.customer_user_id
    model_family     = var.model_family
    fast_model       = var.fast_model
    premium_model    = var.premium_model
    api_key          = var.api_key
    admin_key        = var.admin_key
    domain           = var.domain
    quorum_image     = var.quorum_image
  })

  labels = {
    managed_by  = "quorum-infra-terraform"
    customer_id = var.customer_user_id
  }
}

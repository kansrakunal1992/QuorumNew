# infra/aws/main.tf
# ── AWS: one customer's Private-tier GPU VM ──────────────────────────────────
#
# Run with THIS customer's own AWS credentials (aws configure / AWS_PROFILE),
# never Quorum's — that's the whole "their cloud account, their bill" point
# of Private tier. infra/deploy.sh sets AWS_PROFILE before calling this.
#
# Provisions: one GPU VM, a security group allowing inbound HTTPS only,
# bootstrapped via infra/shared/bootstrap.sh.tpl (installs Docker, Caddy,
# starts both model containers, installs the auto-updater — see that file).
#
# GPU sizing note: g5.12xlarge (4x A10G, 96GB combined VRAM) is the default
# below as a reasonable starting point for a fast+premium pair of
# medium-sized open models. This has NOT been load-tested against your
# actual chosen model sizes/quantization — validate against real VRAM
# requirements before using this in front of a paying customer. Override via
# the instance_type variable.
#
# GPU quota note: AWS accounts default to 0 vCPU quota for G-series/P-series
# instances in most regions. The customer's AWS account will need to request
# a quota increase (Service Quotas console → EC2 → "Running On-Demand G and
# VT instances") BEFORE this apply will succeed — this can take anywhere
# from minutes to a few business days depending on the account's history.
# Flag this to the customer early in the sales/onboarding conversation, not
# at deploy time.
# ─────────────────────────────────────────────────────────────────────────────

terraform {
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.0" }
  }
}

variable "customer_user_id" { type = string }        # Supabase auth.users UUID
variable "model_family"     { type = string }         # "qwen" | "mistral"
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
variable "domain"        { type = string }              # e.g. <slug>.private.quorum.example.com — DNS must point here before apply
variable "quorum_image" {
  type    = string
  default = "ghcr.io/quorum/private-inference:stable"
}
variable "instance_type" {
  type    = string
  default = "g5.12xlarge"
}
variable "aws_region" {
  type    = string
  default = "ap-south-1"  # Mumbai — closest to most customers seen so far; override per customer
}

provider "aws" {
  region = var.aws_region
}

data "aws_ami" "deep_learning" {
  most_recent = true
  owners      = ["amazon"]
  filter {
    name   = "name"
    # AWS's Deep Learning AMI ships NVIDIA drivers pre-installed — saves the
    # bootstrap script from needing to compile/install GPU drivers itself,
    # which is the single most fragile part of a from-scratch GPU VM setup.
    values = ["Deep Learning Base OSS Nvidia Driver GPU AMI (Ubuntu 22.04) *"]
  }
}

resource "aws_security_group" "quorum_private" {
  name_prefix = "quorum-private-${var.customer_user_id}-"
  description = "Quorum Private tier — inbound HTTPS only"

  ingress {
    description = "HTTPS from anywhere (tighten to Quorum's backend IP range if you want defense-in-depth beyond the API key)"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    description = "Needed for: pulling the image, Let's Encrypt cert issuance, pulling model weights from Hugging Face"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_instance" "quorum_private" {
  ami                    = data.aws_ami.deep_learning.id
  instance_type          = var.instance_type
  vpc_security_group_ids = [aws_security_group.quorum_private.id]

  root_block_device {
    volume_size = 200  # model weights are large — Mistral Large / Qwen 72B alone can be 100GB+ on disk
    volume_type = "gp3"
  }

  user_data = templatefile("${path.module}/../shared/bootstrap.sh.tpl", {
    customer_user_id = var.customer_user_id
    model_family     = var.model_family
    fast_model       = var.fast_model
    premium_model    = var.premium_model
    api_key          = var.api_key
    admin_key        = var.admin_key
    domain           = var.domain
    quorum_image     = var.quorum_image
  })

  tags = {
    Name       = "quorum-private-${var.customer_user_id}"
    ManagedBy  = "quorum-infra-terraform"
    CustomerID = var.customer_user_id
  }
}

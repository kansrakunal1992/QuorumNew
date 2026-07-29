#!/usr/bin/env bash
# infra/deploy.sh
# ── The actual "one-click" deploy ─────────────────────────────────────────────
#
# Usage:
#   ./deploy.sh <cloud: aws|gcp|azure> <customer_user_id> <model_family: qwen|mistral> <domain>
#
# Example:
#   ./deploy.sh aws 49b60a4d-657c-4fcc-a88f-9da844a4b5e4 mistral acme-corp.private.quorum.example.com
#
# What this does, in order:
#   1. Generate a fresh, unique API key for this customer (never reused
#      across customers, never chosen by hand)
#   2. Look up the right fast/premium model names for the chosen family —
#      see MODEL_TABLE below, the one place those pairings are defined
#   3. Run `terraform apply` against the chosen cloud's module, using THAT
#      customer's cloud credentials (must already be configured in the
#      shell environment this script runs in — see each module's top
#      comment for the exact auth mechanism per cloud)
#   4. Wait for the instance to actually respond healthy (not just "VM
#      exists" — Terraform finishing doesn't mean bootstrap.sh has finished
#      installing Docker + starting containers yet)
#   5. Call POST /api/admin/register-private-deployment with the resulting
#      URL/key — this is the step that makes lib/ai-client.ts's Private tier
#      routing actually work for this customer (see that file's error
#      message if this step is skipped)
#
# Prerequisites this script assumes are already true (not automated here,
# genuinely separate concerns):
#   - This customer already has mirror_access.product_tier = 'private' (via
#     /api/admin/grant-mirror-access) — this script does NOT grant access,
#     only deploys infra for a customer who's already been granted it.
#   - DNS for the chosen domain already points at... nothing yet, that's
#     fine, but it needs to be CREATED (an A record) once this script prints
#     the public IP, before Caddy's automatic HTTPS can succeed — this is a
#     manual step between apply finishing and the instance becoming
#     reachable. A future version could integrate a DNS provider API to
#     automate this; not included here since DNS provider varies per
#     customer/domain owner.
#   - The requesting shell has valid credentials for the target cloud
#     already active (aws configure / gcloud auth / az login) — for THIS
#     customer's account, not Quorum's.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

CLOUD="${1:?usage: deploy.sh <aws|gcp|azure> <customer_user_id> <qwen|mistral> <domain>}"
CUSTOMER_USER_ID="${2:?customer_user_id required}"
MODEL_FAMILY="${3:?model_family required (qwen or mistral)}"
DOMAIN="${4:?domain required (e.g. acme-corp.private.quorum.example.com)}"

QUORUM_API_BASE="${QUORUM_API_BASE:-https://app.quorum.example.com}"
QUORUM_ADMIN_KEY="${QUORUM_ADMIN_KEY:?QUORUM_ADMIN_KEY env var required — the SUPABASE_SERVICE_ROLE_KEY, same value the admin endpoints check}"

if [[ "$CLOUD" != "aws" && "$CLOUD" != "gcp" && "$CLOUD" != "azure" ]]; then
  echo "cloud must be one of: aws, gcp, azure" >&2; exit 1
fi
if [[ "$MODEL_FAMILY" != "qwen" && "$MODEL_FAMILY" != "mistral" ]]; then
  echo "model_family must be one of: qwen, mistral" >&2; exit 1
fi

# ── Model table — the one place fast/premium pairings are defined ────────────
# Update this if/when the actual chosen model sizes change; every other part
# of this pipeline (bootstrap.sh.tpl, register-private-deployment) just
# takes whatever model names this table hands it.
if [[ "$MODEL_FAMILY" == "qwen" ]]; then
  FAST_MODEL="Qwen/Qwen2.5-14B-Instruct"
  PREMIUM_MODEL="Qwen/Qwen2.5-72B-Instruct"
else
  FAST_MODEL="mistralai/Mistral-Small-Instruct-2409"
  PREMIUM_MODEL="mistralai/Mistral-Large-Instruct-2411"
fi

echo "== Generating a fresh API key for this customer =="
API_KEY="$(openssl rand -hex 32)"

echo "== Running terraform apply ($CLOUD) =="
cd "$(dirname "$0")/$CLOUD"
terraform init -input=false
terraform apply -auto-approve \
  -var="customer_user_id=$CUSTOMER_USER_ID" \
  -var="model_family=$MODEL_FAMILY" \
  -var="fast_model=$FAST_MODEL" \
  -var="premium_model=$PREMIUM_MODEL" \
  -var="api_key=$API_KEY" \
  -var="admin_key=$QUORUM_ADMIN_KEY" \
  -var="domain=$DOMAIN"

PUBLIC_IP="$(terraform output -raw public_ip)"
ENDPOINT_URL="$(terraform output -raw endpoint_url)"

echo ""
echo "== VM provisioned. Public IP: $PUBLIC_IP =="
echo "== ACTION NEEDED: point $DOMAIN's DNS A record at $PUBLIC_IP now, then press Enter to continue. =="
echo "== (Caddy on the instance will keep retrying HTTPS cert issuance until DNS resolves — this script"
echo "==  will still wait below, but cert issuance won't succeed until you've done this.) =="
read -r -p "Press Enter once DNS is set... "

echo "== Waiting for the instance to become healthy (this includes model load time — can take several minutes) =="
for i in $(seq 1 60); do
  if curl -sf "$ENDPOINT_URL/fast/health" > /dev/null 2>&1; then
    echo "Healthy."
    break
  fi
  echo "  not yet healthy, waiting 30s (attempt $i/60)..."
  sleep 30
done

echo "== Registering this deployment with Quorum =="
curl -sf -X POST "$QUORUM_API_BASE/api/admin/register-private-deployment" \
  -H "x-admin-key: $QUORUM_ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"userId\": \"$CUSTOMER_USER_ID\",
    \"cloudProvider\": \"$CLOUD\",
    \"modelFamily\": \"$MODEL_FAMILY\",
    \"endpointUrl\": \"$ENDPOINT_URL\",
    \"endpointApiKey\": \"$API_KEY\",
    \"fastModel\": \"$FAST_MODEL\",
    \"premiumModel\": \"$PREMIUM_MODEL\",
    \"imageVersion\": \"initial-deploy\"
  }"

echo ""
echo "== Done. $CUSTOMER_USER_ID is now live on Private tier ($CLOUD/$MODEL_FAMILY) at $ENDPOINT_URL =="

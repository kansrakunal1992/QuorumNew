#!/usr/bin/env bash
# infra/updater/check-and-update.sh
# ── Auto-updater — makes fixes/enhancements percolate automatically ──────────
#
# Runs on every customer's VM (installed by each cloud's Terraform module —
# see infra/aws/, infra/gcp/, infra/azure/), triggered on a timer (every 15
# minutes — see quorum-updater.timer). This is what satisfies "enhancements
# or fixes percolate automatically" without needing the customer's IT team to
# do anything: when Quorum publishes a new image tag to the registry, every
# deployed customer picks it up on their next timer tick.
#
# Safety is the whole point of this script existing as its own step rather
# than just `docker pull && docker restart` in a one-liner:
#   1. Pull the new image, but don't touch the running container yet.
#   2. Compare digests — if nothing changed, exit immediately (no-op, no
#      restart, no interrupted requests on the vast majority of ticks).
#   3. If there IS a new image, start it on a SECOND port, health-check it
#      BEFORE touching the live container.
#   4. Only if the new container passes its health check: swap traffic to it
#      (stop the old container, the new one takes over the real port),
#      report the new version back to Quorum via a health-ping.
#   5. If the new container FAILS its health check: stop and discard it,
#      leave the old (known-good) container running untouched, and log the
#      failure loudly. A bad image never takes down a customer's deployment
#      — it just means that customer stays on the previous version until the
#      next successful update.
#
# This script is intentionally provider-agnostic — it only talks to Docker
# and to Quorum's own API, nothing AWS/GCP/Azure-specific. The per-cloud
# Terraform modules are only responsible for getting a GPU VM up with Docker
# installed and this script running on a timer; everything past that point
# is identical across all three clouds.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

IMAGE="${QUORUM_IMAGE:-ghcr.io/quorum/private-inference:stable}"
LIVE_CONTAINER_NAME="${QUORUM_CONTAINER_NAME:?required — e.g. quorum-fast or quorum-premium, set per-role by the Terraform module}"
LIVE_PORT="${QUORUM_LIVE_PORT:?required}"
STAGING_PORT="${QUORUM_STAGING_PORT:?required}"
MODEL_NAME="${QUORUM_MODEL_NAME:?required}"
API_KEY_FILE="${QUORUM_API_KEY_FILE:-/etc/quorum/api-key}"       # written once at first deploy, never rotated by this script
CUSTOMER_USER_ID="${QUORUM_CUSTOMER_USER_ID:?required — used only for the health-ping below, never sent anywhere else}"
QUORUM_HEALTH_PING_URL="${QUORUM_HEALTH_PING_URL:-https://app.quorum.example.com/api/admin/private-deployment-health}"
QUORUM_ADMIN_KEY_FILE="${QUORUM_ADMIN_KEY_FILE:-/etc/quorum/admin-key}"  # scoped narrowly to this one health-ping call, not the customer's model API key

log() { echo "[$(date -u +%FT%TZ)] $*"; }

API_KEY="$(cat "$API_KEY_FILE")"

log "Checking for a newer image than what's currently running ($IMAGE)..."
docker pull "$IMAGE" --quiet

RUNNING_DIGEST="$(docker inspect --format='{{.Image}}' "$LIVE_CONTAINER_NAME" 2>/dev/null || echo 'none')"
LATEST_DIGEST="$(docker inspect --format='{{.Id}}' "$IMAGE")"

if [ "$RUNNING_DIGEST" = "$LATEST_DIGEST" ]; then
  log "No update available — running digest matches latest. Nothing to do."
  exit 0
fi

log "New image found. Starting it on staging port $STAGING_PORT for a health check before touching live traffic..."
STAGING_CONTAINER="quorum-staging-$$"
docker run -d --rm \
  --name "$STAGING_CONTAINER" \
  --gpus all \
  -p "${STAGING_PORT}:8000" \
  -e "MODEL_NAME=${MODEL_NAME}" \
  -e "API_KEY=${API_KEY}" \
  "$IMAGE"

# vLLM's own /health endpoint — wait up to 3 minutes for the model to finish
# loading into GPU memory before deciding the health check has failed. Large
# models can genuinely take a couple of minutes to load; this isn't a
# generous timeout, it's a realistic one.
HEALTHY=false
for i in $(seq 1 36); do
  if curl -sf "http://localhost:${STAGING_PORT}/health" > /dev/null 2>&1; then
    HEALTHY=true
    break
  fi
  sleep 5
done

if [ "$HEALTHY" != true ]; then
  log "FAILED health check — new image did not become healthy within 3 minutes. Discarding it, leaving the current deployment untouched."
  docker stop "$STAGING_CONTAINER" > /dev/null 2>&1 || true
  # Deliberately not exiting non-zero here — a failed update is not a script
  # failure, it's the safety mechanism working as intended. The systemd
  # timer should not treat this as an error state.
  exit 0
fi

log "New image passed its health check. Swapping live traffic to it..."
docker stop "$LIVE_CONTAINER_NAME" > /dev/null 2>&1 || true
docker rm "$LIVE_CONTAINER_NAME" > /dev/null 2>&1 || true
docker stop "$STAGING_CONTAINER" > /dev/null 2>&1
docker run -d --restart unless-stopped \
  --name "$LIVE_CONTAINER_NAME" \
  --gpus all \
  -p "${LIVE_PORT}:8000" \
  -e "MODEL_NAME=${MODEL_NAME}" \
  -e "API_KEY=${API_KEY}" \
  "$IMAGE"

log "Update complete. Reporting new version back to Quorum..."
ADMIN_KEY="$(cat "$QUORUM_ADMIN_KEY_FILE" 2>/dev/null || echo '')"
if [ -n "$ADMIN_KEY" ]; then
  curl -sf -X POST "$QUORUM_HEALTH_PING_URL" \
    -H "x-admin-key: ${ADMIN_KEY}" \
    -H "Content-Type: application/json" \
    -d "{\"userId\":\"${CUSTOMER_USER_ID}\",\"imageVersion\":\"${LATEST_DIGEST}\"}" \
    || log "Health-ping failed (non-fatal) — deployment succeeded locally regardless."
else
  log "No admin key configured for health-ping — skipping (deployment succeeded locally regardless)."
fi

log "Done."

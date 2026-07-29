# infra/docker/Dockerfile
# ── Private tier model-serving container ──────────────────────────────────────
#
# One image, runs identically on AWS/GCP/Azure — the whole point of doing
# this as a container instead of a hand-configured VM. Wraps vLLM (the same
# serving stack the original self-hosted proof-of-concept used) with an
# OpenAI-compatible API, which is what lib/ai-client.ts's getPrivateClient()
# expects (it uses the standard `openai` SDK pointed at this container's URL
# — see that function's doc comment).
#
# Which MODEL this container serves is NOT baked into the image — it's
# supplied at container start via the MODEL_NAME env var (see entrypoint.sh).
# This is what makes ONE image work for both fast and premium roles, and for
# either Qwen or Mistral family — the image is generic, the model is
# configuration. Each customer's VM runs two containers (or two model
# processes — see infra/README.md's sizing note): one with
# MODEL_NAME=<their fast model>, one with MODEL_NAME=<their premium model>.
#
# Published to a registry all three clouds can pull from equally (avoids
# maintaining three separate registries) — ghcr.io (GitHub Container
# Registry) or Docker Hub both work; infra/README.md assumes ghcr.io in
# examples, swap freely.
# ─────────────────────────────────────────────────────────────────────────────

FROM vllm/vllm-openai:latest
# ^ vLLM's own maintained image already bundles CUDA, the vLLM server, and
# the OpenAI-compatible API surface. Building this from a bare CUDA base and
# installing vLLM ourselves would just be reproducing what this image
# already does correctly — not worth the maintenance burden of tracking
# vLLM's own dependency pins ourselves.

# Health-check + auto-updater hooks live in a thin wrapper script rather than
# vLLM's own entrypoint, so we can add graceful-drain-before-restart logic
# (see infra/updater/check-and-update.sh) without patching vLLM itself.
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# MODEL_NAME, API_KEY, and PORT are supplied at `docker run` time (see the
# per-cloud Terraform modules' cloud-init/startup scripts) — never baked into
# the image, so the same image serves any customer's chosen model.
ENV PORT=8000

EXPOSE 8000

ENTRYPOINT ["/entrypoint.sh"]

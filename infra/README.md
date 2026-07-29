# infra/ — Private tier one-click deploy

Deploys a Private-tier customer's dedicated, self-hosted model-serving
infrastructure into **their own** cloud account — AWS, GCP, or Azure — with
automatic updates, without Quorum's SaaS backend ever needing direct network
access to their internal systems beyond one authenticated HTTPS endpoint.

## Architecture, in one paragraph

Each customer gets one GPU VM in their own cloud account, running two Docker
containers (one per role — fast/premium), fronted by Caddy for automatic
HTTPS. A systemd timer on the VM checks every 15 minutes for a newer version
of Quorum's inference-serving image and safely rolls it out (health-checked
before traffic switches, auto-rollback if the new version fails) — that's
what makes "fixes and enhancements percolate automatically" true without
the customer's IT team doing anything. Quorum's SaaS backend talks to the
VM the same way it talks to Mistral's or Anthropic's API: an HTTPS call with
a bearer token. No VPN, no direct infra access, no need to deploy the whole
Quorum app into their environment — see the chat history for why that
full-air-gap alternative was rejected (much higher engineering/support cost
for not much additional sovereignty benefit, since the data still never
touches Quorum's infrastructure either way — see `lib/product-tier.ts` and
`lib/ai-client.ts`'s `PrivateEndpoint` for the code side of this).

## Why a GPU VM instead of a serverless GPU container

AWS Fargate, GCP Cloud Run, and Azure Container Instances/Apps all have GPU
support at some level as of writing, but maturity is uneven across the
three (Azure retired ACI's GPU offering entirely in mid-2025; the other two
are newer/less battle-tested for this specific workload). Betting the
one-click-deploy design on that would mean re-verifying each cloud's GPU
container support before every future change. A plain GPU VM + Docker +
a small auto-updater script is boring, but it's provably identical and
reliable across all three clouds today — worth revisiting if serverless GPU
containers mature further and the VM-management overhead becomes worth
trading away.

## Files

```
infra/
  README.md                    — this file
  deploy.sh                    — the actual one-click entry point
  shared/
    bootstrap.sh.tpl            — VM setup logic, identical across all 3 clouds
  docker/
    Dockerfile                  — the model-serving image (wraps vLLM)
    entrypoint.sh                — wires env vars into vLLM's launch command
  updater/
    check-and-update.sh          — the auto-updater (health-checked, auto-rollback)
    quorum-updater.service       — systemd oneshot unit
    quorum-updater.timer         — systemd timer, every 15 min
  aws/    main.tf, outputs.tf   — AWS-specific provisioning only
  gcp/    main.tf, outputs.tf   — GCP-specific provisioning only
  azure/  main.tf, outputs.tf   — Azure-specific provisioning only
```

Only `aws/`, `gcp/`, `azure/` differ per cloud — everything else
(bootstrap logic, the container image, the updater) is 100% shared.
Adding a fourth cloud later means writing one more `main.tf`/`outputs.tf`
pair, not touching anything else.

## Running a deploy

```bash
export QUORUM_ADMIN_KEY=<SUPABASE_SERVICE_ROLE_KEY>
# + that customer's own cloud credentials active in this shell
# (aws configure / gcloud auth application-default login / az login)

./deploy.sh aws <customer_user_id> mistral acme-corp.private.quorum.example.com
```

Prerequisites `deploy.sh` assumes are already done (see its own top comment
for the full list) — the customer already has `product_tier = 'private'`
via `/api/admin/grant-mirror-access`, and you'll be prompted mid-script to
point DNS at the printed IP before it continues.

## Real gaps, not yet resolved — read before using this for a real customer

- **GPU sizing is unvalidated.** Each cloud module picks a reasonable
  default instance/machine/VM size, but none have been load-tested against
  the actual chosen model sizes and quantization strategy. Do that before
  the first real customer deploy.
- **GPU quota.** All three clouds default new accounts/subscriptions to
  zero GPU quota. Each customer needs to request a quota increase — this
  can take days — before `terraform apply` will even succeed. Flag this in
  the sales conversation, not at deploy time.
- **DNS automation.** `deploy.sh` currently pauses and asks a human to
  create the DNS record manually. Could be automated against whichever DNS
  provider the customer/Quorum controls the zone with — not built here
  since that varies per deployment.
- **API key rotation.** Nothing currently rotates a customer's
  `endpoint_api_key` — re-running `deploy.sh` against an existing customer
  generates a new one and overwrites the old (a redeploy), but there's no
  scheduled/automatic rotation.
- **Cost visibility.** Nothing here estimates or surfaces the customer's
  ongoing cloud bill to them before they commit to a deploy — worth
  surfacing given the earlier ₹15K–40K+/month infra-cost research.

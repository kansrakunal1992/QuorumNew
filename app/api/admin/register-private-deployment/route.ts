// app/api/admin/register-private-deployment/route.ts
// ── Register a Private-tier customer's self-hosted deployment ────────────────
//
// Separate from /api/admin/grant-mirror-access on purpose: that endpoint
// handles ACCESS (who's on which product_tier, billing-shaped). This one
// handles INFRASTRUCTURE (where their deployed instance actually lives).
// A customer typically goes through both, in order:
//   1. grant-mirror-access with productTier: 'private' — they're a Private
//      customer, but private_deployments has no row for them yet (a normal,
//      expected gap — see lib/ai-client.ts's error message for this state).
//   2. infra/<provider>/terraform provisions their GPU VM (see infra/README.md).
//   3. The deploy script's LAST step calls this endpoint with the resulting
//      URL/key/models — that's what closes the gap and makes their account
//      actually functional on Private tier.
//
// Called by: infra/deploy.sh (see that script's final step) — not meant to
// be called manually except for recovery/re-registration after a redeploy.
//
// Body:
//   {
//     userId:         string  — Supabase auth.users UUID
//     cloudProvider:  'aws' | 'gcp' | 'azure'
//     modelFamily:    'qwen' | 'mistral'          — must match this
//                                                    customer's mirror_access.private_model_family
//     endpointUrl:    string  — https://... , the customer's deployed instance
//     endpointApiKey: string  — generated at deploy time (infra/*/terraform
//                                generates and outputs this — see that
//                                module's outputs.tf)
//     fastModel:      string  — literal model name for the fast role
//     premiumModel:   string  — literal model name for the premium role
//     imageVersion?:  string  — the container image tag/digest just deployed,
//                                for drift tracking across customers
//   }
//
// Always a full upsert (ON CONFLICT user_id) — re-running the deploy script
// against an existing customer (e.g. to rotate their API key, or redeploy
// onto new hardware) simply overwrites the row with the new values.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import type { ProductTier } from '@/lib/types'

export async function POST(req: Request) {
  const adminKey = req.headers.get('x-admin-key')
  if (adminKey !== process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: {
    userId?:         string
    cloudProvider?:  string
    modelFamily?:    string
    endpointUrl?:    string
    endpointApiKey?: string
    fastModel?:      string
    premiumModel?:   string
    imageVersion?:   string
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { userId, cloudProvider, modelFamily, endpointUrl, endpointApiKey, fastModel, premiumModel, imageVersion } = body

  if (!userId || !cloudProvider || !modelFamily || !endpointUrl || !endpointApiKey || !fastModel || !premiumModel) {
    return NextResponse.json(
      { error: 'userId, cloudProvider, modelFamily, endpointUrl, endpointApiKey, fastModel, and premiumModel are all required' },
      { status: 400 },
    )
  }

  if (!['aws', 'gcp', 'azure'].includes(cloudProvider)) {
    return NextResponse.json({ error: `cloudProvider must be one of: aws, gcp, azure` }, { status: 400 })
  }
  if (!['qwen', 'mistral'].includes(modelFamily)) {
    return NextResponse.json({ error: `modelFamily must be one of: qwen, mistral` }, { status: 400 })
  }

  const supabase = createServiceClient()

  // Sanity check: this customer should already be on Private tier (step 1
  // in the doc comment above) before their infra gets registered. Not a
  // hard block — a deploy done slightly out of order shouldn't fail loudly
  // here — but worth a warning in the response.
  const { data: access } = await supabase
    .from('mirror_access')
    .select('product_tier, private_model_family')
    .eq('user_id', userId)
    .maybeSingle()

  const tierWarning = !access || (access.product_tier as ProductTier) !== 'private'
    ? `Note: this user's mirror_access.product_tier is currently '${access?.product_tier ?? '(no row)'}', not 'private' — grant Private access via /api/admin/grant-mirror-access if that wasn't intentional.`
    : null

  const familyMismatch = access?.private_model_family && access.private_model_family !== modelFamily
    ? `Note: mirror_access.private_model_family is '${access.private_model_family}' but this deployment is '${modelFamily}' — they'll disagree until one is corrected.`
    : null

  const { error } = await supabase
    .from('private_deployments')
    .upsert(
      {
        user_id:          userId,
        cloud_provider:   cloudProvider,
        model_family:     modelFamily,
        endpoint_url:     endpointUrl,
        endpoint_api_key: endpointApiKey,
        fast_model:       fastModel,
        premium_model:    premiumModel,
        image_version:    imageVersion ?? null,
        deployed_at:      new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    )

  if (error) {
    console.error('[register-private-deployment] upsert error:', error)
    return NextResponse.json({ error: 'DB write failed' }, { status: 500 })
  }

  console.log(`[register-private-deployment] Registered ${cloudProvider}/${modelFamily} deployment for ${userId} at ${endpointUrl}`)

  return NextResponse.json({
    ok: true,
    userId,
    cloudProvider,
    modelFamily,
    endpointUrl,
    warnings: [tierWarning, familyMismatch].filter(Boolean),
  })
}

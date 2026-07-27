// app/api/admin/grant-mirror-access/route.ts
// ── Admin: Manual Mirror Access Grant (Sprint 19) ────────────────────────────
//
// POST /api/admin/grant-mirror-access
//
// Service-role-only endpoint for granting mirror access manually.
// Covers: advisory client provisioning, beta grants, support overrides.
//
// Body:
//   {
//     userId:      string               — Supabase auth.users UUID
//     accessType:  'advisory' | 'monthly' | 'annual'
//     durationDays?: number            — optional; if omitted, expires_at = null
//                                        (advisory default)
//     productTier?: 'elite' | 'private' — Locked v1 pricing tier. Defaults to
//                                        'elite' if omitted (matches the DB
//                                        column default — every grant issued
//                                        before this field existed was Elite
//                                        under the new naming).
//     privateModelFamily?: 'qwen' | 'mistral' — REQUIRED when productTier is
//                                        'private' (TD-LD-7's Option A/B —
//                                        the buyer's self-hosted choice,
//                                        never silently defaulted at grant
//                                        time). Ignored/rejected otherwise.
//     modelRouteFast?:    RouteOverride  — TD-LD-10/TD-LD-11 per-user routing
//     modelRoutePremium?: RouteOverride    override, checked before this
//                                        account's tier default in
//                                        lib/ai-client.ts. Typically used to
//                                        force the founder's own account to
//                                        a specific model (e.g. 'deepseek')
//                                        for testing while everyone else
//                                        routes normally by tier. Omit or
//                                        pass null to clear an existing
//                                        override — every grant call is a
//                                        full upsert, so omitting a
//                                        previously-set override removes it.
//   }
//
// Private is the expected use of this endpoint going forward: custom
// pricing + minimum seats makes it inherently sales-led (TD-LD-8), not
// self-serve checkout — so it's provisioned here rather than automatically
// via the Razorpay webhook, same as it always has been for advisory grants.
// Elite is normally automatic via the webhook; this endpoint still accepts
// it for support overrides/beta grants.
//
// All writes use ON CONFLICT (user_id) DO UPDATE (upsert) to handle the unique
// index on mirror_access.user_id — replaces any existing row for this user.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import type { SubscriptionPlan, ProductTier, PrivateModelFamily, RouteOverride } from '@/lib/types'

const VALID_ROUTE_OVERRIDES: RouteOverride[] = ['deepseek', 'mistral_cloud', 'anthropic_elite', 'qwen_selfhosted', 'mistral_selfhosted']

export async function POST(req: Request) {
  // Service-role guard
  const adminKey = req.headers.get('x-admin-key')
  if (adminKey !== process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: {
    userId?:              string
    accessType?:          string
    durationDays?:        number
    productTier?:         string
    privateModelFamily?:  string
    modelRouteFast?:      string | null
    modelRoutePremium?:   string | null
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { userId, accessType, durationDays, privateModelFamily, modelRouteFast, modelRoutePremium } = body
  const productTier = body.productTier ?? 'elite'

  if (!userId || !accessType) {
    return NextResponse.json({ error: 'userId and accessType required' }, { status: 400 })
  }

  const validTypes: SubscriptionPlan[] = ['monthly', 'annual', 'advisory']
  if (!validTypes.includes(accessType as SubscriptionPlan)) {
    return NextResponse.json(
      { error: `accessType must be one of: ${validTypes.join(', ')}` },
      { status: 400 },
    )
  }

  const validTiers: ProductTier[] = ['elite', 'private']
  if (!validTiers.includes(productTier as ProductTier)) {
    return NextResponse.json(
      { error: `productTier must be one of: ${validTiers.join(', ')}` },
      { status: 400 },
    )
  }

  const validFamilies: PrivateModelFamily[] = ['qwen', 'mistral']
  if (productTier === 'private' && !validFamilies.includes(privateModelFamily as PrivateModelFamily)) {
    return NextResponse.json(
      { error: `privateModelFamily is required and must be one of: ${validFamilies.join(', ')} when productTier is 'private'` },
      { status: 400 },
    )
  }
  if (productTier !== 'private' && privateModelFamily) {
    return NextResponse.json(
      { error: `privateModelFamily is only valid when productTier is 'private'` },
      { status: 400 },
    )
  }

  // TD-LD-10/TD-LD-11 routing override validation — either field can be
  // omitted/null (no override for that role), but if present must be a
  // recognised target.
  if (modelRouteFast != null && !VALID_ROUTE_OVERRIDES.includes(modelRouteFast as RouteOverride)) {
    return NextResponse.json(
      { error: `modelRouteFast must be one of: ${VALID_ROUTE_OVERRIDES.join(', ')}` },
      { status: 400 },
    )
  }
  if (modelRoutePremium != null && !VALID_ROUTE_OVERRIDES.includes(modelRoutePremium as RouteOverride)) {
    return NextResponse.json(
      { error: `modelRoutePremium must be one of: ${VALID_ROUTE_OVERRIDES.join(', ')}` },
      { status: 400 },
    )
  }

  const now = new Date()
  let expiresAt: string | null = null

  if (durationDays != null && durationDays > 0) {
    const exp = new Date(now)
    exp.setDate(exp.getDate() + durationDays)
    expiresAt = exp.toISOString()
  }
  // advisory defaults to null (never expires) unless durationDays given

  const supabase = createServiceClient()

  const { error } = await supabase
    .from('mirror_access')
    .upsert(
      {
        user_id:              userId,
        access_type:          accessType as SubscriptionPlan,
        granted_at:           now.toISOString(),
        started_at:           now.toISOString(),
        expires_at:           expiresAt,
        product_tier:         productTier as ProductTier,
        private_model_family: productTier === 'private' ? (privateModelFamily as PrivateModelFamily) : null,
        model_route_fast:      modelRouteFast ?? null,
        model_route_premium:   modelRoutePremium ?? null,
      },
      { onConflict: 'user_id' },
    )

  if (error) {
    console.error('[grant-mirror-access] upsert error:', error)
    return NextResponse.json({ error: 'DB write failed' }, { status: 500 })
  }

  console.log(
    `[grant-mirror-access] Granted ${accessType} (${productTier}${productTier === 'private' ? `/${privateModelFamily}` : ''}) ` +
    `to ${userId} (expires: ${expiresAt ?? 'never'})` +
    `${modelRouteFast || modelRoutePremium ? ` — override fast=${modelRouteFast ?? 'none'} premium=${modelRoutePremium ?? 'none'}` : ''}`,
  )

  return NextResponse.json({
    ok:                 true,
    userId,
    accessType,
    productTier,
    privateModelFamily: productTier === 'private' ? privateModelFamily : null,
    modelRouteFast:      modelRouteFast ?? null,
    modelRoutePremium:   modelRoutePremium ?? null,
    expiresAt,
    grantedAt:  now.toISOString(),
  })
}

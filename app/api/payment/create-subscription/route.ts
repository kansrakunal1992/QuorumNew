// app/api/payment/create-subscription/route.ts
// ── Mirror: Razorpay Subscription Creation (Sprint CX-PAY) ───────────────────
//
// POST /api/payment/create-subscription
//
// Auth: Bearer token (user Supabase JWT — NOT x-admin-key).
//       Replaces the Sprint 19 admin-gated stub. Manual grants still available
//       via /api/admin/grant-mirror-access; unlock codes via /api/mirror/unlock.
//
// Body:
//   { plan: 'monthly' | 'annual' | 'founding_monthly' | 'founding_annual' }
//
// Response:
//   { subscriptionId: string, keyId: string }
//
// Creates a Razorpay Subscription against the correct plan ID and returns the
// subscription_id + public key_id to the client for checkout. No payment is
// captured here — this is the pre-checkout step only. The webhook handler at
// /api/payment/webhook writes mirror_access on subscription.activated.
//
// 'founding_monthly' / 'founding_annual' (Founding Elite, cap 20 — see
// lib/founding.ts) are NOT separate billing-cycle types as far as the
// webhook is concerned. notes.plan is sent as the underlying billing cycle
// ('monthly' or 'annual') — the webhook's existing monthly/annual handling
// is unchanged. A separate notes.founding marker is what tells the webhook
// to also set founding_member = true, regardless of which cycle it is.
// The 20-member cap is enforced HERE (server-side), not just hidden in the
// UI — see lib/founding.ts. FOUNDER_OVERRIDE=true bypasses it for testing.
//
// Env vars required (Railway):
//   NEXT_PUBLIC_RAZORPAY_KEY_ID          — public key (rzp_test_ / rzp_live_)
//   RAZORPAY_KEY_SECRET                  — private key (server only, never client)
//   RAZORPAY_MONTHLY_PLAN_ID             — plan_xxx from Razorpay dashboard
//   RAZORPAY_ANNUAL_PLAN_ID              — plan_xxx from Razorpay dashboard
//   RAZORPAY_FOUNDING_MONTHLY_PLAN_ID    — plan_xxx, Founding Elite Monthly (₹999/mo)
//   RAZORPAY_FOUNDING_ANNUAL_PLAN_ID     — plan_xxx, Founding Elite Annual (₹9,999/yr —
//                                          confirm this against whatever price is actually
//                                          configured on the Razorpay plan; the UI copy
//                                          must match it, see app/mirror/page.tsx)
//   FOUNDER_OVERRIDE                     — 'true' bypasses the 20-member cap (testing only)
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse }  from 'next/server'
import Razorpay                        from 'razorpay'
import { createClient as createAnonClient } from '@supabase/supabase-js'
import { createServiceClient }         from '@/lib/supabase'
import { isFoundingAvailable }         from '@/lib/founding'

// ── Razorpay client ───────────────────────────────────────────────────────────
// Instantiated at module level — connection is reused across requests.
function getRazorpay() {
  const keyId     = process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID
  const keySecret = process.env.RAZORPAY_KEY_SECRET
  if (!keyId || !keySecret) {
    throw new Error('RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET not set')
  }
  return new Razorpay({ key_id: keyId, key_secret: keySecret })
}

export async function POST(req: NextRequest) {
  // ── 1. Resolve user from Bearer token ────────────────────────────────────
  const authHeader = req.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const token = authHeader.slice(7)

  const anonClient = createAnonClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
  const { data: { user } } = await anonClient.auth.getUser(token)
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // ── 2. Validate plan ──────────────────────────────────────────────────────
  let body: { plan?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { plan } = body
  const validPlans = ['monthly', 'annual', 'founding_monthly', 'founding_annual']
  if (!plan || !validPlans.includes(plan)) {
    return NextResponse.json(
      { error: `plan must be one of: ${validPlans.join(', ')}` },
      { status: 400 },
    )
  }

  const isFounding = plan === 'founding_monthly' || plan === 'founding_annual'

  // ── 2b. Founding cap — enforced server-side, not just hidden in the UI.
  // Same helper the Mirror page's status check uses, so the two can't drift.
  if (isFounding) {
    const supabase = createServiceClient()
    if (!(await isFoundingAvailable(supabase))) {
      return NextResponse.json(
        { error: 'founding_full', message: 'Founding Elite is no longer available. Elite is still open.' },
        { status: 409 },
      )
    }
  }

  // ── 3. Resolve Razorpay plan ID ───────────────────────────────────────────
  const monthlyPlanId         = process.env.RAZORPAY_MONTHLY_PLAN_ID
  const annualPlanId          = process.env.RAZORPAY_ANNUAL_PLAN_ID
  const foundingMonthlyPlanId = process.env.RAZORPAY_FOUNDING_MONTHLY_PLAN_ID
  const foundingAnnualPlanId  = process.env.RAZORPAY_FOUNDING_ANNUAL_PLAN_ID

  if (!monthlyPlanId || !annualPlanId) {
    console.error('[create-subscription] RAZORPAY_MONTHLY_PLAN_ID or RAZORPAY_ANNUAL_PLAN_ID not set')
    return NextResponse.json({ error: 'Payment not configured' }, { status: 503 })
  }
  if (plan === 'founding_monthly' && !foundingMonthlyPlanId) {
    console.error('[create-subscription] RAZORPAY_FOUNDING_MONTHLY_PLAN_ID not set')
    return NextResponse.json({ error: 'Payment not configured' }, { status: 503 })
  }
  if (plan === 'founding_annual' && !foundingAnnualPlanId) {
    console.error('[create-subscription] RAZORPAY_FOUNDING_ANNUAL_PLAN_ID not set')
    return NextResponse.json({ error: 'Payment not configured' }, { status: 503 })
  }

  const planId =
    plan === 'founding_monthly' ? foundingMonthlyPlanId! :
    plan === 'founding_annual'  ? foundingAnnualPlanId!  :
    plan === 'annual'           ? annualPlanId           :
    monthlyPlanId

  // Founding bills on the same monthly/annual cadence as the standard
  // plans — this is the value sent to Razorpay/the webhook as notes.plan,
  // so all existing monthly/annual handling (expires_at math,
  // SubscriptionPlan type) stays unchanged regardless of founding status.
  // notes.founding (below) is the separate marker that tells the webhook
  // to also set founding_member = true.
  const billingCycle: 'monthly' | 'annual' =
    plan === 'founding_annual' || plan === 'annual' ? 'annual' : 'monthly'

  // ── 4. Create Razorpay subscription ──────────────────────────────────────
  //
  // total_count: maximum billing cycles before the subscription auto-expires.
  // 120 months (~10 yr) and 10 annual cycles are practical ceilings — Razorpay
  // does not support indefinite (0) for most plan types.
  //
  // notes.user_id and notes.plan are injected into subscription.activated and
  // payment.captured webhook payloads — the webhook handler reads these to
  // upsert mirror_access without a separate DB lookup.
  // ─────────────────────────────────────────────────────────────────────────
  let subscription: { id: string }
  try {
    const razorpay = getRazorpay()
    subscription = await (razorpay.subscriptions.create as Function)({
      plan_id:         planId,
      total_count:     billingCycle === 'annual' ? 10 : 120,
      quantity:        1,
      customer_notify: 1,
      notes: {
        user_id:  user.id,
        email:    user.email ?? '',
        plan:     billingCycle,
        ...(isFounding ? { founding: 'true' } : {}),
      },
    })
  } catch (err) {
    console.error('[create-subscription] Razorpay error:', err)
    return NextResponse.json({ error: 'Subscription creation failed' }, { status: 502 })
  }

  return NextResponse.json({
    subscriptionId: subscription.id,
    keyId:          process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
  })
}

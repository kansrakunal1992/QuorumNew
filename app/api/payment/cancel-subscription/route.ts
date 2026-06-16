// app/api/payment/cancel-subscription/route.ts
// ── Mirror: Cancel Razorpay Subscription (Sprint CX-PAY) ─────────────────────
//
// POST /api/payment/cancel-subscription
//
// Auth: Bearer token (user Supabase JWT).
//
// Behaviour:
//   - Looks up the user's mirror_access row to get the Razorpay subscription_id
//     (stored in payment_id column by the webhook on subscription.activated).
//   - Calls razorpay.subscriptions.cancel(id, { cancel_at_cycle_end: true })
//     so the subscription cancels at the END of the current billing period —
//     the user keeps Mirror access until their paid period expires naturally.
//   - Does NOT touch mirror_access — expires_at gates access, and the
//     subscription.cancelled webhook (no-op) handles the event.
//   - Returns { ok, expiresAt, message } so the client can show the user
//     when their access ends.
//
// Error cases handled:
//   - No mirror_access row → 404
//   - advisory tier → 403 (advisory not self-service cancellable)
//   - No Razorpay subscription_id (code-based access) → 400 with clear message
//   - Razorpay API failure → 502
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse }          from 'next/server'
import Razorpay                   from 'razorpay'
import { getUserFromBearer }      from '@/lib/audit'
import { createServiceClient }    from '@/lib/supabase'

function getRazorpay() {
  const keyId     = process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID
  const keySecret = process.env.RAZORPAY_KEY_SECRET
  if (!keyId || !keySecret) throw new Error('Razorpay keys not configured')
  return new Razorpay({ key_id: keyId, key_secret: keySecret })
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'long', year: 'numeric',
  })
}

export async function POST(req: Request) {
  // ── 1. Auth ───────────────────────────────────────────────────────────────
  const user = await getUserFromBearer(req)
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // ── 2. Fetch mirror_access row ────────────────────────────────────────────
  const supabase = createServiceClient()

  const { data: access, error: fetchError } = await supabase
    .from('mirror_access')
    .select('access_type, payment_id, expires_at')
    .eq('user_id', user.id)
    .maybeSingle()

  if (fetchError || !access) {
    return NextResponse.json(
      { error: 'No active subscription found.' },
      { status: 404 },
    )
  }

  // ── 3. Guard: advisory tier is not self-service cancellable ───────────────
  if (access.access_type === 'advisory') {
    return NextResponse.json(
      { error: 'advisory_plan', message: 'Advisory access is managed directly. Contact us to make changes.' },
      { status: 403 },
    )
  }

  // ── 4. Guard: code-based access has no Razorpay subscription ─────────────
  const subscriptionId = access.payment_id as string | null
  if (!subscriptionId || !subscriptionId.startsWith('sub_')) {
    return NextResponse.json(
      {
        error:   'no_razorpay_subscription',
        message: 'This access was activated with a code. Contact us to cancel.',
      },
      { status: 400 },
    )
  }

  // ── 5. Cancel at cycle end via Razorpay ───────────────────────────────────
  try {
    const razorpay = getRazorpay()
    await (razorpay.subscriptions.cancel as Function)(subscriptionId, true)
    // Second arg `true` = cancel_at_cycle_end in Razorpay Node SDK v2
  } catch (err) {
    console.error('[cancel-subscription] Razorpay error:', err)
    return NextResponse.json(
      { error: 'Cancellation failed. Please try again or contact us.' },
      { status: 502 },
    )
  }

  const expiresAt   = access.expires_at as string | null
  const expiresText = expiresAt ? formatDate(expiresAt) : 'the end of your billing period'

  console.log(`[cancel-subscription] Cancelled sub ${subscriptionId} for user ${user.id} | access until: ${expiresAt}`)

  return NextResponse.json({
    ok:        true,
    expiresAt,
    message:   `Subscription cancelled. Mirror access continues until ${expiresText}.`,
  })
}

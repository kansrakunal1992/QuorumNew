// app/api/payment/webhook/route.ts
// ── Mirror: Razorpay Webhook Handler (Sprint CX-PAY) ─────────────────────────
//
// POST /api/payment/webhook
//
// No Bearer token — verified via HMAC-SHA256 (x-razorpay-signature header).
//
// Handled events:
//   subscription.activated   → upsert mirror_access (initial activation)
//   payment.captured         → extend expires_at on renewal
//   subscription.cancelled   → no-op (row remains, expires_at gates naturally)
//   subscription.expired     → no-op (same)
//   all others               → 200 / ignored (prevents Razorpay retry storms)
//
// expires_at buffer: +3 days over plan period to absorb late webhook delivery.
//   monthly → +33 days
//   annual  → +368 days
//
// notes contract (set on subscription at creation time):
//   notes.user_id  — Supabase auth.users UUID
//   notes.plan     — 'monthly' | 'annual'
//
// Env vars required (Railway):
//   RAZORPAY_WEBHOOK_SECRET  — copy from Razorpay Dashboard → Webhooks
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server'
import crypto                         from 'crypto'
import { createServiceClient }        from '@/lib/supabase'
import type { SubscriptionPlan }      from '@/lib/types'

// ── Helpers ───────────────────────────────────────────────────────────────────

function getExpiresAt(plan: 'monthly' | 'annual'): string {
  const d = new Date()
  if (plan === 'monthly') d.setDate(d.getDate() + 33)   // 30 days + 3-day buffer
  if (plan === 'annual')  d.setDate(d.getDate() + 368)  // 365 days + 3-day buffer
  return d.toISOString()
}

function verifySignature(rawBody: string, signature: string, secret: string): boolean {
  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex')
  // Constant-time comparison to prevent timing attacks
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected, 'hex'),
      Buffer.from(signature,  'hex'),
    )
  } catch {
    return false
  }
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // ── 1. Read raw body before any parsing (required for HMAC) ──────────────
  const rawBody   = await req.text()
  const signature = req.headers.get('x-razorpay-signature') ?? ''

  // ── 2. Verify HMAC-SHA256 signature ──────────────────────────────────────
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET
  if (!webhookSecret) {
    console.error('[webhook] RAZORPAY_WEBHOOK_SECRET not set — endpoint disabled')
    return NextResponse.json({ error: 'Misconfigured' }, { status: 503 })
  }

  if (!verifySignature(rawBody, signature, webhookSecret)) {
    console.warn('[webhook] Signature mismatch — request rejected')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  // ── 3. Parse payload ──────────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let event: { event: string; payload: Record<string, any> }
  try {
    event = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const eventName = event.event
  console.log(`[webhook] ${eventName}`)

  const supabase = createServiceClient()

  // ─────────────────────────────────────────────────────────────────────────
  // Event: subscription.activated
  // Fires when first payment is captured and the subscription becomes active.
  // This is the primary activation event — write the mirror_access row here.
  // ─────────────────────────────────────────────────────────────────────────
  if (eventName === 'subscription.activated') {
    const sub = event.payload?.subscription?.entity
    if (!sub) {
      console.warn('[webhook] subscription.activated: missing entity')
      return NextResponse.json({ ok: true })
    }

    const userId = sub.notes?.user_id as string | undefined
    const plan   = sub.notes?.plan   as string | undefined

    if (!userId || (plan !== 'monthly' && plan !== 'annual')) {
      console.error('[webhook] subscription.activated: missing user_id or invalid plan', sub.notes)
      // Return 200 — Razorpay would retry a 4xx indefinitely. Log the error instead.
      return NextResponse.json({ ok: true, warning: 'missing notes' })
    }

    const now       = new Date().toISOString()
    const expiresAt = getExpiresAt(plan as 'monthly' | 'annual')

    const { error } = await supabase
      .from('mirror_access')
      .upsert(
        {
          user_id:     userId,
          access_type: plan as SubscriptionPlan,
          granted_at:  now,
          started_at:  now,
          expires_at:  expiresAt,
          payment_id:  sub.id,                      // Razorpay subscription_id stored here
          payment_ref: `razorpay:sub:${sub.id}`,
        },
        { onConflict: 'user_id' },
      )

    if (error) {
      console.error('[webhook] subscription.activated upsert failed:', error)
      // Return 500 so Razorpay retries — this is a genuine write failure
      return NextResponse.json({ error: 'DB write failed' }, { status: 500 })
    }

    console.log(`[webhook] Mirror activated | user: ${userId} | plan: ${plan} | expires: ${expiresAt}`)
    return NextResponse.json({ ok: true })
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Event: payment.captured
  // Fires for every successful payment — including the first (before
  // subscription.activated fires) and all subsequent renewals.
  //
  // For the initial payment: subscription.activated fires alongside and
  // handles the upsert. If payment.captured fires first (race), we do the
  // same upsert using notes.user_id if present.
  //
  // For renewals: extend expires_at by looking up the existing row via
  // the subscription_id stored in payment_id column.
  // ─────────────────────────────────────────────────────────────────────────
  if (eventName === 'payment.captured') {
    const payment = event.payload?.payment?.entity
    if (!payment?.subscription_id) {
      // Not a subscription payment (e.g. one-time order) — ignore
      return NextResponse.json({ ok: true })
    }

    const subscriptionId = payment.subscription_id as string

    // Try notes first (propagated from subscription to payment by Razorpay)
    const userId = payment.notes?.user_id as string | undefined
    const plan   = payment.notes?.plan   as string | undefined

    if (userId && (plan === 'monthly' || plan === 'annual')) {
      // Have full context — upsert directly (handles both initial + renewal)
      const expiresAt = getExpiresAt(plan)
      const now       = new Date().toISOString()

      const { error } = await supabase
        .from('mirror_access')
        .upsert(
          {
            user_id:     userId,
            access_type: plan as SubscriptionPlan,
            granted_at:  now,
            started_at:  now,
            expires_at:  expiresAt,
            payment_id:  subscriptionId,
            payment_ref: `razorpay:sub:${subscriptionId}`,
          },
          { onConflict: 'user_id' },
        )

      if (error) {
        console.error('[webhook] payment.captured upsert failed:', error)
        return NextResponse.json({ error: 'DB write failed' }, { status: 500 })
      }

      console.log(`[webhook] Mirror extended (via notes) | user: ${userId} | plan: ${plan} | expires: ${expiresAt}`)
      return NextResponse.json({ ok: true })
    }

    // Notes not propagated — fall back to DB lookup by subscription_id
    const { data: accessRow } = await supabase
      .from('mirror_access')
      .select('user_id, access_type')
      .eq('payment_id', subscriptionId)
      .maybeSingle()

    if (!accessRow) {
      // Row not yet written (subscription.activated may not have fired yet).
      // Return 200 — Razorpay will retry subscription.activated separately.
      console.warn(`[webhook] payment.captured: no mirror_access row for sub ${subscriptionId} — likely pre-activation race, safe to ignore`)
      return NextResponse.json({ ok: true })
    }

    const rowPlan   = accessRow.access_type as 'monthly' | 'annual'
    const expiresAt = getExpiresAt(rowPlan)

    const { error } = await supabase
      .from('mirror_access')
      .update({ expires_at: expiresAt })
      .eq('user_id', accessRow.user_id)

    if (error) {
      console.error('[webhook] payment.captured renewal update failed:', error)
      return NextResponse.json({ error: 'DB write failed' }, { status: 500 })
    }

    console.log(`[webhook] Mirror renewed (via DB lookup) | user: ${accessRow.user_id} | expires: ${expiresAt}`)
    return NextResponse.json({ ok: true })
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Events: subscription.cancelled / subscription.expired
  // No-op by design. The mirror_access row stays intact; expires_at gates
  // access naturally. User retains Mirror until their paid period ends —
  // cleaner UX than immediate revocation, consistent with SaaS conventions.
  // ─────────────────────────────────────────────────────────────────────────
  if (eventName === 'subscription.cancelled' || eventName === 'subscription.expired') {
    const subId = event.payload?.subscription?.entity?.id ?? 'unknown'
    console.log(`[webhook] ${eventName} for sub ${subId} — no-op, expires_at gates naturally`)
    return NextResponse.json({ ok: true })
  }

  // ── Unhandled event — return 200 to prevent Razorpay retry ───────────────
  return NextResponse.json({ ok: true, ignored: eventName })
}

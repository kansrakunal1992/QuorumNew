// app/api/decision-session/verify-order/route.ts
// ── Live Quorum Decision Session — Payment Verification ──────────────────────
//
// POST /api/decision-session/verify-order
//
// This is the security-critical step: the browser is NEVER trusted alone to
// say "payment succeeded" (Razorpay's checkout `handler` callback firing is
// not proof of payment — anyone could call this endpoint directly with made-
// up IDs). The only thing that proves a real payment happened is the
// signature Razorpay itself computes and returns after checkout, which can
// only be reproduced server-side with RAZORPAY_KEY_SECRET. This route
// recomputes it and compares. Same HMAC-SHA256 + timing-safe-compare
// approach as the existing subscription webhook (app/api/payment/webhook),
// applied to Razorpay's order-payment verification formula instead of a
// webhook payload.
//
// Only on a verified match do we mark the row 'paid' and hand back a
// booking_token — the website will not open the Google Calendar modal
// without one.
//
// Body:
//   { razorpayOrderId: string, razorpayPaymentId: string, razorpaySignature: string }
//
// Response:
//   { verified: true, token: string } | { verified: false }
//
// Env vars required: RAZORPAY_KEY_SECRET (same one used everywhere else).
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server'
import crypto                         from 'crypto'
import { createServiceClient }        from '@/lib/supabase'
import { corsHeaders }                from '@/lib/decision-session-cors'

function verifyOrderSignature(orderId: string, paymentId: string, signature: string, secret: string): boolean {
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${orderId}|${paymentId}`)
    .digest('hex')
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature, 'hex'))
  } catch {
    return false
  }
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req.headers.get('origin')) })
}

export async function POST(req: NextRequest) {
  const cors = corsHeaders(req.headers.get('origin'))

  let body: { razorpayOrderId?: string; razorpayPaymentId?: string; razorpaySignature?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400, headers: cors })
  }

  const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = body
  if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400, headers: cors })
  }

  const secret = process.env.RAZORPAY_KEY_SECRET
  if (!secret) {
    console.error('[decision-session/verify-order] RAZORPAY_KEY_SECRET not set')
    return NextResponse.json({ error: 'Payment not configured' }, { status: 503, headers: cors })
  }

  if (!verifyOrderSignature(razorpayOrderId, razorpayPaymentId, razorpaySignature, secret)) {
    console.warn('[decision-session/verify-order] Signature mismatch — rejected')
    return NextResponse.json({ verified: false }, { status: 400, headers: cors })
  }

  const supabase = createServiceClient()

  // ── Idempotent: if this order was already verified (e.g. the browser
  // retried after a dropped response), just hand back the same token
  // rather than erroring or minting a second one. ──────────────────────────
  const { data: existing } = await supabase
    .from('decision_session_payments')
    .select('status, booking_token')
    .eq('razorpay_order_id', razorpayOrderId)
    .maybeSingle()

  if (!existing) {
    console.error('[decision-session/verify-order] No order row for', razorpayOrderId)
    return NextResponse.json({ error: 'Unknown order' }, { status: 404, headers: cors })
  }

  if (existing.status === 'paid' && existing.booking_token) {
    return NextResponse.json({ verified: true, token: existing.booking_token }, { headers: cors })
  }

  const token = crypto.randomBytes(24).toString('hex')

  const { error: updateError } = await supabase
    .from('decision_session_payments')
    .update({
      status:              'paid',
      razorpay_payment_id: razorpayPaymentId,
      booking_token:       token,
      paid_at:             new Date().toISOString(),
    })
    .eq('razorpay_order_id', razorpayOrderId)

  if (updateError) {
    console.error('[decision-session/verify-order] DB update failed:', updateError)
    return NextResponse.json({ error: 'Verification write failed' }, { status: 500, headers: cors })
  }

  console.log(`[decision-session/verify-order] Verified payment | order: ${razorpayOrderId} | payment: ${razorpayPaymentId}`)
  return NextResponse.json({ verified: true, token }, { headers: cors })
}

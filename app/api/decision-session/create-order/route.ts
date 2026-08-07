// app/api/decision-session/create-order/route.ts
// ── Live Quorum Decision Session — Razorpay Order Creation ───────────────────
//
// POST /api/decision-session/create-order
//
// Called directly from the marketing website (quorumvault.org/kunal), NOT
// from inside the app — so, unlike every other payment route in this
// codebase, there is deliberately NO auth check here. This is guest
// checkout: an anonymous ad visitor with no Quorum account pays ₹299 for a
// single live session. See supabase/add_decision_session_payments.sql for
// why this is its own table rather than reusing mirror_access.
//
// This is a Razorpay ONE-TIME ORDER (razorpay.orders.create), not a
// Subscription — the existing /api/payment/create-subscription route
// creates recurring Elite/Founding Elite subscriptions and requires a
// signed-in user; that machinery doesn't fit a single ₹299 charge from
// someone who has never signed up. Same Razorpay account, same
// RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET, same signature-verification
// philosophy as everywhere else — just the Orders API instead of the
// Subscriptions API.
//
// Body (all optional):
//   { utmSource?: string, utmCampaign?: string, utmContent?: string }
//
// Response:
//   { orderId: string, keyId: string, amount: number, currency: 'INR' }
//   (amount is in paise, as Razorpay checkout expects)
//
// Env vars required (Railway — same ones create-subscription already uses):
//   NEXT_PUBLIC_RAZORPAY_KEY_ID   — public key (rzp_test_ / rzp_live_)
//   RAZORPAY_KEY_SECRET           — private key (server only)
// Optional:
//   DECISION_SESSION_AMOUNT_INR   — defaults to 299
//   WEBSITE_ORIGIN                — see lib/decision-session-cors.ts
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server'
import Razorpay                       from 'razorpay'
import { createServiceClient }        from '@/lib/supabase'
import { corsHeaders }                from '@/lib/decision-session-cors'

function getRazorpay() {
  const keyId     = process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID
  const keySecret = process.env.RAZORPAY_KEY_SECRET
  if (!keyId || !keySecret) {
    throw new Error('RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET not set')
  }
  return new Razorpay({ key_id: keyId, key_secret: keySecret })
}

function getAmountInr(): number {
  const raw = process.env.DECISION_SESSION_AMOUNT_INR
  const parsed = raw ? parseInt(raw, 10) : NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 299
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req.headers.get('origin')) })
}

export async function POST(req: NextRequest) {
  const cors = corsHeaders(req.headers.get('origin'))

  let body: { utmSource?: string; utmCampaign?: string; utmContent?: string }
  try {
    body = await req.json()
  } catch {
    body = {}
  }

  const amountInr   = getAmountInr()
  const amountPaise = amountInr * 100

  // ── 1. Create the Razorpay order ─────────────────────────────────────────
  let order: { id: string }
  try {
    const razorpay = getRazorpay()
    order = await (razorpay.orders.create as Function)({
      amount:   amountPaise,
      currency: 'INR',
      notes: {
        product: 'decision_session',
        source:  'website',
        ...(body.utmSource  ? { utm_source:  body.utmSource  } : {}),
        ...(body.utmCampaign ? { utm_campaign: body.utmCampaign } : {}),
        ...(body.utmContent ? { utm_content: body.utmContent } : {}),
      },
    })
  } catch (err) {
    console.error('[decision-session/create-order] Razorpay error:', err)
    return NextResponse.json({ error: 'Order creation failed' }, { status: 502, headers: cors })
  }

  // ── 2. Record the order before checkout even opens ───────────────────────
  // If this insert fails we still fail the request — better to not open
  // checkout at all than to take a payment we have no record of.
  const supabase = createServiceClient()
  const { error: dbError } = await supabase
    .from('decision_session_payments')
    .insert({
      razorpay_order_id: order.id,
      status:            'created',
      amount_inr:         amountInr,
      utm_source:         body.utmSource  ?? null,
      utm_campaign:        body.utmCampaign ?? null,
      utm_content:        body.utmContent ?? null,
    })

  if (dbError) {
    console.error('[decision-session/create-order] DB insert failed:', dbError)
    return NextResponse.json({ error: 'Order creation failed' }, { status: 500, headers: cors })
  }

  return NextResponse.json(
    {
      orderId:  order.id,
      keyId:    process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
      amount:   amountPaise,
      currency: 'INR',
    },
    { headers: cors },
  )
}

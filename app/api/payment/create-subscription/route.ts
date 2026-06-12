// app/api/payment/create-subscription/route.ts
// ── Mirror Subscription Provisioning (Sprint 19) ─────────────────────────────
//
// POST /api/payment/create-subscription
//
// Upserts a mirror_access row for the given user with the correct plan and expiry.
// This is currently a STUB — payment gateway integration (Razorpay / Stripe) to be
// wired in Sprint 20. For now it accepts a manual provision call from admin or
// a test/dev override.
//
// Body:
//   { userId: string, plan: 'monthly' | 'annual' | 'advisory', paymentId?: string }
//
// Response:
//   { ok: true, accessType: string, expiresAt: string | null }
//
// ── Sprint 4 (S4-03): Auth header fix ────────────────────────────────────────
// VULNERABILITY FIXED: previous code compared x-admin-key against
// SUPABASE_SERVICE_ROLE_KEY — the DB master key was being transmitted over HTTP
// and logged by Railway and any proxy layer.
//
// FIX: a separate PAYMENT_WEBHOOK_SECRET env var is used for this route only.
// The service role key is never sent over HTTP.
//
// Set PAYMENT_WEBHOOK_SECRET in Railway → Variables to a random 32+ char secret:
//   openssl rand -hex 32
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import type { SubscriptionPlan } from '@/lib/types'

function getExpiresAt(plan: SubscriptionPlan): string | null {
  if (plan === 'advisory') return null
  const now = new Date()
  if (plan === 'monthly') {
    now.setMonth(now.getMonth() + 1)
  } else if (plan === 'annual') {
    now.setFullYear(now.getFullYear() + 1)
  }
  return now.toISOString()
}

export async function POST(req: Request) {
  // ── S4-03: Auth guard — use PAYMENT_WEBHOOK_SECRET, never the service role key
  const paymentSecret = process.env.PAYMENT_WEBHOOK_SECRET
  if (!paymentSecret) {
    // Misconfigured deployment — fail closed, log loudly
    console.error('[create-subscription] PAYMENT_WEBHOOK_SECRET is not set. Endpoint disabled.')
    return NextResponse.json({ error: 'Endpoint not configured' }, { status: 503 })
  }

  const incomingKey = req.headers.get('x-admin-key')
  if (!incomingKey || incomingKey !== paymentSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { userId?: string; plan?: string; paymentId?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { userId, plan, paymentId } = body
  if (!userId || !plan) {
    return NextResponse.json({ error: 'userId and plan required' }, { status: 400 })
  }

  const validPlans: SubscriptionPlan[] = ['monthly', 'annual', 'advisory']
  if (!validPlans.includes(plan as SubscriptionPlan)) {
    return NextResponse.json(
      { error: `plan must be one of: ${validPlans.join(', ')}` },
      { status: 400 },
    )
  }

  const accessType = plan as SubscriptionPlan
  const expiresAt  = getExpiresAt(accessType)
  const now        = new Date().toISOString()

  const supabase = createServiceClient()

  const { error } = await supabase
    .from('mirror_access')
    .upsert(
      {
        user_id:     userId,
        access_type: accessType,
        granted_at:  now,
        started_at:  now,
        expires_at:  expiresAt,
        payment_id:  paymentId ?? null,
      },
      { onConflict: 'user_id' },
    )

  if (error) {
    console.error('[create-subscription] upsert error:', error)
    return NextResponse.json({ error: 'DB write failed' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, accessType, expiresAt })
}

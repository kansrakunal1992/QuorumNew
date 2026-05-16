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
//   { userId: string, plan: 'monthly' | 'annual' | 'lifetime', paymentId?: string }
//
// Response:
//   { ok: true, accessType: string, expiresAt: string | null }
//
// Auth: requires service-role level caller OR an admin-bypass header for testing.
//       In production this will be called by the payment webhook, not the client.
//
// Uses ON CONFLICT (user_id) DO UPDATE to respect the unique index on user_id.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import type { SubscriptionPlan } from '@/lib/types'

function getExpiresAt(plan: SubscriptionPlan): string | null {
  if (plan === 'lifetime' || plan === 'advisory') return null
  const now = new Date()
  if (plan === 'monthly') {
    now.setMonth(now.getMonth() + 1)
  } else if (plan === 'annual') {
    now.setFullYear(now.getFullYear() + 1)
  }
  return now.toISOString()
}

export async function POST(req: Request) {
  // Simple auth guard — require the service header in this stub
  // (replace with webhook signature verification in Sprint 20)
  const adminKey = req.headers.get('x-admin-key')
  if (adminKey !== process.env.SUPABASE_SERVICE_ROLE_KEY) {
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

  const validPlans: SubscriptionPlan[] = ['monthly', 'annual', 'lifetime', 'advisory']
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

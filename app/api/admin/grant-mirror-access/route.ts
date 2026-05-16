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
//     accessType:  'lifetime' | 'advisory' | 'monthly' | 'annual'
//     durationDays?: number            — optional; if omitted, expires_at = null
//                                        (lifetime / advisory default)
//   }
//
// All writes use ON CONFLICT (user_id) DO UPDATE (upsert) to handle the unique
// index on mirror_access.user_id — replaces any existing row for this user.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import type { SubscriptionPlan } from '@/lib/types'

export async function POST(req: Request) {
  // Service-role guard
  const adminKey = req.headers.get('x-admin-key')
  if (adminKey !== process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { userId?: string; accessType?: string; durationDays?: number }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { userId, accessType, durationDays } = body

  if (!userId || !accessType) {
    return NextResponse.json({ error: 'userId and accessType required' }, { status: 400 })
  }

  const validTypes: SubscriptionPlan[] = ['monthly', 'annual', 'lifetime', 'advisory']
  if (!validTypes.includes(accessType as SubscriptionPlan)) {
    return NextResponse.json(
      { error: `accessType must be one of: ${validTypes.join(', ')}` },
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
  // lifetime and advisory default to null (never expires) unless durationDays given

  const supabase = createServiceClient()

  const { error } = await supabase
    .from('mirror_access')
    .upsert(
      {
        user_id:     userId,
        access_type: accessType as SubscriptionPlan,
        granted_at:  now.toISOString(),
        started_at:  now.toISOString(),
        expires_at:  expiresAt,
      },
      { onConflict: 'user_id' },
    )

  if (error) {
    console.error('[grant-mirror-access] upsert error:', error)
    return NextResponse.json({ error: 'DB write failed' }, { status: 500 })
  }

  console.log(`[grant-mirror-access] Granted ${accessType} to ${userId} (expires: ${expiresAt ?? 'never'})`)

  return NextResponse.json({
    ok:         true,
    userId,
    accessType,
    expiresAt,
    grantedAt:  now.toISOString(),
  })
}

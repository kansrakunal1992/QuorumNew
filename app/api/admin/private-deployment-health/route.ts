// app/api/admin/private-deployment-health/route.ts
// ── Auto-updater health-ping receiver ─────────────────────────────────────────
//
// Called by infra/updater/check-and-update.sh after EVERY successful update
// on a customer's VM (see that script's final step) — updates
// private_deployments.image_version and last_healthy_at so you can see
// deployment drift across customers (who's on the latest image, who's
// stuck) from a single query, without needing direct access to any
// customer's infrastructure.
//
// Deliberately tiny and narrow-scoped — this is the ONLY thing the
// auto-updater calls back to Quorum for. It does not receive logs, metrics,
// or any customer data; just "this user_id's deployment is now running
// image X, as of now."
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'

export async function POST(req: Request) {
  const adminKey = req.headers.get('x-admin-key')
  if (adminKey !== process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { userId?: string; imageVersion?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { userId, imageVersion } = body
  if (!userId) {
    return NextResponse.json({ error: 'userId required' }, { status: 400 })
  }

  const supabase = createServiceClient()
  const { error } = await supabase
    .from('private_deployments')
    .update({
      image_version:   imageVersion ?? null,
      last_healthy_at: new Date().toISOString(),
    })
    .eq('user_id', userId)

  if (error) {
    console.error('[private-deployment-health] update error:', error)
    return NextResponse.json({ error: 'DB write failed' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

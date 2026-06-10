// app/api/push/subscribe/route.ts
// ─────────────────────────────────────────────────────────────────────────────
// POST /api/push/subscribe
//
// Called by PushEnablePrompt after the user grants notification permission.
// Saves (or updates) the browser's PushSubscription to push_subscriptions table.
//
// Body: { endpoint: string, keys: { p256dh: string, auth: string } }
// Auth: Authorization: Bearer <supabase_jwt>
//
// Response:
//   200 { ok: true }
//   400 { error: 'Missing fields' }
//   401 { error: 'Unauthorized' }
//   500 { error: 'Server error' }
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse }         from 'next/server'
import { createServiceClient } from '@/lib/supabase'

export async function POST(req: Request) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const authHeader = req.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const token    = authHeader.slice(7)
  const supabase = createServiceClient()

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token)
  if (authErr || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // ── Parse body ────────────────────────────────────────────────────────────
  let body: { endpoint?: string; keys?: { p256dh?: string; auth?: string } }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { endpoint, keys } = body
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return NextResponse.json({ error: 'Missing fields: endpoint, keys.p256dh, keys.auth' }, { status: 400 })
  }

  // ── Upsert subscription ───────────────────────────────────────────────────
  // ON CONFLICT on endpoint: update keys + user_id (handles re-subscription
  // after key rotation, and re-login on same browser).
  const { error: upsertErr } = await supabase
    .from('push_subscriptions')
    .upsert(
      {
        user_id:     user.id,
        endpoint,
        p256dh:      keys.p256dh,
        auth_key:    keys.auth,
        last_used_at: new Date().toISOString(),
      },
      { onConflict: 'endpoint' }
    )

  if (upsertErr) {
    console.error('[PushSubscribe] DB upsert failed:', upsertErr)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }

  console.log(`[PushSubscribe] Saved subscription for user ${user.id.slice(0, 8)}`)
  return NextResponse.json({ ok: true })
}

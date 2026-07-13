// app/api/mirror/avoidance/dismiss/route.ts
// ── Sprint D3: Avoidance Alert Dismiss Endpoint ───────────────────────────────
//
// POST /api/mirror/avoidance/dismiss
//
// Body: { alertId: string, action: 'new_session' | 'resolved_externally' }
// Auth: Authorization: Bearer <supabase session token>
//
// What it does:
//   1. Authenticates the user via Bearer token (same pattern as all Mirror routes).
//   2. Fetches the avoidance_alerts row — confirms it belongs to the user.
//   3. Sets dismissed_at = now() and action_taken on the row.
//   4. Returns { ok: true } on success; appropriate error status on failure.
//
// Item #33/#34 bugfix: 'resolved_externally' used to ALSO upsert a fake
// placeholder outcomes row here ("Resolved externally — marked via Mirror.")
// so the D2 cron wouldn't re-flag the session — meaning "Mark as resolved"
// silently closed the loop with no real record of what actually happened.
// That placeholder write is removed. The client now navigates to the
// session's record page after this call succeeds, so the person files a
// real outcome through the normal OutcomeTracker flow instead. If they
// dismiss and never come back to record anything, the session is simply
// eligible to be flagged again later (its own alert row stays dismissed —
// this isn't a lingering stale alert, it's a fresh one, which is correct:
// nothing was actually resolved).
//
// Ownership check: confirms avoidance_alerts.user_id === authenticated user_id.
// Never modifies another user's alerts.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse }                                   from 'next/server'
import { createServiceClient }                            from '@/lib/supabase'
import { createClient as createSupabaseClient }           from '@supabase/supabase-js'

export async function POST(req: Request) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const authHeader = req.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const token = authHeader.slice(7)
  let userId: string | null = null

  try {
    const anonClient = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    )
    const { data: { user } } = await anonClient.auth.getUser(token)
    userId = user?.id ?? null
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // ── Parse body ────────────────────────────────────────────────────────────
  let alertId: string
  let action: 'new_session' | 'resolved_externally'

  try {
    const body = await req.json()
    if (!body?.alertId || typeof body.alertId !== 'string') {
      return NextResponse.json({ error: 'alertId required' }, { status: 400 })
    }
    alertId = body.alertId
    action  = body.action === 'new_session' ? 'new_session' : 'resolved_externally'
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const supabase = createServiceClient()

  // ── Ownership check ───────────────────────────────────────────────────────
  const { data: alertRow, error: fetchErr } = await supabase
    .from('avoidance_alerts')
    .select('id, user_id, session_id, dismissed_at')
    .eq('id', alertId)
    .single()

  if (fetchErr || !alertRow) {
    return NextResponse.json({ error: 'Alert not found' }, { status: 404 })
  }

  if ((alertRow as any).user_id !== userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Idempotent: already dismissed
  if ((alertRow as any).dismissed_at) {
    return NextResponse.json({ ok: true })
  }

  // ── Set dismissed_at + action_taken ───────────────────────────────────────
  const { error: updateErr } = await supabase
    .from('avoidance_alerts')
    .update({
      dismissed_at: new Date().toISOString(),
      action_taken: action,
    })
    .eq('id', alertId)

  if (updateErr) {
    console.error('[AvoidanceDismiss] Update failed:', updateErr.message)
    return NextResponse.json({ error: 'Failed to dismiss' }, { status: 500 })
  }

  console.log(`[AvoidanceDismiss] Alert ${alertId} dismissed — action: ${action} | user: ${userId.slice(0, 8)}`)
  return NextResponse.json({ ok: true })
}

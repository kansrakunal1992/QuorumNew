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
//   4. If action = 'resolved_externally': upserts a minimal outcomes row so the
//      D2 cron does not re-flag this session on the next daily pass.
//      (Cron gate: session has no outcome row → alert. Minimal outcome row closes
//      the gate without requiring the user to file a full outcome.)
//   5. Returns { ok: true } on success; appropriate error status on failure.
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

  const sessionId = (alertRow as any).session_id as string

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

  // ── Minimal outcome row (resolved_externally path only) ───────────────────
  // Prevents D2 cron from re-flagging this session on the next daily pass.
  // Uses outcome_quality only — no confidence fields required.
  // Skips if the session already has an outcome row (upsert on session_id conflict).
  if (action === 'resolved_externally') {
    const { error: outcomeErr } = await supabase
      .from('outcomes')
      .upsert(
        {
          session_id:      sessionId,
          outcome_quality: 'resolved_externally',
          what_decided:    'Resolved externally — marked via Mirror.',
          created_at:      new Date().toISOString(),
        },
        { onConflict: 'session_id', ignoreDuplicates: true },
      )

    if (outcomeErr) {
      // Non-fatal — alert is already dismissed; outcome is a belt-and-suspenders guard
      console.warn('[AvoidanceDismiss] Outcome upsert failed (non-fatal):', outcomeErr.message)
    }
  }

  console.log(`[AvoidanceDismiss] Alert ${alertId} dismissed — action: ${action} | user: ${userId.slice(0, 8)}`)
  return NextResponse.json({ ok: true })
}

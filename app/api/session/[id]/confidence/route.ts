// app/api/session/[id]/confidence/route.ts
// S2-01: Captures post-synthesis confidence re-rate (1–10) from the 3-tap widget
// in SynthesisCard. Writes post_decision_confidence to the sessions table.
// The delta between pre_decision_confidence and post_decision_confidence is
// the core calibration signal — "did the Council move you?".
//
// Identity check: accepts session ownership via user_id (Bearer token), user_email,
// or device_id — same pattern as the validate route.

import { NextResponse }          from 'next/server'
import { createServiceClient }   from '@/lib/supabase'

interface Params { params: Promise<{ id: string }> }

export async function PATCH(req: Request, { params }: Params) {
  try {
    const { id: sessionId } = await params
    if (!sessionId) return NextResponse.json({ error: 'sessionId required' }, { status: 400 })

    const { post_decision_confidence, device_id, user_email } = await req.json()

    if (
      typeof post_decision_confidence !== 'number' ||
      post_decision_confidence < 1 ||
      post_decision_confidence > 10
    ) {
      return NextResponse.json({ error: 'post_decision_confidence must be 1–10' }, { status: 400 })
    }

    // Derive user_id from Bearer token (best-effort)
    let serverUserId: string | null = null
    const authHeader = req.headers.get('Authorization')
    if (authHeader?.startsWith('Bearer ')) {
      try {
        const { createClient } = await import('@/lib/supabase')
        const anonClient = createClient()
        const { data: { user } } = await anonClient.auth.getUser(authHeader.slice(7).trim())
        serverUserId = user?.id ?? null
      } catch { /* non-blocking */ }
    }

    const supabase = createServiceClient()

    // Verify ownership
    const { data: row } = await supabase
      .from('sessions')
      .select('user_id, user_email, device_id, post_decision_confidence')
      .eq('id', sessionId)
      .single()

    if (!row) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

    // Idempotency guard: don't overwrite an existing rating
    if (row.post_decision_confidence !== null && row.post_decision_confidence !== undefined) {
      return NextResponse.json({ ok: true, skipped: true })
    }

    const ownerEmail = user_email?.trim().toLowerCase() || null
    const owns = !!(
      (serverUserId && row.user_id    === serverUserId) ||
      (ownerEmail   && row.user_email === ownerEmail)   ||
      (device_id    && row.device_id  === device_id)
    )

    if (!owns) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    await supabase
      .from('sessions')
      .update({ post_decision_confidence })
      .eq('id', sessionId)

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[Confidence] Route error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

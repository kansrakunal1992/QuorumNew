// app/api/session/validate/route.ts
// SB-1: Records the user's response to the ValidationCard.
// PATCH — sets validation_state, emotion_confirmed flag, and optional correction text.
// Auth optional — falls back to device_id / user_email identity chain (same as session creation).

import { createServiceClient, createClient } from '@/lib/supabase'
import { NextResponse } from 'next/server'

export async function PATCH(req: Request) {
  try {
    let serverUserId: string | null = null
    const authHeader = req.headers.get('Authorization')
    if (authHeader?.startsWith('Bearer ')) {
      try {
        const anon = createClient()
        const { data: { user } } = await anon.auth.getUser(authHeader.slice(7).trim())
        serverUserId = user?.id ?? null
      } catch { serverUserId = null }
    }

    const { session_id, validation_state, validation_emotion_confirmed, validation_correction, device_id, user_email } = await req.json()

    if (!session_id || !validation_state) {
      return NextResponse.json({ error: 'session_id and validation_state required' }, { status: 400 })
    }
    if (!['confirmed', 'corrected'].includes(validation_state)) {
      return NextResponse.json({ error: 'Invalid validation_state' }, { status: 400 })
    }
    if (validation_state === 'corrected' && !validation_correction?.trim()) {
      return NextResponse.json({ error: 'Correction text required when state is corrected' }, { status: 400 })
    }

    const supabase = createServiceClient()

    // ── Verify this session belongs to the caller (same identity chain as session creation) ──
    const { data: row } = await supabase
      .from('sessions')
      .select('user_id, user_email, device_id, validation_state')
      .eq('id', session_id)
      .single()

    if (!row) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

    // Already validated — idempotent: accept re-submissions silently
    if (row.validation_state !== 'pending') {
      return NextResponse.json({ ok: true, already_validated: true })
    }

    const requesterEmail = (user_email as string | undefined)?.trim().toLowerCase() ?? null
    const sameIdentity = !!(
      (serverUserId   && row.user_id    === serverUserId) ||
      (requesterEmail && row.user_email === requesterEmail) ||
      (device_id      && row.device_id  === device_id) ||
      // Allow unauthenticated if all identity fields are null (anonymous session)
      (!row.user_id && !row.user_email && !row.device_id)
    )

    if (!sameIdentity) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { error: updateError } = await supabase
      .from('sessions')
      .update({
        validation_state,
        validation_emotion_confirmed: validation_emotion_confirmed ?? null,
        validation_correction: validation_correction?.trim() ?? null,
      })
      .eq('id', session_id)

    if (updateError) {
      console.error('[Session Validate] Update failed:', updateError)
      return NextResponse.json({ error: 'Failed to save validation' }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[Session Validate] Error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

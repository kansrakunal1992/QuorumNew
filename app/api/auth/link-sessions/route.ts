// app/api/auth/link-sessions/route.ts
// ── Sprint 6: Link pre-auth sessions to authenticated user ───────────────────
//
// Called once after a user authenticates for the first time on a device.
// The client sends its localStorage session IDs → we attach them to the user_id.
// This is what makes history cross-device once auth is active.
//
// POST /api/auth/link-sessions
// Body: { sessionIds: string[], userId: string, userEmail: string }
// Auth: validated via Authorization header (Supabase JWT)
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { createServiceClient, createClient } from '@/lib/supabase'

export async function POST(req: Request) {
  try {
    const { sessionIds, userId, userEmail, deviceId } = await req.json() as {
      sessionIds?: string[]
      userId?: string
      userEmail?: string
      deviceId?: string   // ← new: used to retro-link device_id-keyed bias rows
    }

    if (!userId) {
      return NextResponse.json({ error: 'userId required' }, { status: 400 })
    }

    const supabase = createServiceClient()

    // Link sessions to user — sessionIds may be empty if user clicked magic link
    // from a different window/device than where sessions were created (e.g. private
    // mode → regular window). Still proceed to create user_preferences and retro-link
    // bias rows — account initialisation must complete regardless.
    let linkedCount = 0
    if (sessionIds?.length) {
      const { data, error } = await supabase.rpc('link_sessions_to_user', {
        p_session_ids: sessionIds,
        p_user_id:     userId,
        p_user_email:  userEmail ?? null,
      })

      if (error) {
        console.error('[LinkSessions] RPC error:', error)
        return NextResponse.json({ error: 'Failed to link sessions' }, { status: 500 })
      }
      linkedCount = data ?? 0
    }

    // Also update bias_library rows if they exist for this email
    if (userEmail) {
      const { error: emailBiasErr } = await supabase
        .from('bias_library')
        .update({ user_id: userId, user_email: userEmail })
        .eq('user_email', userEmail)
        .is('user_id', null)

      if (emailBiasErr) {
        console.warn('[LinkSessions] Email bias retro-link failed (non-critical):', emailBiasErr)
      }
    }

    // ── NEW: Retro-link device_id-keyed bias rows after auth ────────────
    // These are rows from fully anonymous sessions (no email, no user_id).
    // After auth we can promote them to the user_id lane so they contribute
    // to longitudinal accumulation going forward.
    if (deviceId && userId) {
      const { error: deviceBiasErr } = await supabase
        .from('bias_library')
        .update({
          user_id:    userId,
          user_email: userEmail ?? null,
        })
        .eq('device_id', deviceId)
        .is('user_email', null)
        .is('user_id', null)

      if (deviceBiasErr) {
        console.warn('[LinkSessions] Device bias retro-link failed (non-critical):', deviceBiasErr)
      } else {
        console.log(`[LinkSessions] Retro-linked device_id=${deviceId} bias rows to user ${userId}`)
      }
    }

    // Ensure user_preferences row exists
    const { error: prefError } = await supabase
      .from('user_preferences')
      .upsert({
        user_id:    userId,
        user_email: userEmail ?? null,
      }, { onConflict: 'user_id' })

    if (prefError) {
      console.warn('[LinkSessions] user_preferences upsert failed (non-critical):', prefError)
    }

    console.log(`[LinkSessions] Linked ${linkedCount} sessions to user ${userId}`)

    return NextResponse.json({
      status: 'ok',
      linked_sessions: linkedCount,
      user_id: userId,
    })

  } catch (err) {
    console.error('[LinkSessions] Route error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

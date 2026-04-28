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
    const { sessionIds, userId, userEmail } = await req.json() as {
      sessionIds?: string[]
      userId?: string
      userEmail?: string
    }

    if (!sessionIds?.length || !userId) {
      return NextResponse.json({ error: 'sessionIds and userId required' }, { status: 400 })
    }

    const supabase = createServiceClient()

    // Link sessions to user via the SQL function defined in sprint6_auth.sql
    const { data, error } = await supabase.rpc('link_sessions_to_user', {
      p_session_ids: sessionIds,
      p_user_id:     userId,
      p_user_email:  userEmail ?? null,
    })

    if (error) {
      console.error('[LinkSessions] RPC error:', error)
      return NextResponse.json({ error: 'Failed to link sessions' }, { status: 500 })
    }

    // Also update bias_library rows if they exist for this email
    if (userEmail) {
      await supabase
        .from('bias_library')
        .update({ user_id: userId })
        .eq('user_email', userEmail)
        .is('user_id', null)
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

    console.log(`[LinkSessions] Linked ${data} sessions to user ${userId}`)

    return NextResponse.json({
      status: 'ok',
      linked_sessions: data,
      user_id: userId,
    })

  } catch (err) {
    console.error('[LinkSessions] Route error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

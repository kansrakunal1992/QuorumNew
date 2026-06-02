// app/api/mirror/timeline/route.ts
// ── Mirror Module: Decision Timeline Route (Sprint 7a) ────────────────────────
//
// Returns authenticated user's full session history with ontology tags.
// Used by the free-tier Timeline view in Mirror (available to all users
// who meet the session threshold, whether or not they've paid for Mirror).
//
// Joins:
//   sessions → sessions_ontology (for decision type, reversibility, emotion)
//   sessions → outcomes (for outcome status)
//
// Auth: requires valid Bearer token. Returns 401 if not authenticated.
// Strict user isolation: only returns sessions for the authenticated user_id.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import type { TimelineSession } from '@/lib/types'
import { getMirrorAccessState } from '@/lib/mirror-access'
import { decrypt } from '@/lib/encryption'

export async function GET(req: Request) {
  const supabase = createServiceClient()

  // ── 1. Resolve user_id from Bearer token ──────────────────────────────────
  let userId: string | null = null

  const authHeader = req.headers.get('authorization')
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7)
    try {
      const anonClient = createSupabaseClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      )
      const { data: { user } } = await anonClient.auth.getUser(token)
      userId = user?.id ?? null
    } catch {
      // Invalid token
    }
  }

  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // ── 2. Mirror access gate ─────────────────────────────────────────────────
  // Timeline is visible in teaser state too — only block if fully locked
  const accessState = await getMirrorAccessState(userId, supabase)
  if (accessState === 'locked') {
    return NextResponse.json({ sessions: [] })
  }

  // ── 3. Fetch sessions with ontology (joined) ──────────────────────────────
  // sessions_ontology has a unique FK on session_id → PostgREST treats it as
  // a one-to-one relationship and returns a single object (not array).
  const { data: sessions, error } = await supabase
    .from('sessions')
    .select(`
      id,
      decision_text,
      created_at,
      register_mode,
      sessions_ontology (
        decision_type_primary,
        stakes_reversibility,
        dominant_emotion,
        tagger_status
      )
    `)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(100)

  if (error) {
    console.error('[Mirror/Timeline] DB error:', error)
    return NextResponse.json({ error: 'Failed to load sessions' }, { status: 500 })
  }

  if (!sessions || sessions.length === 0) {
    return NextResponse.json({ sessions: [] })
  }

  // ── 4. Fetch outcomes for these sessions ──────────────────────────────────
  const sessionIds = sessions.map(s => s.id)

  const { data: outcomes } = await supabase
    .from('outcomes')
    .select('session_id, what_decided')
    .in('session_id', sessionIds)

  const outcomeSet = new Set((outcomes ?? []).map(o => o.session_id as string))

  // ── 5. Shape response ─────────────────────────────────────────────────────
  // sessions_ontology may come back as object or array depending on PostgREST
  // version — handle both defensively.
  const result: TimelineSession[] = sessions.map(s => {
    const rawOnt = s.sessions_ontology
    const ont = Array.isArray(rawOnt) ? rawOnt[0] ?? null : rawOnt ?? null

    return {
      id: s.id,
      decision_text: decrypt(s.decision_text),
      created_at: s.created_at,
      register_mode: (s.register_mode as string | null) ?? null,
      decision_type_primary: ont?.decision_type_primary ?? null,
      stakes_reversibility: ont?.stakes_reversibility ?? null,
      dominant_emotion: ont?.dominant_emotion ?? null,
      tagger_status: ont?.tagger_status ?? null,
      has_outcome: outcomeSet.has(s.id),
    }
  })

  return NextResponse.json({ sessions: result })
}

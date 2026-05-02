// app/api/mirror/independence/route.ts
// ── Mirror Module: Independence Score Route (Sprint 7c) ───────────────────────
//
// GET  /api/mirror/independence
//   Auth-gated (Bearer token). Returns latest stored score for this user.
//   If no score exists yet, returns { score: null } — not an error.
//   Also requires mirror_access (score is a paid feature).
//
// POST /api/mirror/independence
//   Internal-only (no Bearer token check — called server-to-server from
//   /api/examiner POST as a fire-and-forget). Calculates score for the
//   user who owns the sessionId, stores in independence_score_log.
//   Idempotent per session: upserts on session_id.
//
// Storage: independence_score_log table (created in sprint7a_mirror_schema.sql)
//   One row per session calculated. Always appends; never overwrites history.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse }         from 'next/server'
import { createServiceClient }   from '@/lib/supabase'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { calculateIndependenceScore, getScoreBand } from '@/lib/independence-score'

// ── Auth helper (shared with fingerprint route) ───────────────────────────────

async function resolveUserId(req: Request): Promise<string | null> {
  const authHeader = req.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) return null
  const token = authHeader.slice(7)
  try {
    const anonClient = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    )
    const { data: { user } } = await anonClient.auth.getUser(token)
    return user?.id ?? null
  } catch {
    return null
  }
}

// ── GET — return latest score for authenticated user ──────────────────────────

export async function GET(req: Request) {
  const userId = await resolveUserId(req)
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient()

  // Require mirror_access — Independence Score is part of the paid tier
  const { data: accessRow } = await supabase
    .from('mirror_access')
    .select('id, expires_at')
    .eq('user_id', userId)
    .maybeSingle()

  if (!accessRow) {
    return NextResponse.json({ error: 'Mirror access required' }, { status: 403 })
  }

  if (accessRow.expires_at && new Date(accessRow.expires_at) < new Date()) {
    return NextResponse.json({ error: 'Mirror access has expired' }, { status: 403 })
  }

  // Fetch the most recent score entry for this user
  const { data: latestEntry } = await supabase
    .from('independence_score_log')
    .select('score, delta, calculated_at, signals')
    .eq('user_id', userId)
    .order('calculated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!latestEntry) {
    // No sessions scored yet — not an error
    return NextResponse.json({
      score:         null,
      delta:         null,
      band:          null,
      interpretation: null,
      sessionCount:  0,
      calculatedAt:  null,
    })
  }

  const band = getScoreBand(latestEntry.score)

  // Session count from signals jsonb (stored there for display)
  const sessionCount = (latestEntry.signals as Record<string, unknown> | null)?.sessionCount as number ?? 0

  return NextResponse.json({
    score:          latestEntry.score,
    delta:          latestEntry.delta,
    band:           band.label,
    interpretation: band.interpretation,
    sessionCount,
    calculatedAt:   latestEntry.calculated_at,
  })
}

// ── POST — calculate + store score (called internally from examiner route) ────

export async function POST(req: Request) {
  let sessionId: string | undefined

  try {
    const body = await req.json()
    sessionId = body.sessionId
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId required' }, { status: 400 })
  }

  const supabase = createServiceClient()

  // ── Resolve user_id from session ───────────────────────────────────────────
  const { data: session } = await supabase
    .from('sessions')
    .select('user_id, user_email')
    .eq('id', sessionId)
    .maybeSingle()

  if (!session?.user_id) {
    // Can't score without a user_id — independence score is longitudinal,
    // requires auth to accumulate across sessions
    return NextResponse.json({ ok: false, reason: 'no_user_id' })
  }

  const userId    = session.user_id
  const userEmail = session.user_email

  // ── Calculate score ────────────────────────────────────────────────────────
  const result = await calculateIndependenceScore(userId)

  if (!result) {
    return NextResponse.json({ ok: false, reason: 'no_sessions' })
  }

  // ── Store in independence_score_log ────────────────────────────────────────
  // One row per session. If this session was already scored (re-trigger),
  // update it rather than inserting a duplicate.
  const { error } = await supabase
    .from('independence_score_log')
    .upsert(
      {
        user_id:       userId,
        user_email:    userEmail,
        session_id:    sessionId,
        score:         result.score,
        delta:         result.delta,
        calculated_at: result.calculatedAt,
        signals: {
          sessionCount:  result.sessionCount,
          sessionScores: result.sessionScores,
          band:          result.band.label,
        },
      },
      { onConflict: 'session_id' },
    )

  if (error) {
    console.error('[independence] Supabase upsert error:', error)
    return NextResponse.json({ ok: false, error: 'DB error' }, { status: 500 })
  }

  return NextResponse.json({
    ok:    true,
    score: result.score,
    delta: result.delta,
    band:  result.band.label,
  })
}

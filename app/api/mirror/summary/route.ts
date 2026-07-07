// app/api/mirror/summary/route.ts
// ── Sprint M1: Mirror Summary — aggregated above-fold snapshot ────────────────
//
// GET /api/mirror/summary
//
// Returns a single aggregated payload consumed by MirrorSummaryCard:
//
//   independenceScore     — latest score (null if never scored)
//   scoreDelta            — delta from previous sessions (null on first score)
//   examinerQuote         — longest Examiner response from the most recent session
//   confirmedPatternCount — bias_library rows where detection_count >= 2
//   formingPatternCount   — bias_library rows where detection_count === 1
//   openLoopCount         — decisions >30 days old with no outcome filed
//   nextAction            — actionPlan string from SRI (weakest sub-score fix)
//   sessionCount          — total sessions for this user
//   sinceLastVisit        — human-readable delta line, or null on first visit
//
// Side effect: upserts user_preferences.last_mirror_viewed_at to NOW() so the
// NEXT visit correctly computes the "since last visit" delta line.
//
// DB migration (run once):
//   ALTER TABLE user_preferences
//   ADD COLUMN IF NOT EXISTS last_mirror_viewed_at TIMESTAMPTZ;
//
// Auth + Mirror-access gated. Same auth pattern as other mirror routes.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse }                         from 'next/server'
import { createServiceClient }                  from '@/lib/supabase'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { getMirrorAccessState }                 from '@/lib/mirror-access'
import { computeUserSessionScores }             from '@/lib/session-score'
import { decrypt }                              from '@/lib/encryption'

// ── Auth helper (same pattern as preferences/route.ts) ────────────────────────

async function resolveUserId(req: Request): Promise<string | null> {
  const header = req.headers.get('authorization')
  if (!header?.startsWith('Bearer ')) return null
  const token = header.slice(7)
  try {
    const anon = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    )
    const { data: { user } } = await anon.auth.getUser(token)
    return user?.id ?? null
  } catch {
    return null
  }
}

// ── Relative date label ───────────────────────────────────────────────────────

function relativeLabel(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (diff === 0) return 'today'
  if (diff === 1) return 'yesterday'
  if (diff < 7)  return `${diff} days ago`
  return new Date(iso).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })
}

// ── Build "since last visit" one-liner ────────────────────────────────────────

function buildSinceLine(p: {
  lastViewedAt:      string | null
  scoreCalcAt:       string | null
  scoreDelta:        number | null
  newContradictions: number
}): string | null {
  if (!p.lastViewedAt) return null
  const parts: string[] = []

  if (
    p.scoreCalcAt &&
    new Date(p.scoreCalcAt) > new Date(p.lastViewedAt) &&
    p.scoreDelta !== null
  ) {
    if      (p.scoreDelta > 0) parts.push(`Independence +${p.scoreDelta} pts`)
    else if (p.scoreDelta < 0) parts.push(`Independence ${p.scoreDelta} pts`)
  }

  if (p.newContradictions === 1) parts.push('1 new contradiction')
  else if (p.newContradictions > 1) parts.push(`${p.newContradictions} new contradictions`)

  if (!parts.length) return null
  return `Since ${relativeLabel(p.lastViewedAt)}: ${parts.join(' · ')}`
}

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  const supabase = createServiceClient()

  const userId = await resolveUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const access = await getMirrorAccessState(userId, supabase)
  if (access !== 'unlocked') {
    return NextResponse.json({ error: 'Mirror access required' }, { status: 403 })
  }

  // ── Parallel fetches ──────────────────────────────────────────────────────

  const [scoreRes, patternRes, oldSessionRes, sessionScoreRes, prefRes] =
    await Promise.allSettled([

      // 1. Latest independence score row
      supabase
        .from('independence_score_log')
        .select('score, delta, calculated_at, session_id')
        .eq('user_id', userId)
        .order('calculated_at', { ascending: false })
        .limit(1)
        .single(),

      // 2. Bias pattern counts
      supabase
        .from('bias_library')
        .select('detection_count')
        .eq('user_id', userId),

      // 3. Sessions older than 30 days (for open-loop count)
      supabase
        .from('sessions')
        .select('id')
        .eq('user_id', userId)
        .lt('created_at', new Date(Date.now() - 30 * 86_400_000).toISOString()),

      // 4. Session scores — for actionPlan
      computeUserSessionScores(userId, supabase),

      // 5. User preferences — last_mirror_viewed_at
      supabase
        .from('user_preferences')
        .select('last_mirror_viewed_at')
        .eq('user_id', userId)
        .single(),
    ])

  // ── Independence score ────────────────────────────────────────────────────

  let independenceScore: number | null = null
  let scoreDelta:        number | null = null
  let scoreCalcAt:       string | null = null
  let latestSessionId:   string | null = null

  if (scoreRes.status === 'fulfilled' && scoreRes.value.data) {
    const r       = scoreRes.value.data
    independenceScore = typeof r.score === 'number' ? Math.round(r.score) : null
    scoreDelta        = typeof r.delta === 'number' ? r.delta             : null
    scoreCalcAt       = (r.calculated_at as string | null) ?? null
    latestSessionId   = (r.session_id   as string | null) ?? null
  }

  // ── Examiner quote — longest response from the session that produced the score

  let examinerQuote: string | null = null
  if (latestSessionId) {
    try {
      const { data: rows } = await supabase
        .from('examiner_responses')
        .select('response_text')
        .eq('session_id', latestSessionId)
        .order('created_at', { ascending: true })

      if (rows && rows.length > 0) {
        const best = rows.reduce((a, b) =>
          ((a.response_text as string)?.length ?? 0) >= ((b.response_text as string)?.length ?? 0)
            ? a : b
        )
        const raw = (decrypt(best.response_text as string | null) ?? '').trim()
        if (raw.length > 20) {
          examinerQuote = raw.length > 180 ? raw.slice(0, 177) + '…' : raw
        }
      }
    } catch { /* non-critical */ }
  }

  // ── Pattern counts ────────────────────────────────────────────────────────

  let confirmedPatternCount = 0
  let formingPatternCount   = 0

  if (patternRes.status === 'fulfilled' && patternRes.value.data) {
    for (const { detection_count } of patternRes.value.data) {
      if ((detection_count as number) >= 2) confirmedPatternCount++
      else if ((detection_count as number) === 1) formingPatternCount++
    }
  }

  // ── Open-loop count ───────────────────────────────────────────────────────
  // Decisions older than 30 days with no outcome filed.

  let openLoopCount = 0
  if (oldSessionRes.status === 'fulfilled' && oldSessionRes.value.data?.length) {
    const ids = (oldSessionRes.value.data as { id: string }[]).map(s => s.id)
    try {
      const { data: filed } = await supabase
        .from('outcomes')
        .select('session_id')
        .in('session_id', ids)
      const filedSet = new Set((filed ?? []).map(o => o.session_id as string))
      openLoopCount  = ids.filter(id => !filedSet.has(id)).length
    } catch { /* non-critical */ }
  }

  // ── Action plan ───────────────────────────────────────────────────────────

  let nextAction: string | null = null
  if (sessionScoreRes.status === 'fulfilled') {
    const scores = sessionScoreRes.value
    if (Array.isArray(scores) && scores.length > 0) {
      nextAction = scores[0].actionPlan ?? null
    }
  }

  // ── Session count ─────────────────────────────────────────────────────────

  let sessionCount = 0
  try {
    const { count } = await supabase
      .from('sessions')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
    sessionCount = count ?? 0
  } catch { /* non-critical */ }

  // ── last_mirror_viewed_at + new contradictions since last visit ───────────

  let lastViewedAt: string | null = null
  if (prefRes.status === 'fulfilled' && prefRes.value.data) {
    lastViewedAt = ((prefRes.value.data as Record<string, unknown>).last_mirror_viewed_at as string | null) ?? null
  }

  let newContradictions = 0
  if (lastViewedAt) {
    try {
      // QC fix (audit pass, July 2026): this used to read contradiction_log,
      // which nothing has inserted into since the migration to the
      // contradictions table (see lib/graph-engine.ts backfillContradictionEdges
      // comment for the same finding) — so newContradictions was always 0,
      // silently disabling the AttentionZone/MirrorInsightCard "N new
      // contradictions" copy even when real unresolved ones exist.
      // contradictions uses dismissed_at (nullable timestamp), not a
      // dismissed boolean.
      const { count } = await supabase
        .from('contradictions')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .is('dismissed_at', null)
        .gt('generated_at', lastViewedAt)
      newContradictions = count ?? 0
    } catch { /* non-critical */ }
  }

  // Sprint M6: latest session rule_engine_result.mode drives module prominence
  // REDIRECT → highlight Independence Score; GATE → highlight Contradiction Detector
  let latestSessionMode: string | null = null
  try {
    const { data: latestSess } = await supabase
      .from('sessions')
      .select('id')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    if (latestSess?.id) {
      const { data: onto } = await supabase
        .from('sessions_ontology')
        .select('rule_engine_result')
        .eq('session_id', latestSess.id)
        .single()
      const r = onto?.rule_engine_result as { mode?: string } | null
      latestSessionMode = r?.mode ?? null
    }
  } catch { /* non-critical */ }

  const sinceLastVisit = buildSinceLine({ lastViewedAt, scoreCalcAt, scoreDelta, newContradictions })

  // ── Side-effect: stamp last_mirror_viewed_at = NOW ────────────────────────
  // Best-effort — never blocks the response.

  supabase
    .from('user_preferences')
    .upsert(
      { user_id: userId, last_mirror_viewed_at: new Date().toISOString() },
      { onConflict: 'user_id' },
    )
    .then(undefined, () => {/* non-critical */})

  // ── Return ────────────────────────────────────────────────────────────────

  return NextResponse.json({
    independenceScore,
    scoreDelta,
    examinerQuote,
    confirmedPatternCount,
    formingPatternCount,
    openLoopCount,
    nextAction,
    sessionCount,
    sinceLastVisit,
    newContradictions,    // M5: AttentionZone contradiction card
    latestSessionMode,    // M6: module prominence (REDIRECT/GATE/OPEN/null)
  })
}

// app/api/mirror/teaser/route.ts
// ── Mirror Teaser Data Route (Sprint 19) ─────────────────────────────────────
//
// GET /api/mirror/teaser
//
// Returns safe preview data for users in 'teaser' gate state (≥3 sessions,
// no active subscription). Designed to show that the Mirror is already
// accumulating signal — without revealing any paid content.
//
// Response shape:
//   sessionCount          number   — total sessions
//   patternCount          number   — distinct rules that have fired ≥ 1 time
//   independenceScore     number|null  — latest raw score (shown blurred in UI)
//   contradictionCount    number   — active contradictions (count only, not content)
//   calibrationDates      string[] — ISO dates of sessions with pre_decision_confidence
//   teaserBiases          string[] — top 3 bias_parameter keys (labels only)
//
// Auth: Bearer token required. Returns 401 if unauthenticated.
// Access: returns 403 if user has valid mirror access (should use full routes instead)
//         returns 403 if user has < TEASER_THRESHOLD sessions (should see locked view)
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { getMirrorAccessState, TEASER_THRESHOLD } from '@/lib/mirror-access'

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
      // invalid token
    }
  }

  if (!userId) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  // ── 2. Confirm access state is 'teaser' ───────────────────────────────────
  const accessState = await getMirrorAccessState(userId, supabase)
  if (accessState === 'unlocked') {
    return NextResponse.json(
      { error: 'User has full access — use /api/mirror/* routes instead' },
      { status: 403 },
    )
  }
  if (accessState === 'locked') {
    return NextResponse.json(
      { error: `Fewer than ${TEASER_THRESHOLD} sessions — teaser not yet available` },
      { status: 403 },
    )
  }

  // ── 3. Session count ───────────────────────────────────────────────────────
  const { count: rawCount } = await supabase
    .from('sessions')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
  const sessionCount = rawCount ?? 0

  // ── 4. Pattern count (distinct rules that have fired) ─────────────────────
  // Queries sessions_ontology.rule_engine_result for triggered_rules arrays
  const { data: ontologyRows } = await supabase
    .from('sessions_ontology')
    .select('rule_engine_result, session_id')
    .in(
      'session_id',
      (await supabase
        .from('sessions')
        .select('id')
        .eq('user_id', userId)
        .then(r => (r.data ?? []).map(s => s.id))),
    )

  const firedRuleIds = new Set<string>()
  for (const row of ontologyRows ?? []) {
    const result = row.rule_engine_result as { triggered_rules?: Array<{ rule_id: string }> } | null
    for (const rule of result?.triggered_rules ?? []) {
      if (rule.rule_id) firedRuleIds.add(rule.rule_id)
    }
  }
  const patternCount = firedRuleIds.size

  // ── 5. Latest independence score (value only — shown blurred) ─────────────
  const { data: scoreRow } = await supabase
    .from('independence_score_log')
    .select('score')
    .eq('user_id', userId)
    .order('calculated_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const independenceScore: number | null = scoreRow?.score ?? null

  // ── 6. Active contradiction count (count only) ────────────────────────────
  const { count: contradictionCount } = await supabase
    .from('contradictions')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('resolved', false)

  // ── 7. Calibration session dates (sessions with pre_decision_confidence) ──
  const { data: calibRows } = await supabase
    .from('sessions')
    .select('created_at')
    .eq('user_id', userId)
    .not('pre_decision_confidence', 'is', null)
    .order('created_at', { ascending: true })
  const calibrationDates = (calibRows ?? []).map(r => r.created_at as string)

  // ── 8. Teaser bias labels (same as status route — top 3 by detection) ─────
  let teaserBiases: string[] = []
  try {
    const { data: { user: authUser } } = await supabase.auth.admin.getUserById(userId)
    const userEmail = authUser?.email ?? null
    if (userEmail) {
      const { data: biasRows } = await supabase
        .from('bias_library')
        .select('bias_parameter, detection_count')
        .eq('user_email', userEmail)
        .order('detection_count', { ascending: false })
        .limit(3)
      teaserBiases = (biasRows ?? []).map(b => b.bias_parameter as string)
    }
  } catch {
    // fall through — UI degrades gracefully with empty array
  }

  return NextResponse.json({
    sessionCount,
    patternCount,
    independenceScore,
    contradictionCount: contradictionCount ?? 0,
    calibrationDates,
    teaserBiases,
  })
}

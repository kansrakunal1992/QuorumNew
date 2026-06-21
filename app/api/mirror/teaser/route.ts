// app/api/mirror/teaser/route.ts
// ── Mirror Teaser Data Route (Sprint 19, expanded Sprint RET-4) ──────────────
//
// GET /api/mirror/teaser
//
// Returns safe preview data for users in 'teaser' gate state (≥3 sessions,
// no active subscription). Designed to show that the Mirror is already
// accumulating signal — without revealing any paid content.
//
// Sprint RET-4 (June 20, 2026): expanded from 3 previewed modules to all 9
// paid modules. Every new field is a plain DB-derived count/label/average —
// zero new AI calls, so the route's cost profile is unchanged. No field
// reveals interpretation, narrative, or full content — only the same class
// of "this exists and here's the shape of it" signal already used for
// teaserBiases / independenceScore / contradictionCount.
//
// Response shape:
//   sessionCount          number   — total sessions
//   patternCount          number   — distinct structural rules (R1–R12) fired ≥ 1 time
//   patternLabels         string[] — names only of those rules (no description/fire-count)
//   independenceScore     number|null  — latest raw score (shown blurred in UI)
//   contradictionCount    number   — active contradictions (count only, not content)
//   calibrationDates      string[] — ISO dates of sessions with pre_decision_confidence
//   teaserBiases          string[] — top 3 bias_parameter keys (labels only)
//   rulesThreshold         number   — RULES_SESSION_THRESHOLD (matches /api/mirror/rules)
//   sriAverage             number|null — average composite Session Reliability score (shown blurred)
//   openLoopCount          number   — sessions past their review date, or stale + no outcome
//
// Auth: Bearer token required. Returns 401 if unauthenticated.
// Access: returns 403 if user has valid mirror access (should use full routes instead)
//         returns 403 if user has < TEASER_THRESHOLD sessions (should see locked view)
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { getMirrorAccessState, TEASER_THRESHOLD } from '@/lib/mirror-access'
import { computeUserSessionScores } from '@/lib/session-score'

// Sprint RET-4: same threshold the live Rules module gates on
// (app/api/mirror/rules/route.ts) — kept in sync via the same env var/default.
const RULES_SESSION_THRESHOLD = Number(process.env.RULES_SESSION_THRESHOLD ?? '8')

// Sprint RET-4: same catch-all window the live Open Loop module uses
// (app/api/mirror/monthly-review/route.ts) for "stale, no outcome logged" loops.
const CATCHALL_DAYS = 14

// Sprint RET-4: label-only mirror of RULE_META in app/api/mirror/patterns/route.ts.
// Intentionally duplicated rather than imported — keeps this route's only
// dependency on the patterns module to display names, never descriptions,
// fire-counts, or session links (those stay paid-only).
const RULE_LABELS: Record<string, string> = {
  R1:  'Upstream Dependency',
  R2:  'Identity-First Gate',
  R3:  'No-Information Mode',
  R4:  'Regret Asymmetry',
  R5:  'False Urgency',
  R6:  'Multi-Party Alignment',
  R7:  'Information-First',
  R8:  'Irreconcilable Values',
  R9:  'Irreversibility Warning',
  R10: 'Complexity Overload',
  R12: 'Couple Misalignment',
}

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

  // ── 4. Pattern count + labels (distinct rules that have fired) ────────────
  // Queries sessions_ontology.rule_engine_result for triggered_rules arrays.
  // Sprint RET-4: also surfaces the rule labels (names only — no description,
  // fire_count, or session_ids; those stay behind the Patterns module).
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
  const patternCount  = firedRuleIds.size
  const patternLabels = Array.from(firedRuleIds).map(id => RULE_LABELS[id] ?? id)

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
        .gt('detection_count', 0)
        .order('detection_count', { ascending: false })
        .limit(3)
      teaserBiases = (biasRows ?? []).map(b => b.bias_parameter as string)
    }
  } catch {
    // fall through — UI degrades gracefully with empty array
  }

  // ── 9. Session Reliability average (Sprint RET-4) ──────────────────────────
  // Reuses the same deterministic, AI-free scorer as the live SRI module
  // (lib/session-score.ts) — averages the composite `score` field only.
  // No sub-scores, no action plan, no per-session list exposed here.
  let sriAverage: number | null = null
  try {
    const scored = await computeUserSessionScores(userId, supabase)
    if (scored.length > 0) {
      sriAverage = Math.round(scored.reduce((sum, s) => sum + s.score, 0) / scored.length)
    }
  } catch {
    // non-fatal — UI degrades to "—"
  }

  // ── 10. Open Loop count (Sprint RET-4) ──────────────────────────────────────
  // Same qualification logic as /api/mirror/monthly-review, evaluated all-time
  // rather than over a rolling window — teaser users are early-stage by
  // definition (TEASER_THRESHOLD=3), so the live module's window/all-time
  // fallback would almost always resolve to all-time here anyway.
  // A session qualifies if EITHER:
  //   (a) commitment_review_date is set and < today, OR
  //   (b) created_at > CATCHALL_DAYS ago with no outcome row and no review date
  let openLoopCount = 0
  {
    const { data: allSessions } = await supabase
      .from('sessions')
      .select('id, created_at, commitment_review_date')
      .eq('user_id', userId)

    const sIds = (allSessions ?? []).map(s => s.id as string)
    let closedIds = new Set<string>()
    if (sIds.length > 0) {
      const { data: outcomeRows } = await supabase
        .from('outcomes')
        .select('session_id')
        .in('session_id', sIds)
      closedIds = new Set((outcomeRows ?? []).map(r => r.session_id as string))
    }

    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const catchallCutoff = new Date()
    catchallCutoff.setDate(catchallCutoff.getDate() - CATCHALL_DAYS)

    for (const s of allSessions ?? []) {
      if (closedIds.has(s.id as string)) continue

      const reviewDate = s.commitment_review_date as string | null
      if (reviewDate) {
        const rd = new Date(reviewDate + 'T00:00:00')
        if (rd < today) openLoopCount++
      } else {
        const sessionDate = new Date(s.created_at as string)
        if (sessionDate < catchallCutoff) openLoopCount++
      }
    }
  }

  return NextResponse.json({
    sessionCount,
    patternCount,
    patternLabels,
    independenceScore,
    contradictionCount: contradictionCount ?? 0,
    calibrationDates,
    teaserBiases,
    rulesThreshold: RULES_SESSION_THRESHOLD,
    sriAverage,
    openLoopCount,
  })
}

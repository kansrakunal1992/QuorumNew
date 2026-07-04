// app/api/admin/dashboard/route.ts
// ── Admin: Dashboard Data (R7 + R8) ─────────────────────────────────────────
//
// GET /api/admin/dashboard
//
// Auth: Authorization: Bearer <ADMIN_CODE>
//   ADMIN_CODE is a Railway environment variable. Wrong or missing token → 401,
//   caller redirects to home. Token never exposed in client bundle.
//
// Returns: { r7: RuleCalibrationRow[], r8: ThresholdRow[], generated_at: string }
//
// R7 — Rule Calibration (R7 audit item):
//   For each rule (R1–R12), computes avg council_helped score for sessions where
//   the rule fired vs sessions where it didn't, over the last 90 days.
//   council_helped values: 'yes'=1, 'partially'=0.5, 'no'=0
//   flag=true when fired correlates with >10pp lower helpfulness than baseline.
//   Data join: sessions_ontology.rule_engine_result (JSONB) → outcomes.council_helped
//   All joins done in JS to avoid complex Postgres JSON queries.
//
// R8 — Threshold Sensitivity (R8 audit item):
//   For each hardcoded threshold constant, shows current corpus count at the
//   current value and ±10% variants. Reveals whether the threshold is tight or
//   loose relative to current data distribution.
//   Thresholds covered:
//     MATCH_THRESHOLD (45)         → structural_matches.matches_json[].structural_score
//     SIMILARITY_THRESHOLD (0.808) → structural_matches.matches_json[].score_breakdown.vector_similarity
//     LOW_CONFIDENCE_THRESHOLD (0.55) → not directly queryable (noted)
//     MIN_SESSIONS (5)             → sessions_ontology tagger_status=complete
//     PATTERNS_SESSION_THRESHOLD (3) → bias_library.detection_count
//     RULES_SESSION_THRESHOLD (8)  → per-user, not aggregatable (noted)
//     RERUN_DAYS_THRESHOLD (7)     → per-user cadence, not aggregatable (noted)
//
// BUGFIX (audit pass, July 2026): MATCH_THRESHOLD/SIMILARITY_THRESHOLD used to
// read from a table called `structural_scores`, which does not exist anywhere
// in this codebase — no CREATE TABLE, and nothing ever writes to it. Selecting
// from a nonexistent table fails the same way a nonexistent column does, so
// `scores` was always empty and R8 has been reporting 0 / null for both
// thresholds regardless of real corpus size. The real values live inside
// structural_matches.matches_json (encrypted JSONB array, one row per
// session) — see lib/structural-retrieval.ts's `structural_score` /
// `score_breakdown.vector_similarity` fields, the same source
// app/api/persona/route.ts and lib/session-score.ts read from. Fixed by
// querying structural_matches and flattening each session's match array.
//
// No schema changes. No new tables. All queries against existing tables.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse }        from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { writeAuditLog }        from '@/lib/audit'
import { decryptJson }          from '@/lib/encryption'

// council_helped → numeric helpfulness score for averaging
const HELPED_SCORE: Record<string, number> = {
  yes:       1.0,
  partially: 0.5,
  no:        0.0,
}

// Rule IDs in the system (matches rule-engine.ts)
const RULE_IDS = ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'R9', 'R10', 'R12'] as const

// Human-readable labels for the dashboard table
const RULE_LABELS: Record<string, string> = {
  R1:  'Upstream dependency (REDIRECT)',
  R2:  'Irreversibility gate (GATE)',
  R3:  'Info adequacy (GATE)',
  R4:  'Regret asymmetry (FLAG)',
  R5:  'Urgency legitimacy (FLAG)',
  R6:  'Stakeholder alignment (FLAG)',
  R7:  'Missing information (REDIRECT)',
  R8:  'Value conflict (FLAG)',
  R9:  'Reversibility + time pressure (FLAG)',
  R10: 'Key unknown question (GATE)',
  R12: 'Counterparty intent (FLAG)',
}

// S6-04: In-memory IP lockout — 5 failures → 15 min block
const failedAttempts = new Map<string, { count: number; lockedUntil: number }>()

export async function GET(req: Request) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'

  // ── Lockout check ──────────────────────────────────────────────────────────
  const lockState = failedAttempts.get(ip)
  if (lockState && lockState.lockedUntil > Date.now()) {
    void writeAuditLog({ action: 'admin.locked_out', ip_address: ip })
    const secsLeft = Math.ceil((lockState.lockedUntil - Date.now()) / 1000)
    return NextResponse.json(
      { error: `Too many failed attempts. Try again in ${Math.ceil(secsLeft / 60)} minutes.` },
      { status: 429, headers: { 'Retry-After': String(secsLeft) } }
    )
  }

  // ── Auth guard ──────────────────────────────────────────────────────────────
  const auth  = req.headers.get('Authorization') ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''

  if (!token || !process.env.ADMIN_CODE || token !== process.env.ADMIN_CODE) {
    // Track failure
    const prev = failedAttempts.get(ip) ?? { count: 0, lockedUntil: 0 }
    const next = { count: prev.count + 1, lockedUntil: prev.lockedUntil }
    if (next.count >= 5) next.lockedUntil = Date.now() + 15 * 60_000
    failedAttempts.set(ip, next)
    void writeAuditLog({
      action: 'admin.auth_failed', ip_address: ip,
      metadata: { attempt: next.count, locked: next.count >= 5 },
    })
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Success — clear lockout, log access
  failedAttempts.delete(ip)
  void writeAuditLog({ action: 'admin.access', ip_address: ip,
    user_agent: req.headers.get('user-agent') ?? undefined })

  // Top-level try/catch ensures the route always returns JSON — never an HTML
  // error page. If Next.js returns HTML on a runtime crash, res.json() in the
  // client throws and lands in the generic catch block showing "Network error".
  // Wrapping here guarantees a parseable error response instead.
  try {
    return await handleDashboard()
  } catch (err) {
    console.error('[Admin/Dashboard] Unhandled error:', err)
    return NextResponse.json(
      { error: 'Internal server error', detail: String(err) },
      { status: 500 }
    )
  }
}

async function handleDashboard() {
  const supabase  = createServiceClient()
  const since90d  = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()

  // ── R7: Rule Calibration ────────────────────────────────────────────────────
  const [soResult, outcomesResult] = await Promise.all([
    supabase
      .from('sessions_ontology')
      .select('session_id, rule_engine_result')
      .gte('created_at', since90d),
    supabase
      .from('outcomes')
      .select('session_id, council_helped'),
  ])

  const sessionOntologies = soResult.data ?? []
  const outcomesMap       = Object.fromEntries(
    (outcomesResult.data ?? []).map(o => [o.session_id, o.council_helped as string])
  )

  // Build per-session stats: rules fired + helpfulness score (null if no outcome yet)
  type SessionStat = { helped: number | null; firedRules: string[] }
  const sessionStats: SessionStat[] = sessionOntologies.map(so => {
    const triggered  = (so.rule_engine_result?.triggered_rules ?? []) as { rule_id: string }[]
    const rawHelped  = outcomesMap[so.session_id]
    const helped     = rawHelped != null ? (HELPED_SCORE[rawHelped] ?? null) : null
    return { helped, firedRules: triggered.map((r: { rule_id: string }) => r.rule_id) }
  })

  const withOutcomes = sessionStats.filter(s => s.helped != null)
  const globalAvg    = withOutcomes.length > 0
    ? withOutcomes.reduce((sum, s) => sum + s.helped!, 0) / withOutcomes.length
    : null

  const r7 = RULE_IDS.map(ruleId => {
    const fired           = sessionStats.filter(s => s.firedRules.includes(ruleId))
    const notFired        = sessionStats.filter(s => !s.firedRules.includes(ruleId))
    const firedOutcomes   = fired.filter(s => s.helped != null)
    const notFiredOutcomes = notFired.filter(s => s.helped != null)

    const avgFired    = firedOutcomes.length > 0
      ? firedOutcomes.reduce((sum, s) => sum + s.helped!, 0) / firedOutcomes.length
      : null
    const avgNotFired = notFiredOutcomes.length > 0
      ? notFiredOutcomes.reduce((sum, s) => sum + s.helped!, 0) / notFiredOutcomes.length
      : null

    const delta = avgFired != null && avgNotFired != null ? avgFired - avgNotFired : null
    // Flag when rule firing correlates with >10pp lower helpfulness than sessions where it didn't fire
    const flag  = delta != null && delta < -0.10

    return {
      rule_id:       ruleId,
      label:         RULE_LABELS[ruleId] ?? ruleId,
      fires_90d:     fired.length,
      outcomes_90d:  firedOutcomes.length,
      avg_fired:     avgFired    != null ? +avgFired.toFixed(3)    : null,
      avg_not_fired: avgNotFired != null ? +avgNotFired.toFixed(3) : null,
      delta:         delta       != null ? +delta.toFixed(3)       : null,
      flag,
      global_avg:    globalAvg  != null ? +globalAvg.toFixed(3)   : null,
    }
  })

  // ── R8: Threshold Sensitivity ───────────────────────────────────────────────
  const [matchesResult, completeSoResult, biasResult] = await Promise.all([
    supabase
      .from('structural_matches')
      .select('matches_json'),
    supabase
      .from('sessions_ontology')
      .select('session_id')
      .eq('tagger_status', 'complete'),
    supabase
      .from('bias_library')
      .select('detection_count'),
  ])

  // Each structural_matches row holds an encrypted array of up to MAX_MATCHES
  // (currently 2) match objects for one session — flatten across the whole
  // corpus into one array of { total_score, vector_similarity } so the
  // threshold-count helpers below stay unchanged. Same decryptJson pattern as
  // app/api/persona/route.ts and lib/session-score.ts.
  type FlatMatch = { total_score: number | null; vector_similarity: number | null }
  const scores: FlatMatch[] = []
  for (const row of matchesResult.data ?? []) {
    const decrypted = row.matches_json ? decryptJson(row.matches_json) : null
    if (!Array.isArray(decrypted)) continue
    for (const m of decrypted as Array<{ structural_score?: number; score_breakdown?: { vector_similarity?: number } }>) {
      scores.push({
        total_score:       m.structural_score ?? null,
        vector_similarity: m.score_breakdown?.vector_similarity ?? null,
      })
    }
  }

  const completeSo  = completeSoResult.data ?? []
  const biasRows    = biasResult.data ?? []

  // Helper counters
  const matchAt  = (t: number) => scores.filter(s => (s.total_score ?? 0) >= t).length
  const simAt    = (t: number) => scores.filter(
    s => s.vector_similarity != null && (s.vector_similarity as number) >= t
  ).length
  const biasAt   = (t: number) => biasRows.filter(r => (r.detection_count ?? 0) >= t).length
  const corpusMilestone = (n: number) =>
    n >= 250 ? '🟢 250+' : n >= 100 ? '🟡 100+' : '⚪ <100'

  const r8 = [
    {
      name:           'MATCH_THRESHOLD',
      location:       'lib/structural-retrieval.ts : line ~508',
      description:    'Min structural total score (0–100) for a past session to surface as relevant context in current session',
      current:        45,
      current_count:  matchAt(45),
      minus_10:       { value: 40, count: matchAt(40) },
      plus_10:        { value: 50, count: matchAt(50) },
      corpus_total:   scores.length,
      milestone:      corpusMilestone(scores.length),
      note:           null,
    },
    {
      name:           'SIMILARITY_THRESHOLD',
      location:       'app/api/mirror/benchmark/route.ts : line ~35',
      description:    'Min cosine similarity (0–1) for cross-user peer cluster inclusion in Mirror benchmark',
      current:        0.808,
      current_count:  simAt(0.808),
      minus_10:       { value: 0.727, count: simAt(0.727) },
      plus_10:        { value: 0.889, count: simAt(0.889) },
      corpus_total:   scores.filter(s => s.vector_similarity != null).length,
      milestone:      '—',
      note:           null,
    },
    {
      name:           'LOW_CONFIDENCE_THRESHOLD',
      location:       'lib/rule-engine.ts : line ~69',
      description:    'Ontology tagger confidence below this suppresses a rule from firing for that session',
      current:        0.55,
      current_count:  null,
      minus_10:       null,
      plus_10:        null,
      corpus_total:   null,
      milestone:      '—',
      note:           'Not queryable from DB — applied at tagger inference time. Review tagger logs for low_confidence rule suppression rates.',
    },
    {
      name:           'MIN_SESSIONS',
      location:       'lib/structural-retrieval.ts + app/api/mirror/contradictions/route.ts : line ~5 / ~28',
      description:    'Min completed sessions per user before structural retrieval and contradiction detection activate',
      current:        5,
      current_count:  completeSo.length,
      minus_10:       null,
      plus_10:        null,
      corpus_total:   completeSo.length,
      milestone:      corpusMilestone(completeSo.length),
      note:           'Count is total completed sessions across all users — not per-user breakdown. Check per-user in Supabase if needed.',
    },
    {
      name:           'PATTERNS_SESSION_THRESHOLD',
      location:       'app/api/mirror/patterns/route.ts : line ~14',
      description:    'Min sessions recorded in bias_library before bias pattern cards unlock for a user',
      current:        3,
      current_count:  biasAt(3),
      minus_10:       { value: 2, count: biasAt(2) },
      plus_10:        { value: 4, count: biasAt(4) },
      corpus_total:   biasRows.length,
      milestone:      '—',
      note:           'Count shows bias_library rows with detection_count ≥ threshold — proxy for eligible users.',
    },
    {
      name:           'RULES_SESSION_THRESHOLD',
      location:       'app/api/mirror/rules/route.ts : line ~27',
      description:    'Min sessions before decision rule analytics (Mirror rules tab) unlock for a user',
      current:        8,
      current_count:  null,
      minus_10:       null,
      plus_10:        null,
      corpus_total:   null,
      milestone:      '—',
      note:           'Per-user threshold — not aggregatable without a user-scoped query. Check Mirror rules panel per user or query sessions_ontology grouped by user_email.',
    },
    {
      name:           'RERUN_DAYS_THRESHOLD',
      location:       'app/api/mirror/contradictions/route.ts : line ~29',
      description:    'Contradiction detector will not re-run for a user within this many days of last run',
      current:        7,
      current_count:  null,
      minus_10:       null,
      plus_10:        null,
      corpus_total:   null,
      milestone:      '—',
      note:           'Per-user cadence control — not directly queryable as a corpus aggregate. Review per-user if detection frequency is a concern.',
    },
  ]

  // ── R11: Effective Threshold Values + Avoidance Alert Stats ────────────────
  // Shows which thresholds are using Railway env overrides vs hardcoded defaults,
  // and surfaces avoidance_alerts table stats for R11 monitoring.

  const THRESHOLD_DEFAULTS: Record<string, number> = {
    MATCH_THRESHOLD:              45,
    MIN_SESSIONS:                 5,
    PATTERNS_SESSION_THRESHOLD:   3,
    RULES_SESSION_THRESHOLD:      8,
    RERUN_DAYS_THRESHOLD:         7,
    AVOIDANCE_DAYS_THRESHOLD:     45,
    STRUCTURAL_ECHO_MIN_SCORE:    60,
  }

  const effectiveThresholds = Object.entries(THRESHOLD_DEFAULTS).map(([name, defaultVal]) => {
    const envVal = process.env[name]
    const value  = envVal != null ? Number(envVal) : defaultVal
    return {
      name,
      default_value:  defaultVal,
      effective_value: value,
      is_overridden:  envVal != null && value !== defaultVal,
      env_raw:        envVal ?? null,
    }
  })

  // Avoidance alerts stats — non-fatal if table doesn't exist yet
  let avoidanceStats: {
    total: number; open: number; dismissed: number; avg_days_open: number | null
  } = { total: 0, open: 0, dismissed: 0, avg_days_open: null }

  try {
    const { data: avoidanceRows } = await supabase
      .from('avoidance_alerts')
      .select('days_open, dismissed_at')

    if (avoidanceRows && avoidanceRows.length > 0) {
      const open      = avoidanceRows.filter(a => !a.dismissed_at).length
      const dismissed = avoidanceRows.filter(a =>  a.dismissed_at).length
      const avgDays   = avoidanceRows.reduce((s, a) => s + (a.days_open ?? 0), 0) / avoidanceRows.length
      avoidanceStats = {
        total:         avoidanceRows.length,
        open,
        dismissed,
        avg_days_open: +avgDays.toFixed(1),
      }
    }
  } catch {
    // avoidance_alerts table may not exist in all environments — non-fatal
  }

  const r11 = {
    effective_thresholds: effectiveThresholds,
    avoidance: {
      ...avoidanceStats,
      active_days_threshold:  Number(process.env.AVOIDANCE_DAYS_THRESHOLD  ?? '45'),
      active_echo_threshold:  Number(process.env.STRUCTURAL_ECHO_MIN_SCORE ?? '60'),
    },
  }

  return NextResponse.json({
    r7,
    r8,
    r11,
    meta: {
      generated_at:    new Date().toISOString(),
      window_days:     90,
      total_sessions:  sessionOntologies.length,
      sessions_with_outcomes: withOutcomes.length,
      global_avg_helped: globalAvg != null ? +globalAvg.toFixed(3) : null,
    },
  })
}

/**
 * lib/decision-patterns.ts
 * ── Cross-session decision-speed + risk-tolerance signals ───────────────────
 *
 * Phase 2 of the backend improvement roadmap: extends
 * lib/mirror-fingerprint.ts's narrative prompt (MIRROR_FINGERPRINT_NARRATIVE)
 * with two new behavioral signals. Computed mechanically from stored data —
 * no new AI classification call in this module — same "don't claim a signal
 * you can't defend" discipline as lib/mind-change-patterns.ts and
 * lib/advisor-divergence.ts.
 *
 * decisionSpeedSummary — derived from sessions.created_at ->
 * sessions.commitment_captured_at (the DecisionStateCard submission
 * timestamp added in Sprint Chunk 1). Median time-to-commit across
 * qualifying sessions, bucketed into a plain-language descriptor rather
 * than exposed as a raw number or duration — same "no ontology field
 * names, no technical terms" discipline MIRROR_FINGERPRINT_NARRATIVE
 * already applies to activation_summary.
 *
 * riskToleranceSummary — derived from sessions_ontology.stakes_reversibility
 * ('irreversible') crossed with the user's classified final lean
 * (proceed/wait/mixed) on those specific sessions. Reuses
 * advisor_divergence_events.user_stated_lean rather than paying for a
 * second AI classification call on commitment_leaning — that table already
 * classifies every session where the user's stated leaning diverged from
 * at least one advisor, via lib/advisor-divergence.ts's
 * classifyStatedLeaning(). Join is via session_id only (that table also
 * carries user_id/user_email, but session_id is already scoped to this
 * user's own sessions by the query below, so no second identity filter is
 * needed).
 *
 * Real, unavoidable limitation of reusing this table: advisor_divergence_events
 * only has rows for sessions where the user's stated lean diverged from at
 * least one advisor. An irreversible-stakes session where the user agreed
 * with every advisor has no row and can't be counted — it's silently
 * excluded from the denominator, not counted as a "wait" or folded in some
 * other way. That's a real skew (this signal is really "risk tolerance when
 * pushed back on," not "risk tolerance overall") worth knowing about if the
 * narrative's framing of it ever needs to get more precise than the current
 * "how this user tends to handle decisions with irreversible stakes" prompt
 * wording allows. MINIMUM_EVENTS below gates on the count of sessions that
 * actually got classified, not on all irreversible-stakes sessions, so the
 * pattern stays hidden rather than extrapolating past what it has.
 *
 * MINIMUM_EVENTS gate — same value and same discipline as
 * mind-change-patterns.ts / advisor-divergence.ts: below this, a pattern
 * is a couple of data points dressed up as a trend.
 */

import { createServiceClient } from '@/lib/supabase'

const MINIMUM_EVENTS = 3

// Mirrors advisor-divergence.ts's Lean type exactly (that file doesn't
// export it, so re-declared here rather than reaching into its internals).
type Lean = 'proceed' | 'wait' | 'mixed'

export interface DecisionSpeedPattern {
  summary: string       // plain-language, ready to drop into the narrative prompt's INPUT DATA
  sessionCount: number  // qualifying sessions (both timestamps present, non-negative delta)
}

export interface RiskTolerancePattern {
  summary: string
  irreversibleCount: number  // qualifying sessions (irreversible-stakes AND advisor-divergence-classified)
}

function bucketSpeed(medianHours: number): string {
  if (medianHours < 24) {
    return 'tends to commit within the same day once a decision is brought to the council'
  }
  if (medianHours < 24 * 7) {
    return 'typically takes a few days to reach a commitment after bringing a decision to the council'
  }
  return 'typically takes a week or more to reach a commitment, often returning to a decision multiple times before committing'
}

export async function getDecisionSpeedPattern(userId: string): Promise<DecisionSpeedPattern | null> {
  try {
    const supabase = createServiceClient()
    const { data } = await supabase
      .from('sessions')
      .select('created_at, commitment_captured_at')
      .eq('user_id', userId)
      .not('commitment_captured_at', 'is', null)

    if (!data || data.length < MINIMUM_EVENTS) return null

    const hoursList = data
      .map(row => {
        const created   = new Date(row.created_at as string).getTime()
        const committed = new Date(row.commitment_captured_at as string).getTime()
        return (committed - created) / (1000 * 60 * 60)
      })
      // Guard: commitment_captured_at should never precede created_at, but
      // don't let a bad row or clock skew silently corrupt the median.
      .filter(hours => Number.isFinite(hours) && hours >= 0)

    if (hoursList.length < MINIMUM_EVENTS) return null

    hoursList.sort((a, b) => a - b)
    const mid = Math.floor(hoursList.length / 2)
    const medianHours = hoursList.length % 2 === 0
      ? (hoursList[mid - 1] + hoursList[mid]) / 2
      : hoursList[mid]

    return {
      summary:      bucketSpeed(medianHours),
      sessionCount: hoursList.length,
    }
  } catch (err) {
    console.error('[DecisionPatterns] getDecisionSpeedPattern failed (non-fatal):', err)
    return null
  }
}

export async function getRiskTolerancePattern(userId: string): Promise<RiskTolerancePattern | null> {
  try {
    const supabase = createServiceClient()

    // sessions_ontology doesn't carry user_id — join through sessions, same
    // pattern app/api/persona/route.ts uses for structural_matches (that
    // file's own comment: the real source lives on a separate cache table,
    // keyed by session_id, not assumed on the parent row).
    const { data: userSessions } = await supabase
      .from('sessions')
      .select('id')
      .eq('user_id', userId)

    if (!userSessions || userSessions.length === 0) return null

    const sessionIds = userSessions.map(s => s.id as string)
    if (sessionIds.length === 0) return null

    const { data: ontologyRows } = await supabase
      .from('sessions_ontology')
      .select('session_id')
      .in('session_id', sessionIds)
      .eq('stakes_reversibility', 'irreversible')

    if (!ontologyRows || ontologyRows.length === 0) return null

    const irreversibleSessionIds = ontologyRows.map(r => r.session_id as string)

    // Reuse the classification advisor-divergence.ts already paid for. See
    // the module header for the coverage caveat this brings: only sessions
    // where the user diverged from at least one advisor have a row here.
    const { data: divergenceRows } = await supabase
      .from('advisor_divergence_events')
      .select('session_id, user_stated_lean')
      .in('session_id', irreversibleSessionIds)

    if (!divergenceRows || divergenceRows.length === 0) return null

    // Multiple rows per session (one per diverging advisor) all carry the
    // same user_stated_lean for that session — dedupe to one classified
    // lean per session before counting.
    const leanBySession = new Map<string, Lean>()
    for (const row of divergenceRows as { session_id: string; user_stated_lean: Lean }[]) {
      leanBySession.set(row.session_id, row.user_stated_lean)
    }

    if (leanBySession.size < MINIMUM_EVENTS) return null

    const leans = [...leanBySession.values()]
    const proceedCount = leans.filter(l => l === 'proceed').length
    const waitCount    = leans.filter(l => l === 'wait').length

    const proceedRate = proceedCount / leans.length
    const waitRate    = waitCount / leans.length

    let summary: string
    if (proceedRate >= 0.6) {
      summary = 'tends to proceed on irreversible decisions even when an advisor pushes back on them'
    } else if (waitRate >= 0.6) {
      summary = 'tends to hold off on irreversible decisions when an advisor pushes back on them'
    } else {
      summary = "response to pushback on irreversible decisions is mixed — sometimes proceeding anyway, sometimes holding off"
    }

    return { summary, irreversibleCount: leans.length }
  } catch (err) {
    console.error('[DecisionPatterns] getRiskTolerancePattern failed (non-fatal):', err)
    return null
  }
}

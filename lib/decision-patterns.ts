/**
 * lib/decision-patterns.ts
 * ── Cross-session decision-speed + risk-tolerance signals ───────────────────
 *
 * Phase 2 of the backend improvement roadmap: extends
 * lib/mirror-fingerprint.ts's narrative prompt (MIRROR_FINGERPRINT_NARRATIVE)
 * with two new behavioral signals. Computed mechanically from stored data —
 * no new AI classification call — same "don't claim a signal you can't
 * defend" discipline as lib/mind-change-patterns.ts and
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
 * ('irreversible') crossed with whether the user ultimately reached a
 * stated commitment (commitment_leaning non-null) on those specific
 * sessions. Deliberately does NOT classify commitment_leaning into
 * proceed/wait/mixed the way advisor-divergence.ts does — reusing that
 * table's classification would silently under-count, since
 * advisor_divergence_events only has rows for sessions where at least one
 * persona diverged from the user, and a second independent AI
 * classification call would duplicate cost for a Phase 2 signal that
 * doesn't need proceed/wait granularity to be useful. The real limitation
 * this leaves: it can say "reached a stated commitment" vs "left it open,"
 * not "proceeded" vs "waited." Documented here so it isn't mistaken for
 * more than it is.
 *
 * MINIMUM_EVENTS gate — same value and same discipline as
 * mind-change-patterns.ts / advisor-divergence.ts: below this, a pattern
 * is a couple of data points dressed up as a trend.
 */

import { createServiceClient } from '@/lib/supabase'

const MINIMUM_EVENTS = 3

export interface DecisionSpeedPattern {
  summary: string       // plain-language, ready to drop into the narrative prompt's INPUT DATA
  sessionCount: number  // qualifying sessions (both timestamps present, non-negative delta)
}

export interface RiskTolerancePattern {
  summary: string
  irreversibleCount: number  // qualifying sessions (stakes_reversibility = 'irreversible')
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
      .select('id, commitment_leaning')
      .eq('user_id', userId)

    if (!userSessions || userSessions.length === 0) return null

    const sessionIds = userSessions.map(s => s.id as string)
    if (sessionIds.length === 0) return null

    const { data: ontologyRows } = await supabase
      .from('sessions_ontology')
      .select('session_id')
      .in('session_id', sessionIds)
      .eq('stakes_reversibility', 'irreversible')

    if (!ontologyRows || ontologyRows.length < MINIMUM_EVENTS) return null

    const committedMap = new Map(userSessions.map(s => [s.id as string, !!s.commitment_leaning]))
    const irreversibleCount = ontologyRows.length
    const committedCount = ontologyRows.filter(
      row => committedMap.get(row.session_id as string),
    ).length

    const committedRate = committedCount / irreversibleCount

    const summary = committedRate >= 0.6
      ? "tends to reach a firm commitment even on decisions that can't be undone"
      : 'tends to bring irreversible decisions to the council but often leaves them without a stated commitment'

    return { summary, irreversibleCount }
  } catch (err) {
    console.error('[DecisionPatterns] getRiskTolerancePattern failed (non-fatal):', err)
    return null
  }
}

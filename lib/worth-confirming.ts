/**
 * lib/worth-confirming.ts
 * Sprint 1 (P1 follow-on) — merged Feature #1 (Highest-Value Unknown) +
 * Feature #6 (Decision Sensitivity Analysis, cheap proxy version).
 *
 * WHY THESE TWO ARE ONE FUNCTION:
 * Both features reduce to the same underlying question — "what is the
 * single least-certain thing this verdict rests on?" — and both draw on
 * data the rule engine and ontology tagger already compute today. Shipping
 * them as two separate UI surfaces would mean two panels making
 * near-identical claims from the same underlying signal. This produces ONE
 * quiet, single-line string; the caller decides where to render it.
 *
 * DELIBERATELY NOT a new AI call. Two tiers, in priority order:
 *   1. If a rule fired (GATE, downgraded REDIRECT, or FLAG), reuse that
 *      rule's own already-written question text verbatim. These questions
 *      were hand-written to be warm and specific — paraphrasing them here
 *      would risk drifting the meaning for no benefit.
 *   2. Otherwise, fall back to the ontology dimension with the lowest
 *      confidence among the "high-signal" dimensions (score >= 4 or <= 2 —
 *      same threshold buildCouncilContext() in rule-engine.ts already uses
 *      to decide what's worth mentioning to the Council), and surface its
 *      own rationale text.
 *   3. If neither tier produces anything (a clean, high-confidence read
 *      across the board), return null. Silence is the correct default —
 *      this should not manufacture a "worth confirming" line where there
 *      genuinely isn't one.
 *
 * Priority order across rules mirrors rule-engine.ts's own evaluation
 * order (triggered_rules is already built in that order; a REDIRECT/GATE
 * signal is a stronger claim on "this could change the verdict" than an
 * enrichment-only FLAG, so triggered_rules is checked before flag_rules).
 */

import type { RuleEngineResult } from './rule-engine'
import type { OntologyScoreMap } from './bias-scorer'

// Confidence below this, on a dimension that already crossed the
// high-signal threshold, is worth surfacing as the fallback tier.
// Matches LOW_CONFIDENCE_THRESHOLD's neighborhood in rule-engine.ts —
// deliberately not reusing that exact constant (it gates hard rule
// actions; this only gates a soft, optional UI line, so a slightly
// looser bar here is fine).
const DIM_CONFIDENCE_FLAG_THRESHOLD = 0.75

// Same high-signal filter buildCouncilContext() already applies when
// deciding which dimensions are worth mentioning to the Council at all.
const HIGH_SIGNAL_DIMS = [
  'identity_alignment', 'regret_asymmetry', 'upstream_dependency',
  'reversibility', 'outcome_uncertainty', 'value_conflict',
  'time_pressure', 'emotional_intensity', 'task_complexity',
  'decision_unit', 'ambiguity', 'decision_discriminating_info',
  'stakes_magnitude', 'time_horizon',
] as const

export function getWorthConfirmingText(
  ruleEngineResult: RuleEngineResult | null,
  ontologyVector:   OntologyScoreMap | null,
): string | null {
  // ── Tier 1: a rule already flagged something specific ──────────────────
  if (ruleEngineResult) {
    const candidates = [
      ...ruleEngineResult.triggered_rules,
      ...ruleEngineResult.flag_rules,
    ]
    const first = candidates[0]
    if (first?.question) {
      return first.question
    }
  }

  // ── Tier 2: fall back to the least-certain high-signal dimension ───────
  if (ontologyVector) {
    let lowest: { rationale: string; confidence: number } | null = null
    for (const dim of HIGH_SIGNAL_DIMS) {
      const d = ontologyVector[dim] as { score?: number; confidence?: number; rationale?: string } | undefined
      if (!d || typeof d.score !== 'number') continue
      if (d.score < 4 && d.score > 2) continue // not high-signal
      const confidence = typeof d.confidence === 'number' ? d.confidence : 1
      if (confidence >= DIM_CONFIDENCE_FLAG_THRESHOLD) continue
      if (!lowest || confidence < lowest.confidence) {
        lowest = { rationale: d.rationale ?? '', confidence }
      }
    }
    if (lowest?.rationale) {
      return lowest.rationale
    }
  }

  // ── Tier 3: nothing worth flagging — silence is correct here ───────────
  return null
}

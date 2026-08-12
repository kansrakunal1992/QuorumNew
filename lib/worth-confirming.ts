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
 * DELIBERATELY NOT a new AI call. Three tiers, in priority order:
 *
 *   1. An Examiner question the rule engine asked but the user never
 *      actually answered — checked against the real submitted
 *      examiner_responses rows for this session, not just "did a rule
 *      fire." A rule firing only means a question was SHOWN; it doesn't
 *      mean it was answered (the whole Examiner step can be skipped, or an
 *      individual question left blank while others were answered). This is
 *      the strongest possible "worth confirming" candidate — the verdict
 *      above is quite literally resting on an assumption instead of a real
 *      answer, and the rule's own already-written question text says
 *      exactly what that assumption is.
 *
 *   2. A low-confidence ontology dimension that specifically feeds the
 *      WINNING persona's relevance score (via
 *      lib/persona-relevance.ts's getDimensionsForPersona(), itself a
 *      reverse-lookup into the same DIM_PERSONA_BOOSTS table
 *      computePersonaRelevance() uses — no separate mapping to drift out of
 *      sync). A shaky dimension the verdict doesn't actually lean on is far
 *      less worth surfacing than a shaky one the leading advisor's weight
 *      is built on.
 *
 *   3. Fallback: the lowest-confidence dimension among the full
 *      "high-signal" set (score >= 4 or <= 2 — same threshold
 *      buildCouncilContext() in rule-engine.ts uses to decide what's worth
 *      mentioning to the Council at all), regardless of which persona it
 *      feeds. This is the original, simpler version of tier 2 — kept as a
 *      safety net so a genuinely low-confidence read doesn't go unmentioned
 *      just because it happens not to be one of the winning persona's own
 *      driving dimensions.
 *
 *   4. If none of the above produce anything (a clean, high-confidence read
 *      across the board, with every triggered rule's question actually
 *      answered), return null. Silence is the correct default — this
 *      should not manufacture a "worth confirming" line where there
 *      genuinely isn't one.
 *
 * Sprint 1 v2 (2026-08): originally, tier 1 only checked "did any rule
 * fire" and tier 2 checked confidence across a fixed 14-dimension list with
 * no tie to which persona actually won. Both were real, deterministic, and
 * useful, but neither was actually reading the two signals the design was
 * meant to be built around — unanswered Examiner questions, and dimensions
 * that specifically drive the winning advisor's weight. v2 wires in both,
 * while keeping the same non-negotiable constraints as before: no new AI
 * call, silence when there's genuinely nothing to flag, and priority order
 * that mirrors "how strong a claim is this on the verdict" (an unanswered
 * question > the verdict's own leading rationale being shaky > a shaky read
 * that isn't even what's driving the verdict).
 *
 * v1.0 note: the examiner_gap_1/2/3 fields the original design referenced
 * are v1.0-only — real v2.0 sessions (the tagger version in production
 * since Sprint 11a) generate rule-tied Examiner questions instead, each
 * with a real rule_id and the rule's own hand-written .question text. Tier
 * 1 below reads from that real, current mechanism (examiner_responses +
 * rule_engine_result) rather than the mostly-unused v1.0 fields, which is
 * the same adaptation the rest of the v2.0 Examiner system already made.
 */

import type { RuleEngineResult } from './rule-engine'
import type { OntologyScoreMap } from './bias-scorer'
import { getDimensionsForPersona, type AdvisorKey, type PersonaRelevanceMap } from './persona-relevance'

// Confidence below this, on a dimension that already crossed the
// high-signal threshold, is worth surfacing as a fallback-tier candidate.
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

// Minimal shape worth-confirming needs from an examiner_responses row —
// callers can pass the real DB row type straight through, this just
// documents what's actually read.
export interface ExaminerAnswerRow {
  rule_id:       string | null
  response_text: string | null
}

function isAnsweredForRule(ruleId: string, responses: ExaminerAnswerRow[]): boolean {
  return responses.some(r => r.rule_id === ruleId && !!r.response_text?.trim())
}

// Finds the highest-scoring persona in a relevance map. Ties resolve to
// whichever key iterates first — relevanceMap's insertion order is fixed
// (computePersonaRelevance always builds the same six keys in the same
// order), so this is deterministic even on an exact tie, not
// order-dependent in a way that could vary between calls.
function pickWinningPersona(relevanceMap: PersonaRelevanceMap): AdvisorKey | null {
  let winner: AdvisorKey | null = null
  let best = -Infinity
  for (const [persona, score] of Object.entries(relevanceMap) as [AdvisorKey, number][]) {
    if (score > best) { best = score; winner = persona }
  }
  return winner
}

export function getWorthConfirmingText(
  ruleEngineResult:  RuleEngineResult | null,
  ontologyVector:    OntologyScoreMap | null,
  // Both new, both optional so any existing caller that doesn't have this
  // data handy keeps working exactly as before (falls through to tier 3,
  // the original simpler behavior) rather than breaking.
  examinerResponses: ExaminerAnswerRow[] | null = null,
  relevanceMap:      PersonaRelevanceMap | null = null,
): string | null {
  // ── Tier 1: a rule fired AND its question genuinely wasn't answered ────
  if (ruleEngineResult && examinerResponses) {
    const candidates = [
      ...ruleEngineResult.triggered_rules,
      ...ruleEngineResult.flag_rules,
    ]
    for (const rule of candidates) {
      if (!rule.question) continue
      if (!isAnsweredForRule(rule.rule_id, examinerResponses)) {
        return rule.question
      }
    }
  } else if (ruleEngineResult && !examinerResponses) {
    // No answer data available to check against (caller didn't pass it) —
    // preserve the old, simpler behavior rather than silently skipping a
    // real signal: surface the first fired rule's question unconditionally.
    const candidates = [
      ...ruleEngineResult.triggered_rules,
      ...ruleEngineResult.flag_rules,
    ]
    const first = candidates[0]
    if (first?.question) return first.question
  }

  // ── Tier 2: a low-confidence dimension that feeds the WINNING persona ──
  if (ontologyVector && relevanceMap) {
    const winner = pickWinningPersona(relevanceMap)
    if (winner) {
      const winnerDims = new Set(getDimensionsForPersona(winner))
      let lowest: { rationale: string; confidence: number } | null = null
      for (const dim of HIGH_SIGNAL_DIMS) {
        if (!winnerDims.has(dim)) continue
        const d = ontologyVector[dim] as { score?: number; confidence?: number; rationale?: string } | undefined
        if (!d || typeof d.score !== 'number') continue
        if (d.score < 4 && d.score > 2) continue // not high-signal
        const confidence = typeof d.confidence === 'number' ? d.confidence : 1
        if (confidence >= DIM_CONFIDENCE_FLAG_THRESHOLD) continue
        if (!lowest || confidence < lowest.confidence) {
          lowest = { rationale: d.rationale ?? '', confidence }
        }
      }
      if (lowest?.rationale) return lowest.rationale
    }
  }

  // ── Tier 3: fall back to the least-certain high-signal dimension,
  // regardless of which persona it feeds (original tier-2 behavior) ──────
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

  // ── Tier 4: nothing worth flagging — silence is correct here ───────────
  return null
}

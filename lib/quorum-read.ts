/**
 * QUORUM — "Quorum's Read" pre-Council structural summary (PR7)
 *
 * SERVER-ONLY. This file imports lib/ai-client.ts (createCompletion), which
 * carries a build-time `import 'server-only'` guard — Next.js will fail the
 * build if ANY client component ends up importing this module, even
 * transitively. Only app/api/session/[id]/quorum-read/route.ts should ever
 * import from here. Client components needing TensionPrediction or
 * readinessLabel must import from lib/quorum-read-shared.ts instead — see
 * that file's header comment for the exact deploy failure this split fixes.
 *
 * Product context (see the code audit + the follow-up product discussion
 * on how to signal differentiation without narrating it): telling a
 * sophisticated user "we structurally analyze your decision" doesn't land
 * — the team tried exactly that with Nancy and it didn't move her. What
 * does work is a claim specific enough to be checked, that then gets
 * checked, in front of the user, by what the advisors actually do. This
 * module produces two things:
 *
 *   1. A plain-English structural summary (what this decision is, what
 *      matters, key constraints, the live tension) — reformatting data
 *      ontology-tagger.ts already computed, nothing new is inferred here.
 *   2. A single, falsifiable tension prediction: which two advisors are
 *      likely to genuinely disagree, and on what axis. This is
 *      DETERMINISTIC, not model-generated — see predictTension() below —
 *      specifically so it can only ever be as reliable as the scoring the
 *      advisor prompts themselves are already keyed to, and never invents
 *      a claim that then visibly fails to pay off.
 *
 * MODEL ROUTING: buildStructuralSummary() below uses `provider: 'openai'`
 * (GPT-5-mini), matching the exact precedent already set for the seven
 * other internal system/utility calls in this app (Examiner question
 * generation, Decision Brief generation, Mirror Fingerprint narrative, the
 * alerts fallback route, voice cleanup — see the "Provider migration
 * (2026-08)" comments at each of those call sites, and resolveProvider's
 * own doc comment in lib/ai-client.ts). Per that doc comment, `'openai'` is
 * an unconditional direct target — NOT subject to tiering, per-user
 * overrides, or ROUTING_MODE — specifically because calls in this category
 * are "internal system/utility calls, not the tier-differentiated
 * advisor-persona experience the fast-role A/B testing exists for" and
 * "should always resolve to the same model regardless of which tier's
 * fast-role provider is currently being tested, or whether tiering is on
 * at all." Reformatting an already-computed ontology vector into 3-4
 * sentences of prose is squarely in that category, not the advisor
 * experience — so this call follows the same rule those seven already do,
 * rather than using `provider: 'deepseek'` (which WOULD be tier-subject,
 * and would make this screen's wording vary by tier/A-B-test for no
 * product reason). The premium/'anthropic' role stays reserved for the two
 * calls where reasoning quality is actually load-bearing: ontology tagging
 * and synthesis.
 */

import { createCompletion } from '@/lib/ai-client'
import type { ScoredVector } from '@/lib/ontology-tagger'
import type { RuleEngineResult } from '@/lib/rule-engine'
import type { TensionPrediction } from '@/lib/quorum-read-shared'

export type { TensionPrediction }   // re-exported for callers that only import from here (e.g. this route's own callers before this split)

// ── Deterministic tension prediction ────────────────────────────────────────
// Takes the full ScoredVector directly — this only ever runs server-side
// (app/api/session/[id]/quorum-read/route.ts), against the same ontology_vector
// row the ontology tagger wrote.
//
// Threshold (score >= 4) matches buildCouncilContext's existing "high-signal
// dimensions only" filter in lib/rule-engine.ts — deliberately the same bar,
// so a prediction only fires when the same signal is strong enough that the
// advisor prompts themselves will actually be responding to it.
const RULES: Array<{
  test: (sv: ScoredVector) => boolean
  advisorA: TensionPrediction['advisorA']
  advisorB: TensionPrediction['advisorB']
  axis: string
}> = [
  {
    test: sv => sv.reversibility.score >= 4 && sv.outcome_uncertainty.score >= 4,
    advisorA: 'risk_architect', advisorB: 'elder',
    axis: 'how much the cost of being wrong should shape the timing',
  },
  {
    test: sv => sv.value_conflict.score >= 4,
    advisorA: 'contrarian', advisorB: 'stakeholder_mirror',
    axis: 'which value should actually win when they conflict',
  },
  {
    test: sv => sv.decision_unit.score >= 4,
    advisorA: 'stakeholder_mirror', advisorB: 'competitor',
    axis: 'whose interests the decision is really being optimised for',
  },
  {
    test: sv => sv.identity_alignment.score >= 4 && sv.regret_asymmetry.score >= 4,
    advisorA: 'elder', advisorB: 'contrarian',
    axis: 'whether this is a practical choice or an identity one',
  },
  {
    test: sv => sv.non_financial_utility.score >= 4,
    advisorA: 'risk_architect', advisorB: 'elder',
    axis: 'whether the financial case should even be the deciding factor here',
  },
]

/**
 * Returns at most one prediction (first matching rule) — deliberately not
 * "all matching rules": a screen with five predicted tensions is noise, and
 * dilutes the one that actually lands. Returns null when nothing scores
 * high enough to predict confidently, which should read as normal, not as
 * a missing feature — most decisions don't have a single dominant fault
 * line, and a forced prediction on a genuinely calm decision is exactly
 * the kind of claim that fails to pay off and costs more trust than it
 * would have earned.
 */
export function predictTension(sv: ScoredVector): TensionPrediction | null {
  const match = RULES.find(r => r.test(sv))
  if (!match) return null
  return { advisorA: match.advisorA, advisorB: match.advisorB, axis: match.axis }
}

// ── Structural summary (fast-role AI call) ──────────────────────────────────

export interface QuorumReadContent {
  yourDecision:   string   // one-sentence restatement of what's actually being decided
  whatMatters:    string   // short phrase list of the top objectives/values in play
  keyConstraints: string   // short phrase list of the binding constraints
  tension:        string   // the central trade-off, in plain language
}

const SUMMARY_SYSTEM_PROMPT = `You compress an already-computed structural analysis of a decision into a short, plain-English summary for the person who wrote it. You are not analyzing anything yourself — every fact you use is already given to you below. Do not add new claims, numbers, or specifics that aren't in the input.

Return ONLY valid JSON, no markdown fences, no preamble, in exactly this shape:
{"yourDecision": "...", "whatMatters": "...", "keyConstraints": "...", "tension": "..."}

Rules:
- yourDecision: one sentence, restating what's actually being decided in the person's own terms — not generic ("a career decision") but specific to what they wrote.
- whatMatters: 2-4 short phrases separated by " · " (e.g. "income security · career identity · optionality")
- keyConstraints: 2-3 short phrases separated by " · "
- tension: one sentence naming the actual trade-off at the center of this decision — plain language, no hedging, no advice.
- Total output under 70 words. No adjectives that aren't earned by the input data.`

function buildSummaryPrompt(decisionText: string, sv: ScoredVector, ruleResult: RuleEngineResult): string {
  const highSignal = Object.entries(sv)
    .filter(([k, v]) => k !== 'vector_version' && typeof v === 'object' && v !== null && 'score' in v)
    .map(([k, v]) => [k, v as { score: number; rationale: string }] as const)
    .filter(([, v]) => v.score >= 4 || v.score <= 2)
    .map(([k, v]) => `${k}: ${v.score}/5 — ${v.rationale}`)
    .join('\n')

  const flags = ruleResult.triggered_rules.map(r => r.question).join('\n')

  return `DECISION AS WRITTEN: "${decisionText.slice(0, 600)}"

STRUCTURAL SIGNALS (already computed, score >= 4 or <= 2 shown):
${highSignal || '(no extreme-scoring dimensions — this reads as a moderate decision on most axes)'}

${flags ? `FLAGGED FOR CLARIFICATION:\n${flags}` : ''}`.trim()
}

/**
 * Fire-and-forget-safe: returns null on any failure so the caller can fall
 * back to rendering the structural signals directly (dimension labels are
 * always available even if this prose layer fails) rather than blocking
 * the pre-Council screen on it.
 */
export async function buildStructuralSummary(
  decisionText: string,
  sv:           ScoredVector,
  ruleResult:   RuleEngineResult,
): Promise<QuorumReadContent | null> {
  try {
    const raw = await createCompletion(
      buildSummaryPrompt(decisionText, sv, ruleResult),
      300,
      // temperature is passed for documentation/future-proofing consistency
      // with the other 'openai' call sites (e.g. mirror/alerts/fallback) —
      // GPT-5-mini silently ignores it today (see completeOpenAICompatible's
      // doc comment in lib/ai-client.ts), so this has no actual effect
      // right now, but costs nothing to keep aligned with that convention.
      { provider: 'openai', systemPrompt: SUMMARY_SYSTEM_PROMPT, temperature: 0.3 },
    )
    const cleaned = raw.trim().replace(/^```json\s*/, '').replace(/```\s*$/, '')
    const parsed = JSON.parse(cleaned) as Partial<QuorumReadContent>
    if (!parsed.yourDecision || !parsed.whatMatters || !parsed.keyConstraints || !parsed.tension) return null
    return parsed as QuorumReadContent
  } catch (err) {
    console.warn('[QuorumRead] structural summary generation failed (non-fatal):', err)
    return null
  }
}

/**
 * QUORUM — Examiner Resolvability Check
 *
 * Audit fix (decision architecture review, recommendation #3):
 * R7 ("Information-First Redirect") blocks synthesis whenever specific
 * missing information would change the outcome. But "missing information
 * exists" and "no useful analysis is possible without it" are not the same
 * thing — the product philosophy's own worked example (funding, regulatory
 * approval for "should I build a spaceship") says exactly this: real, obtainable
 * missing information is normally an execution constraint the Council should
 * reason around, not a reason to refuse to engage.
 *
 * This is a single, cheap, targeted check that runs ONLY when R7 is about to
 * fire (not R1 — R1's own prompt-level gate is already tight and correctly
 * conservative; adding this to R1 would just add latency for no benefit).
 * It asks one direct yes/no question: could a competent advisor still give
 * useful, honest, provisional guidance today, naming the uncertainty rather
 * than being misled by it?
 *
 * Kept deliberately OUT of lib/rule-engine.ts: that file is a pure,
 * synchronous, deterministic function specifically so it can be unit-tested
 * against fixtures without network calls (see tests/examiner-golden-suite.test.ts).
 * This check is async and makes a model call, so it lives in the route layer
 * instead, applied as a post-processing step on top of the pure rule result.
 *
 * Fail-open design: if the check errors out (timeout, parse failure, API
 * error), we do NOT block. Per the product spec, the Examiner should be
 * "extremely conservative" about blocking — an infrastructure failure should
 * never be the reason a user gets redirected instead of getting their
 * analysis. On failure this returns `resolvable: true`, i.e. treat as
 * "Council can still help" and let the normal GATE/OPEN flow proceed.
 */

import { createCompletion } from '@/lib/ai-client'

export interface ResolvabilityResult {
  resolvable: boolean   // true → downgrade R7 from REDIRECT to a GATE-style question
  rationale:  string
}

const RESOLVABILITY_PROMPT = (decision: string, missingInfoRationale: string) => `
A decision has been flagged because specific information that doesn't yet exist would materially affect the outcome. Your job is NOT to answer the decision — it is to judge whether the Council should still be allowed to try.

Answer this exact question: could a genuinely competent advisor give this person useful, honest, provisional guidance RIGHT NOW — explicitly naming what's unknown and how it could change things — rather than the advice being actively misleading until the missing information arrives?

Answer YES if:
- The missing information would sharpen or adjust the advice, but a reasoned, uncertainty-flagged recommendation is still possible and useful today (this is the common case — most "more info would help" situations are like this)
- The decision is fundamentally about values, trade-offs, or judgment under uncertainty, and the missing information is just one input among several

Answer NO only if:
- Literally any analysis given today would point in a direction that could completely reverse once the missing information arrives, such that giving advice now is actively worse than waiting
- The missing information is not just "helpful" but is the entire hinge the decision turns on, with no reasoned provisional answer possible

DECISION: "${decision.slice(0, 450)}"
WHY THIS WAS FLAGGED: ${missingInfoRationale.slice(0, 300)}

Return ONLY valid JSON, no markdown, no preamble: {"resolvable": true|false, "rationale": "one sentence, plain language"}`.trim()

export async function checkR7Resolvable(
  decisionText:          string,
  missingInfoRationale?: string,
): Promise<ResolvabilityResult> {
  try {
    const raw = await createCompletion(
      RESOLVABILITY_PROMPT(decisionText, missingInfoRationale ?? 'Specific missing information would change the outcome.'),
      150,
      { provider: 'anthropic', temperature: 0.1 },
    )
    const clean  = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim()
    const parsed = JSON.parse(clean)
    if (typeof parsed.resolvable !== 'boolean') throw new Error('malformed resolvability response')
    return {
      resolvable: parsed.resolvable,
      rationale:  typeof parsed.rationale === 'string' ? parsed.rationale : '',
    }
  } catch (err) {
    console.error('[Examiner] checkR7Resolvable failed — failing open (not blocking):', err)
    return { resolvable: true, rationale: 'Resolvability check unavailable; defaulted to not blocking (fail-open per conservative-blocking policy).' }
  }
}

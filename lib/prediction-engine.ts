// lib/prediction-engine.ts
// ── Quorum: Prediction Layer (Unified Session, Tier 2) ────────────────────────
//
// Generates Quorum's own hypothesis about what the user will ultimately
// choose — distinct from Synthesis (an analysis of the decision) and from
// initial_instinct (the user's own stated leaning). See sprint_prediction_layer.sql
// for why these three are kept as separate states.
//
// Deliberately NOT part of app/api/persona/route.ts. That file's six-persona
// orchestration, mind-change detection, and advisor-divergence logic are
// tightly coupled to each other; this is a single, cheap, fast call that
// runs before any of that and must not be able to destabilize it. If this
// file has a bug, the worst case is a bad or missing prediction — Council
// and Synthesis still run exactly as before.
//
// Cold start (RISK 3 in the product doc): a user with little or no decision
// history can't get a personalized prediction, and faking confidence there
// is worse than not predicting. Below a history threshold, this uses
// createWebSearchCompletion (lib/ai-client.ts — already wraps Anthropic's
// native web_search tool) to ground the guess in general patterns/base
// rates instead of invented personalization, and says so in the reasoning
// text rather than hiding it. As history accumulates, the prompt leans
// increasingly on past sessions and less on search.

import { createServiceClient }         from '@/lib/supabase'
import { decrypt }                     from '@/lib/encryption'
import { createCompletion, createWebSearchCompletion } from '@/lib/ai-client'

const HISTORY_THRESHOLD_FOR_PERSONALIZATION = 3 // sessions with a final_decision recorded

export interface PredictionResult {
  predictedChoice: string       // short — a phrase, not a paragraph (e.g. "Leave the role")
  reasoning:        string      // 1–3 sentences, own words, no verdict-tag markup
  usedSearch:       boolean
  historyCount:     number      // how many past decided sessions informed this
}

interface PastDecisionSummary {
  optimization_priority: string | null
  initial_instinct:      string | null
  final_decision_plain:  string | null   // decrypted, truncated
}

/**
 * Fetches the user's past decided sessions (final_decision present), most
 * recent first, decrypting final_decision for prompt inclusion. Capped at
 * 12 — this is a prompt-context fetch, not a full history export, and a
 * fast-moving user's oldest patterns are the least relevant to a fresh guess.
 */
async function fetchPastDecisions(userId: string, supabase: ReturnType<typeof createServiceClient>): Promise<PastDecisionSummary[]> {
  const { data } = await supabase
    .from('sessions')
    .select('optimization_priority, initial_instinct, final_decision')
    .eq('user_id', userId)
    .not('final_decision', 'is', null)
    .order('final_decision_locked_at', { ascending: false })
    .limit(12)

  if (!data) return []

  return data.map(row => ({
    optimization_priority: row.optimization_priority,
    initial_instinct:      row.initial_instinct,
    final_decision_plain:  (decrypt(row.final_decision as string) ?? '').slice(0, 140),
  }))
}

function buildPersonalizedBlock(history: PastDecisionSummary[]): string {
  if (history.length === 0) return ''
  const lines = history.map((h, i) =>
    `${i + 1}. Optimized for: ${h.optimization_priority ?? 'unstated'}. ` +
    `Initial lean: ${h.initial_instinct ?? 'unstated'}. Chose: "${h.final_decision_plain}"`
  ).join('\n')
  return `\n\nThis person's past decided sessions, most recent first:\n${lines}\n\n` +
    `Look for a recurring pattern (same optimization priority producing the same ` +
    `kind of choice, or a consistent gap between initial lean and final choice). ` +
    `If you find one, use it as your main evidence. If you don't, say so plainly ` +
    `rather than forcing a pattern that isn't there.`
}

const PREDICTION_SYSTEM_PROMPT = `You are generating a single, short hypothesis about what a specific person will ultimately decide — not advice, not a recommendation, a guess about THEM.

Rules:
- This is a prediction of the person's future choice, never a recommendation of what they should choose. Never write "you should" — only "we think you will."
- Keep predictedChoice to a short phrase (under 8 words) naming the actual choice, not a hedge like "it depends."
- Keep reasoning to 1-3 sentences, plain language, no bullet points, no tag markup.
- If you are relying on general patterns rather than this person's own history, say so directly in the reasoning (e.g. "we don't know you well yet, so this leans on how people generally handle...") rather than implying false personalization.
- Never state a probability or confidence percentage.
- Respond as JSON only: {"predictedChoice": "...", "reasoning": "..."}. No other text.`

/**
 * Generates the prediction. Call this after initial_instinct and
 * optimization_priority are already saved on the session row (see
 * app/api/session/[id]/instinct/route.ts) — both are passed in directly
 * rather than re-fetched, since the caller just wrote them and already has
 * them in hand.
 */
export async function generatePrediction(params: {
  userId:               string
  decisionText:         string
  initialInstinct:      'accept' | 'reject' | 'unsure'
  optimizationPriority: string
}): Promise<PredictionResult> {
  const supabase = createServiceClient()
  const history = await fetchPastDecisions(params.userId, supabase)
  const personalized = history.length >= HISTORY_THRESHOLD_FOR_PERSONALIZATION

  const basePrompt =
    `Decision: "${params.decisionText}"\n` +
    `Their stated initial lean: ${params.initialInstinct}\n` +
    `What they say matters most: ${params.optimizationPriority}` +
    buildPersonalizedBlock(history)

  // Personalized path: enough history to reason from the person's own record,
  // no need for external search.
  if (personalized) {
    const raw = await createCompletion(basePrompt, 400, {
      systemPrompt: PREDICTION_SYSTEM_PROMPT,
      temperature:  0.4,
    })
    const parsed = parsePredictionJSON(raw)
    return { ...parsed, usedSearch: false, historyCount: history.length }
  }

  // Cold-start path: not enough personal history yet — ground the guess in
  // general patterns via web search rather than fabricating personalization.
  const searchPrompt =
    basePrompt +
    `\n\nWe don't have enough of this person's own decision history yet ` +
    `(${history.length} prior decided session(s)). Search for how people ` +
    `generally navigate this kind of trade-off, and base your hypothesis on ` +
    `that general pattern — say plainly in the reasoning that this is a ` +
    `general-pattern guess, not a personalized one.`

  const searchResult = await createWebSearchCompletion(searchPrompt, 500, {
    systemPrompt: PREDICTION_SYSTEM_PROMPT,
    maxUses:      2,
  })
  const parsed = parsePredictionJSON(searchResult.text)
  return { ...parsed, usedSearch: searchResult.usedSearch, historyCount: history.length }
}

function parsePredictionJSON(raw: string): { predictedChoice: string; reasoning: string } {
  try {
    const cleaned = raw.trim().replace(/^```json\s*|\s*```$/g, '')
    const obj = JSON.parse(cleaned)
    if (typeof obj.predictedChoice === 'string' && typeof obj.reasoning === 'string') {
      return { predictedChoice: obj.predictedChoice.trim(), reasoning: obj.reasoning.trim() }
    }
  } catch {
    // fall through to heuristic fallback below
  }
  // Fallback if the model didn't return clean JSON — never throw here; a
  // missing prediction should degrade gracefully, not break the session.
  return {
    predictedChoice: 'Unclear',
    reasoning: 'Quorum couldn\u2019t form a confident hypothesis from this yet.',
  }
}

/**
 * Simple, honest v1 similarity check for the Prediction Reveal's pattern
 * callback ("you made a structurally similar choice N times before" / "you
 * just broke a pattern"). Matches on optimization_priority + whether the
 * final choice tracked or reversed the initial instinct — not semantic
 * similarity of the decision text itself. This is a deliberately simple
 * first pass; swapping in sessions_ontology's structural classification
 * for better matching is a reasonable follow-up, not required for v1.
 */
export function countMatchingPastPattern(
  history: PastDecisionSummary[],
  currentOptimization: string,
  currentTrackedInstinct: boolean,
): number {
  return history.filter(h =>
    h.optimization_priority === currentOptimization &&
    trackedInstinct(h) === currentTrackedInstinct
  ).length
}

function trackedInstinct(h: PastDecisionSummary): boolean {
  if (!h.initial_instinct || !h.final_decision_plain) return false
  const finalLower = h.final_decision_plain.toLowerCase()
  if (h.initial_instinct === 'accept') return !finalLower.startsWith('no') && !finalLower.includes('reject')
  if (h.initial_instinct === 'reject') return finalLower.startsWith('no') || finalLower.includes('reject') || finalLower.includes('declin')
  return false
}

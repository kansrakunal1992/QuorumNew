import 'server-only'
// lib/foundational-context.ts
// ── Context Ingestion — Foundational Context prompt layer ───────────────────
//
// Third, distinct memory layer alongside lib/decision-continuity.ts (Decision
// History) and Mirror's own injection in app/api/persona/route.ts. Composed
// as a sibling of those two at the persona-route level — deliberately NOT
// folded into lib/rule-engine.ts's buildCouncilContext(), so each layer's
// provenance stays legible for debugging and so the model can distinguish
// "background the user gave once" from "what came up in past sessions" from
// "long-run behavioral pattern".
//
// Returns '' (no-op) whenever there's nothing accepted yet — same
// EMPTY_*-style contract as continuity/graph context in the persona route.
// ─────────────────────────────────────────────────────────────────────────────

import { createServiceClient } from './supabase'
import { decrypt } from './encryption'
import { contextIngestionCanOverrideProfile, isContextIngestionEnabled } from './feature-flags'
import { embedText, cosineSimilarity } from './embeddings'
import type { MemoryFactCategory } from './types'
import type { CouncilUserProfile } from './rule-engine'

export const EMPTY_FOUNDATIONAL_CONTEXT = ''

const CATEGORY_LABELS: Record<MemoryFactCategory, string> = {
  goal:                 'Goal',
  value:                'Value',
  constraint:           'Constraint',
  decision_pattern:     'Decision pattern',
  communication_style:  'Communication style',
  relationship:         'Relationship',
  long_term_context:    'Long-term context',
  other:                'Context',
}

interface FoundationalFactRow {
  category:     MemoryFactCategory
  insight_text: string
  importance:   number
  confidence:   number
  embedding:    number[] | null
}

// v1 capped injection at 15 because that was also the per-import cap, so the
// two numbers happened to coincide. They're logically separate: a user who's
// been through more than one import/reanalyze cycle (old accepted facts
// aren't cleared by a fresh import — only "Forget" clears them) can
// accumulate more than 15 accepted facts over time. FETCH_LIMIT is a
// defensive ceiling on the query itself; INJECT_CAP is what actually goes
// into the prompt, chosen by relevance once a decision's text is available.
const FETCH_LIMIT = 50
const INJECT_CAP   = 8

/**
 * Fetch the user's accepted/edited memory facts and render them as a
 * labeled block for injection into the Council system prompt.
 *
 * v2: when `decisionText` is provided AND the user has more facts than
 * INJECT_CAP, ranking blends semantic relevance to THIS decision (cosine
 * similarity against each fact's stored embedding) with importance, instead
 * of always injecting the same static top-N regardless of what's being
 * decided. Falls back to importance × confidence ordering — v1's behavior —
 * whenever decisionText is omitted, the embedding call fails, or the total
 * fact count is small enough that ranking doesn't matter (≤ INJECT_CAP facts
 * just all get included).
 *
 * `profile` is optional — when passed and the override flag is off (the
 * default), any fact that looks like it contradicts an explicit profile
 * pick on the same axis is dropped from this block rather than confusing
 * the model with two disagreeing signals. Supplementary-only by design.
 */
export async function fetchFoundationalContext(
  userId:  string | null,
  profile?: CouncilUserProfile | null,
  decisionText?: string,
): Promise<string> {
  if (!userId) return EMPTY_FOUNDATIONAL_CONTEXT

  try {
    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from('user_memory_facts')
      .select('category, insight_text, importance, confidence, embedding')
      .eq('user_id', userId)
      .in('status', ['accepted', 'edited'])
      .order('importance', { ascending: false })
      .limit(FETCH_LIMIT)

    if (error) {
      console.warn('[FoundationalContext] fetch failed (non-fatal):', error.message)
      return EMPTY_FOUNDATIONAL_CONTEXT
    }
    if (!data || data.length === 0) return EMPTY_FOUNDATIONAL_CONTEXT

    const rows = data as FoundationalFactRow[]
    const allowOverride = contextIngestionCanOverrideProfile()

    const decrypted = rows.map(f => ({
      ...f,
      insight_text: decrypt(f.insight_text) ?? f.insight_text,
    }))

    const eligible = decrypted.filter(f => allowOverride || !conflictsWithProfile(f, profile))
    const ranked = await rankByRelevance(eligible, decisionText)

    const lines = ranked
      .slice(0, INJECT_CAP)
      .map(f => `- [${CATEGORY_LABELS[f.category] ?? 'Context'}] ${f.insight_text}`)

    if (lines.length === 0) return EMPTY_FOUNDATIONAL_CONTEXT

    return [
      '── FOUNDATIONAL CONTEXT (imported by the user at onboarding, not from live sessions) ──',
      'Background the person chose to share once. Weave it in naturally where relevant to this decision — do not quote these lines verbatim or announce that you are drawing on imported context.',
      ...lines,
    ].join('\n')
  } catch (err) {
    console.error('[FoundationalContext] unexpected error (non-fatal):', err)
    return EMPTY_FOUNDATIONAL_CONTEXT
  }
}

// Semantic-relevance reranking — only does real work when there's more to
// rank than INJECT_CAP and a decisionText was supplied. Otherwise returns
// the input in its existing importance-sorted order (v1 behavior), which
// keeps this a no-op — not a regression — for the common case of someone
// with a single import's worth of facts.
async function rankByRelevance(
  facts: (FoundationalFactRow & { insight_text: string })[],
  decisionText?: string,
): Promise<(FoundationalFactRow & { insight_text: string })[]> {
  if (facts.length <= INJECT_CAP || !decisionText) return facts

  const queryEmbedding = await embedText(decisionText)
  if (!queryEmbedding) return facts   // embedding unavailable — fall back to importance order, not an error

  return [...facts].sort((a, b) => {
    const scoreA = blendedScore(a, queryEmbedding)
    const scoreB = blendedScore(b, queryEmbedding)
    return scoreB - scoreA
  })
}

// 60/40 weight toward semantic relevance over stated importance — a highly
// relevant but self-rated-as-minor fact should still surface for THIS
// decision; importance alone would otherwise permanently bury it beneath
// unrelated "important" facts every single session.
function blendedScore(fact: FoundationalFactRow, queryEmbedding: number[]): number {
  const relevance = fact.embedding ? cosineSimilarity(fact.embedding, queryEmbedding) : 0.5   // neutral prior when unembedded
  return relevance * 0.6 + fact.importance * 0.4
}

// ── Mirror narrative integration (v2) ────────────────────────────────────────
// Separate, much smaller fetch than fetchFoundationalContext(): Mirror's
// narrative is about who the person durably is, not what's relevant to a
// specific decision, so only the identity-adjacent categories are pulled,
// capped small to avoid dominating a narrative that's primarily built from
// actual session/bias evidence. Returns null (not '') when there's nothing
// to add, so lib/mirror-fingerprint.ts can skip its prompt addendum entirely
// rather than append an empty instruction block.
const NARRATIVE_CATEGORIES: MemoryFactCategory[] = ['value', 'goal', 'long_term_context']
const MAX_NARRATIVE_FACTS = 5

export async function fetchFoundationalFactsForNarrative(userId: string): Promise<string | null> {
  if (!isContextIngestionEnabled()) return null
  try {
    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from('user_memory_facts')
      .select('category, insight_text, importance')
      .eq('user_id', userId)
      .in('status', ['accepted', 'edited'])
      .in('category', NARRATIVE_CATEGORIES)
      .order('importance', { ascending: false })
      .limit(MAX_NARRATIVE_FACTS)

    if (error || !data || data.length === 0) return null

    const lines = (data as FoundationalFactRow[]).map(f =>
      `- ${decrypt(f.insight_text) ?? f.insight_text}`
    )
    return lines.join('\n')
  } catch (err) {
    console.warn('[FoundationalContext] narrative fetch failed (non-fatal):', err)
    return null
  }
}

// Coarse conflict check — only fires on the risk-stance axis for now, the
// one place a mismatch would visibly confuse a persona (e.g. Risk Architect
// reading "conservative" from the profile and "bold risk-taker" from an
// imported fact in the same prompt). Deliberately narrow: false negatives
// (a real conflict on some other axis slipping through) are lower-cost than
// false positives (dropping a genuinely useful, non-conflicting fact).
function conflictsWithProfile(
  fact:    FoundationalFactRow,
  profile?: CouncilUserProfile | null,
): boolean {
  if (!profile?.risk_stance || fact.category !== 'decision_pattern') return false
  const text = fact.insight_text.toLowerCase()
  if (profile.risk_stance === 'conservative' && /\b(bold|aggressive|high-risk|risk-taking)\b/.test(text)) return true
  if (profile.risk_stance === 'bold' && /\b(risk-averse|cautious|conservative)\b/.test(text)) return true
  return false
}

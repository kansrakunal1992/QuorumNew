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
import { contextIngestionCanOverrideProfile } from './feature-flags'
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
}

/**
 * Fetch the user's accepted/edited memory facts (top 15 by importance ×
 * confidence, matching the cap already enforced at save time — this second
 * cap here is defensive, not load-bearing) and render them as a labeled
 * block for injection into the Council system prompt.
 *
 * `profile` is optional — when passed and the override flag is off (the
 * default), any fact that looks like it contradicts an explicit profile
 * pick on the same axis is dropped from this block rather than confusing
 * the model with two disagreeing signals. Supplementary-only by design.
 */
export async function fetchFoundationalContext(
  userId:  string | null,
  profile?: CouncilUserProfile | null,
): Promise<string> {
  if (!userId) return EMPTY_FOUNDATIONAL_CONTEXT

  try {
    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from('user_memory_facts')
      .select('category, insight_text, importance, confidence')
      .eq('user_id', userId)
      .in('status', ['accepted', 'edited'])
      .order('importance', { ascending: false })
      .limit(15)

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

    const lines = decrypted
      .filter(f => allowOverride || !conflictsWithProfile(f, profile))
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

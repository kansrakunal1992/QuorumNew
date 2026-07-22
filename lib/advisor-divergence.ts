/**
 * lib/advisor-divergence.ts
 * ── Cross-session "which advisor you tend to go against" detection ─────────
 *
 * The mirror image of lib/mind-change-patterns.ts. That module tracks which
 * advisor most often CHANGES the user's mind (pushback_classifications).
 * This one tracks the opposite signal: when the user's own final stated
 * leaning (DecisionStateCard's free-text commitment_leaning field) disagrees
 * with a given advisor's final lean in that session's synthesis — i.e. an
 * advisor whose stance this specific user tends to go against.
 *
 * Deliberately narrow in what it claims, same discipline as
 * mind-change-patterns.ts: this is a count of disagreement outcomes, not a
 * claim that the user is "wrong" to diverge or that the advisor is "right"
 * more often — just a signal that a given advisor may be structurally
 * underweighted relative to how often the user ultimately overrides it.
 * That distinction should stay intact wherever this pattern is surfaced
 * (the Mirror tile copy and the boost this feeds in lib/persona-relevance.ts).
 *
 * MINIMUM_EVENTS gate: same discipline and same value as
 * mind-change-patterns.ts — below this, a "pattern" is one or two data
 * points dressed up as a trend.
 */

import { createServiceClient } from '@/lib/supabase'
import { createCompletion }    from '@/lib/ai-client'
import type { AdvisorKey }     from '@/lib/persona-relevance'

const MINIMUM_EVENTS = 3

const PERSONA_LABELS: Record<AdvisorKey, string> = {
  contrarian:          'the Contrarian',
  risk_architect:      'the Risk Architect',
  pattern_analyst:     'the Pattern Analyst',
  stakeholder_mirror:  'the Stakeholder Mirror',
  elder:               'the Elder',
  competitor:          'the Competitor',
}

type Lean = 'proceed' | 'wait' | 'mixed'
const VALID_LEANS: Lean[] = ['proceed', 'wait', 'mixed']

export interface AdvisorDivergencePattern {
  persona:         AdvisorKey
  personaLabel:    string
  divergentCount:  number   // sessions where this advisor's lean disagreed with the user's stated lean
}

// ── Step 1: classify the user's free-text stated leaning ──────────────────
//
// commitment_leaning is free text ("I think I'm going to wait a few months
// and see how things shake out") — not already one of proceed|wait|mixed.
// This has to be reduced to the same three-value enum synthesis_versions.leans
// already uses, or there's nothing to compare against. Fail-open: any
// ambiguity, parse failure, or API error returns null and the caller skips
// detection entirely rather than guessing — a wrong classification here
// would corrupt the divergence signal, which is worse than just not logging
// this session at all.

const CLASSIFY_LEAN_PROMPT = (statedLeaning: string) => `
Classify this person's stated leaning on a decision into exactly one category.

STATED LEANING: "${statedLeaning.slice(0, 500)}"

Categories:
- "proceed" — they've decided to move forward / go ahead
- "wait" — they've decided to hold off, delay, or not act yet
- "mixed" — genuinely conditional or split (proceeding with real caveats, or two different things being decided differently)
- "unclear" — the text doesn't actually state a leaning, or is too ambiguous to classify safely

Return ONLY valid JSON, no markdown, no preamble: {"lean": "proceed"|"wait"|"mixed"|"unclear"}`.trim()

async function classifyStatedLeaning(statedLeaning: string): Promise<Lean | null> {
  try {
    // provider: 'anthropic' is respected as-is in hybrid mode (default) —
    // Claude does the JSON parsing here. Under ROUTING_MODE=deepseek_only,
    // resolveProvider() in lib/ai-client.ts silently overrides this to
    // 'deepseek' instead — DeepSeek then produces (and is responsible for
    // the validity of) the same JSON contract. That's an accepted
    // model-quality risk, not something this function routes around: if
    // DeepSeek adheres to the instruction, this works identically to the
    // Claude path; if it doesn't, JSON.parse throws and the catch below
    // fails open (skip this session) same as any other transient failure.
    const raw   = await createCompletion(CLASSIFY_LEAN_PROMPT(statedLeaning), 60, {
      provider:    'anthropic',
      temperature: 0.1,
    })
    const clean  = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim()
    const parsed = JSON.parse(clean)
    return VALID_LEANS.includes(parsed.lean) ? (parsed.lean as Lean) : null
  } catch (err) {
    console.error('[AdvisorDivergence] classifyStatedLeaning failed (non-fatal):', err)
    return null
  }
}

// ── Step 2: detect + log divergence for one session ────────────────────────
//
// Called from app/api/session/commitment/route.ts right after a commitment
// save succeeds. Never throws — a failure here should never affect the
// commitment save the user is already relying on.

export async function detectAdvisorDivergence(
  sessionId:     string,
  statedLeaning: string | null | undefined,
): Promise<void> {
  if (!statedLeaning?.trim()) return

  try {
    const supabase = createServiceClient()

    // Same identity resolution as pushback-classification/route.ts.
    const { data: sessionRow } = await supabase
      .from('sessions')
      .select('user_id, user_email')
      .eq('id', sessionId)
      .single()

    const userId    = sessionRow?.user_id    ?? null
    const userEmail = sessionRow?.user_email ?? null

    // Anonymous session — nothing to build a cross-session pattern from.
    // Not an error; same expected silent path as pushback-classification.
    if (!userId && !userEmail) return

    const classifiedLean = await classifyStatedLeaning(statedLeaning)
    if (!classifiedLean) return // ambiguous free text — nothing safe to compare

    // Latest synthesis version for this session carries each advisor's final
    // lean at the moment the user committed — exactly what "final stance"
    // should mean here, not an earlier pre-pushback lean.
    const { data: latestVersion } = await supabase
      .from('synthesis_versions')
      .select('leans')
      .eq('session_id', sessionId)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle()

    const leans = (latestVersion?.leans ?? {}) as Partial<Record<AdvisorKey, string>>
    if (Object.keys(leans).length === 0) return

    const rows: {
      session_id:       string
      persona_key:      AdvisorKey
      advisor_lean:     Lean
      user_stated_lean: Lean
      user_id:          string | null
      user_email:       string | null
    }[] = []

    for (const [persona, advisorLean] of Object.entries(leans) as [AdvisorKey, string][]) {
      if (!VALID_LEANS.includes(advisorLean as Lean)) continue
      if (advisorLean === classifiedLean) continue // agreement — not a divergence event
      rows.push({
        session_id:       sessionId,
        persona_key:      persona,
        advisor_lean:     advisorLean as Lean,
        user_stated_lean: classifiedLean,
        user_id:          userId,
        user_email:       userEmail,
      })
    }

    if (rows.length === 0) return

    const { error } = await supabase.from('advisor_divergence_events').insert(rows)
    if (error) console.error('[AdvisorDivergence] insert failed (non-fatal):', error)
  } catch (err) {
    console.error('[AdvisorDivergence] detectAdvisorDivergence failed (non-fatal):', err)
  }
}

// ── Step 3: cross-session aggregation ───────────────────────────────────────
//
// Mirrors getMindChangePattern's shape and gating exactly. Picks by
// divergentCount (not a rate) for the same reason mind-change-patterns picks
// by persuasiveCount: a persona the user has diverged from 6 times is a
// stronger, more actionable signal than one diverged from once.

export async function getAdvisorDivergencePattern(
  userId:    string | null,
  userEmail: string | null,
): Promise<AdvisorDivergencePattern | null> {
  if (!userId && !userEmail) return null

  try {
    const supabase = createServiceClient()
    let query = supabase
      .from('advisor_divergence_events')
      .select('persona_key')

    query = userId && userEmail
      ? query.or(`user_id.eq.${userId},user_email.eq.${userEmail}`)
      : userId
        ? query.eq('user_id', userId)
        : query.eq('user_email', userEmail as string)

    const { data } = await query
    if (!data || data.length === 0) return null

    const counts: Partial<Record<AdvisorKey, number>> = {}
    for (const row of data as { persona_key: AdvisorKey }[]) {
      counts[row.persona_key] = (counts[row.persona_key] ?? 0) + 1
    }

    let best: AdvisorDivergencePattern | null = null
    for (const [persona, count] of Object.entries(counts) as [AdvisorKey, number][]) {
      if (count < MINIMUM_EVENTS) continue
      if (!best || count > best.divergentCount) {
        best = {
          persona,
          personaLabel:   PERSONA_LABELS[persona],
          divergentCount: count,
        }
      }
    }

    return best
  } catch (err) {
    console.error('[AdvisorDivergence] getAdvisorDivergencePattern failed (non-fatal):', err)
    return null
  }
}

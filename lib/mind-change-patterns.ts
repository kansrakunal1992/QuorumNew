/**
 * lib/mind-change-patterns.ts
 * ── Cross-session "what changes your mind" pattern detection ────────────────
 *
 * Reads pushback_classifications (see supabase/sprint_pushback_classifications.sql)
 * across ALL of a user's sessions — not just this one — to answer a question
 * no single session can answer on its own: which advisor, over time, most
 * often earns a materially-valid or recommendation-changing response from
 * THIS specific person, versus getting held to a weak/partially-valid read.
 *
 * Deliberately narrow in what it claims. This is a count of classification
 * outcomes, not a claim about decision quality — a persona a user often
 * updates for isn't necessarily "right" more often, just more persuasive to
 * this specific person. The Mirror tile copy (components/MindChangeTile.tsx)
 * and the boost this feeds (lib/persona-relevance.ts) are both worded to
 * reflect that distinction, not overclaim it.
 *
 * MINIMUM_EVENTS gate: below this, a "pattern" is one or two data points
 * dressed up as a trend. Matches the same discipline as
 * calibration-engine.ts's zone detection, which also requires a minimum
 * sample before treating a delta as a real pattern rather than noise.
 */

import { createServiceClient } from '@/lib/supabase'
import type { AdvisorKey } from '@/lib/persona-relevance'

const MINIMUM_EVENTS = 3

const PERSONA_LABELS: Record<AdvisorKey, string> = {
  contrarian:         'the Contrarian',
  risk_architect:      'the Risk Architect',
  pattern_analyst:     'the Pattern Analyst',
  stakeholder_mirror:  'the Stakeholder Mirror',
  elder:               'the Elder',
  competitor:          'the Competitor',
}

export interface MindChangePattern {
  persona:            AdvisorKey
  personaLabel:       string
  persuasiveCount:    number   // materially_valid + recommendation_changing
  totalCount:         number   // all classifications for this persona
  persuasiveRate:      number  // persuasiveCount / totalCount, 0-1
}

/** Returns the single strongest mind-change pattern for this user, or null
 *  if there isn't enough data yet, or no persona clears the minimum. Picks
 *  by persuasiveCount (not rate) — a persona with 6/10 persuasive is a
 *  stronger, more actionable signal than one with 1/1, even though the
 *  latter has a "higher" rate on paper. */
export async function getMindChangePattern(
  userId: string | null,
  userEmail: string | null,
): Promise<MindChangePattern | null> {
  if (!userId && !userEmail) return null

  try {
    const supabase = createServiceClient()
    let query = supabase
      .from('pushback_classifications')
      .select('persona_key, classification')

    query = userId && userEmail
      ? query.or(`user_id.eq.${userId},user_email.eq.${userEmail}`)
      : userId
        ? query.eq('user_id', userId)
        : query.eq('user_email', userEmail as string)

    const { data } = await query
    if (!data || data.length === 0) return null

    const counts: Partial<Record<AdvisorKey, { persuasive: number; total: number }>> = {}
    for (const row of data as { persona_key: AdvisorKey; classification: string }[]) {
      const bucket = counts[row.persona_key] ?? { persuasive: 0, total: 0 }
      bucket.total += 1
      if (row.classification === 'materially_valid' || row.classification === 'recommendation_changing') {
        bucket.persuasive += 1
      }
      counts[row.persona_key] = bucket
    }

    let best: MindChangePattern | null = null
    for (const [persona, bucket] of Object.entries(counts) as [AdvisorKey, { persuasive: number; total: number }][]) {
      if (bucket.persuasive < MINIMUM_EVENTS) continue
      if (!best || bucket.persuasive > best.persuasiveCount) {
        best = {
          persona,
          personaLabel:    PERSONA_LABELS[persona],
          persuasiveCount: bucket.persuasive,
          totalCount:      bucket.total,
          persuasiveRate:  bucket.persuasive / bucket.total,
        }
      }
    }

    return best
  } catch (err) {
    console.error('[MindChangePatterns] getMindChangePattern failed (non-fatal):', err)
    return null
  }
}

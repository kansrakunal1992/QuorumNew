import 'server-only'

// lib/stakeholder-network.ts
// ── Stakeholder network insights (Phase 5, v3) ────────────────────────────────
//
// Plan section 16's example: "You consulted Sarah in 8 major decisions, and
// her input was reflected in your final decision in 5." Two pieces:
//   1. evaluateSessionReflections — runs once, at decision-lock time (see the
//      two call sites in app/api/session/[id]/decide and
//      app/api/chat-intake/done), comparing each of that session's
//      stakeholder_inputs against the decision that got made.
//   2. getStakeholderNetworkSummary — the aggregation query that turns those
//      per-input booleans into the "consulted N times, reflected in M" line.
//
// Deliberately observable-history language only (plan section 16: "Use
// observable history," never a psychological conclusion) — this file
// produces counts, not claims about why someone consults a given person.

import { createServiceClient } from '@/lib/supabase'
import { decrypt, decryptJson } from '@/lib/encryption'
import { createCompletion } from '@/lib/ai-client'
import type { ExtractedStakeholderClaims } from '@/lib/stakeholder-extract'

const REFLECTION_PROMPT = (decisionText: string, inputs: { id: string; recommendation: string | null; claims: string[] }[]) => `A decision was made. For each person's input below, say whether the final decision lines up with what they said — specifically whether their recommendation (or, if they gave none, their claims) points the same direction as what was actually decided.

THE FINAL DECISION:
${decisionText.slice(0, 800)}

INPUTS TO CHECK:
${inputs.map(i => `[${i.id}] ${i.recommendation ? `Recommended: ${i.recommendation}` : `Claims: ${i.claims.join('; ')}`}`).join('\n')}

Return ONLY a JSON object mapping each id to true or false:
{ "id1": true, "id2": false }`.trim()

/**
 * Fire-and-forget from a decision-lock route — never blocks the response
 * the user is waiting on. Only evaluates inputs that haven't been scored
 * yet (reflected_in_decision IS NULL), and only ever writes each row once —
 * see the column comment in supabase/sprint_email_and_network_v3.sql for why
 * a later correction to the decision doesn't retroactively rewrite this.
 */
export async function evaluateSessionReflections(sessionId: string, decisionText: string): Promise<void> {
  if (!decisionText?.trim()) return

  try {
    const supabase = createServiceClient()
    const { data: rows } = await supabase
      .from('stakeholder_inputs')
      .select('id, extracted_claims')
      .eq('session_id', sessionId)
      .is('reflected_in_decision', null)

    if (!rows?.length) return

    const inputs = rows.map(r => {
      const extracted = decryptJson<ExtractedStakeholderClaims>(r.extracted_claims)
      return { id: r.id, recommendation: extracted?.recommendation ?? null, claims: extracted?.claims ?? [] }
    }).filter(i => i.recommendation || i.claims.length)

    if (!inputs.length) return

    const raw = await createCompletion(REFLECTION_PROMPT(decisionText, inputs), 300, { provider: 'deepseek' })
    const clean = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim()
    const result = JSON.parse(clean) as Record<string, boolean>

    await Promise.all(
      Object.entries(result).map(([id, reflected]) =>
        supabase.from('stakeholder_inputs').update({ reflected_in_decision: !!reflected }).eq('id', id),
      ),
    )
  } catch (err) {
    // Never throws into the caller — this is a nice-to-have insight, not
    // something that should ever fail a decision-lock request.
    console.error('[StakeholderNetwork] evaluateSessionReflections failed:', err)
  }
}

export interface StakeholderNetworkEntry {
  stakeholderId:      string
  name:               string
  consultedCount:     number
  reflectedCount:      number   // among the subset that has been scored — see reflected_in_decision's null-means-pending meaning
  lastConsultedAt:     string
}

export async function getStakeholderNetworkSummary(userId: string): Promise<StakeholderNetworkEntry[]> {
  const supabase = createServiceClient()

  const { data: stakeholders } = await supabase
    .from('stakeholders')
    .select('id, name, last_referenced_at')
    .eq('user_id', userId)

  if (!stakeholders?.length) return []

  const { data: inputs } = await supabase
    .from('stakeholder_inputs')
    .select('stakeholder_id, reflected_in_decision')
    .in('stakeholder_id', stakeholders.map(s => s.id))

  return stakeholders
    .map(s => {
      const own = (inputs ?? []).filter(i => i.stakeholder_id === s.id)
      return {
        stakeholderId:   s.id,
        name:            decrypt(s.name) ?? '',
        consultedCount:  own.length,
        reflectedCount:  own.filter(i => i.reflected_in_decision === true).length,
        lastConsultedAt: s.last_referenced_at,
      }
    })
    .filter(e => e.consultedCount > 0)
    .sort((a, b) => b.consultedCount - a.consultedCount)
}

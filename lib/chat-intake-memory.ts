import 'server-only'
// lib/chat-intake-memory.ts
// ── Natural Intake (v7) — what Quorum already knows about a returning person ──
//
// A returning, signed-in person shouldn't be asked their role, their city or
// whether anyone depends on them if Quorum already has that from an earlier
// import. This builds a short, plain "known background" block for the planner
// prompt (lib/chat-intake-planner.ts), which may use it to fill brief slots —
// marked "(from earlier)" in the person's own brief so they can correct it.
//
// Sources, all existing and all opt-in on the person's side:
//   - accepted / edited memory facts from Context Ingestion
//     (lib/foundational-context.ts — the same ranking and conflict rules the
//     Council uses, so nothing is surfaced here that the Council wouldn't see)
//   - the two profile fields that describe their situation, not their psychology
//     (life stage, risk stance)
//
// Returns '' for anonymous people, when Context Ingestion is off, or on ANY
// error — background is an enrichment, never something that can fail a turn.
// Never persisted into decision_state (which is stored unencrypted); fetched
// per turn, and only on the first few turns, where it can still save a question.

import { createServiceClient } from '@/lib/supabase'
import { fetchFoundationalContext } from '@/lib/foundational-context'
import { isContextIngestionEnabled, isIntakeHistoryReuseEnabled } from '@/lib/feature-flags'
import { durableBackgroundLines, MAX_HISTORY_ROWS } from '@/lib/chat-intake-history'
import type { PriorIntake } from '@/lib/chat-intake-history'

const MAX_BACKGROUND_CHARS = 1200
export const BACKGROUND_FETCH_UNTIL_EXCHANGE = 3

/**
 * v11: what the person already told Quorum in their own earlier, confirmed decisions (recent, situation-level facts
 * only — see lib/chat-intake-history.ts). Off unless NEXT_PUBLIC_INTAKE_HISTORY_REUSE=true. Never throws.
 */
export async function fetchHistoryBackground(userId: string, excludeIntakeId?: string | null): Promise<string> {
  if (!isIntakeHistoryReuseEnabled()) return ''
  try {
    let q = createServiceClient()
      .from('chat_intakes')
      .select('id, created_at, decision_state')
      .eq('user_id', userId)
      .eq('status', 'checkpointed')               // only decisions the person confirmed
      .order('created_at', { ascending: false })
      .limit(MAX_HISTORY_ROWS + 1)
    if (excludeIntakeId) q = q.neq('id', excludeIntakeId)
    const { data } = await q
    const lines = durableBackgroundLines((data ?? []) as PriorIntake[])
    return lines.length ? lines.join('\n') : ''
  } catch (err) {
    console.warn('[ChatIntake] history background failed (non-fatal):', err)
    return ''
  }
}

export async function fetchIntakeBackground(
  userId:        string | null,
  decisionText:  string,
  exchangeCount: number,
  currentIntakeId?: string | null,
): Promise<string> {
  if (!userId || exchangeCount > BACKGROUND_FETCH_UNTIL_EXCHANGE) return ''
  try {
    const parts: string[] = []

    // v11: their own earlier decisions (opt-in flag; '' when off, anonymous, or nothing recent to reuse).
    const history = await fetchHistoryBackground(userId, currentIntakeId)
    if (history) parts.push(history)

    if (isContextIngestionEnabled()) {
      const memory = await fetchFoundationalContext(userId, null, decisionText)
      if (memory) {
        // Drop the Council-facing header/instructions; keep only the fact lines.
        const lines = memory.split('\n').filter(l => l.startsWith('- '))
        if (lines.length) parts.push(lines.join('\n'))
      }
    }

    const { data: profile } = await createServiceClient()
      .from('user_profiles')
      .select('life_stage, risk_stance')
      .eq('user_id', userId)
      .single()
    const profileLines: string[] = []
    if (profile?.life_stage)  profileLines.push(`- Life stage: ${profile.life_stage}`)
    if (profile?.risk_stance) profileLines.push(`- Risk stance: ${profile.risk_stance}`)
    if (profileLines.length) parts.push(profileLines.join('\n'))

    return parts.join('\n').slice(0, MAX_BACKGROUND_CHARS)
  } catch (err) {
    console.warn('[ChatIntake] background fetch failed (non-fatal):', err)
    return ''
  }
}

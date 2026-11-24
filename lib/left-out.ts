// lib/left-out.ts
// ── v17 Phase 6: which questions did the intake not ask? (pure) ──────────────
//
// The intake can finish without asking everything. The fast path deliberately leaves lower-weight required slots to the Council
// ("not asked"), and any chat that reaches its ceiling stops with some material gaps. The Council is told about both; the person
// was not, and had nowhere to go back and add them. This lists those questions, most decision-changing first, in Quorum's own
// plain wording (lib/chat-intake-brief.ts), so the Council page can offer "add what I left out".
//
// It lists QUESTIONS only. It never includes a slot the person already answered, said they did not know, said did not apply, or
// chose to skip: those were decisions, and asking again would be nagging.

import { councilReadiness } from '@/lib/chat-intake-depth'
import { isKnown, slotsFor } from '@/lib/chat-intake-brief'
import type { ChatDecisionState } from '@/lib/types'

export const MAX_LEFT_OUT = 4

export interface LeftOutItem { key: string; label: string; ask: string; chips?: string[] }

export function leftOutFor(state: ChatDecisionState | null | undefined, max = MAX_LEFT_OUT): LeftOutItem[] {
  if (!state || !state.decisionKind) return []
  const r = councilReadiness(state)
  const wanted   = new Set<string>([...r.criticalOpen, ...r.gaps, ...r.deferred])
  const declined = new Set<string>([...(state.unknownFacts ?? []), ...(state.naSlots ?? []), ...(state.skippedSlots ?? [])])
  return slotsFor(state.decisionKind)
    .filter(sl => wanted.has(sl.key) && !declined.has(sl.key) && !isKnown(state, sl.key) && !state.cardAnswers?.[sl.key]?.selectedIds?.length)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, max)
    .map(sl => ({ key: sl.key, label: sl.label, ask: sl.ask, ...(sl.chips?.length ? { chips: sl.chips } : {}) }))
}

/**
 * The text sent to the advisors as new information. Plain, in the person's own words, and explicit that these are facts that
 * were not asked about earlier, so the advisors treat them as new evidence and are free to move in any direction (or not move).
 */
export function composeLeftOutText(items: Array<{ key: string; label: string }>, answers: Record<string, string>): string {
  const lines = items
    .map(it => ({ label: it.label, a: (answers[it.key] ?? '').trim() }))
    .filter(x => x.a.length > 0)
    .map(x => `- ${x.label}: ${x.a}`)
  if (lines.length === 0) return ''
  return `Things that were not asked about earlier, which I want you to take into account:\n${lines.join('\n')}`
}

// lib/chat-intake-history.ts
// ── What a returning person already told Quorum in earlier decisions (pure) ───
//
// A returning, signed-in person shouldn't be asked "how long is your runway?" or "who depends on you?" in every
// decision if they answered it recently. This turns their earlier, confirmed chats into a few short background
// lines for the planner (lib/chat-intake-planner.ts), which already knows to use background so it isn't asked again
// and to mark what it relied on "(from earlier)" so the person can see and correct it on the confirm screen.
//
// Deliberately narrow:
//   • only facts about the PERSON'S SITUATION that stay true across decisions (their role, money runway, who depends
//     on them) — never anything specific to one decision (the offer, the deadline, what they'd give up);
//   • only recent ones (money moves faster than a role), newest wins, and each line says how long ago it was said;
//   • never a fact the person said they didn't know, never one that was itself carried over from earlier
//     (that would re-date old information as new);
//   • nothing is invented or summarised by a model: the lines are the person's own short phrases.
//
// Pure and client-safe (types only). The database read lives in lib/chat-intake-memory.ts.

import type { ChatDecisionState } from '@/lib/types'

export interface PriorIntake {
  created_at:     string
  decision_state: ChatDecisionState | null
}

interface DurableSlot { key: string; label: string; maxAgeDays: number }

/** Slot keys (lib/chat-intake-brief.ts) that describe the person rather than one decision. */
export const DURABLE_SLOTS: DurableSlot[] = [
  { key: 'role',    label: 'Their current role and how long they have been in it', maxAgeDays: 365 },
  { key: 'runway',  label: 'Money runway',                                         maxAgeDays: 120 },
  { key: 'capital', label: 'Money and runway',                                     maxAgeDays: 120 },
  { key: 'people',  label: 'Who depends on them',                                  maxAgeDays: 365 },
]

export const MAX_HISTORY_LINES   = 4
export const MAX_HISTORY_ROWS    = 8
const MAX_VALUE_CHARS            = 140
const CARRIED_PREFIX             = /^\s*\(from earlier\)\s*/i
const PLACEHOLDER                = /^(not mentioned|unknown|n\/a|na|none given|not sure|tbd|-+)$/i
const DAY_MS                     = 86_400_000

/** "3 weeks ago" / "5 months ago" — coarse on purpose; precision here would only invite false confidence. */
export function agoLabel(days: number): string {
  if (days < 14)  return 'recently'
  if (days < 60)  return `${Math.round(days / 7)} weeks ago`
  return `${Math.round(days / 30)} months ago`
}

const clean = (v: unknown): string =>
  String(v ?? '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_VALUE_CHARS)

/**
 * Background lines drawn from the person's earlier confirmed decisions. `rows` may be in any order.
 * Returns [] when there is nothing recent and durable to reuse.
 */
export function durableBackgroundLines(rows: PriorIntake[], now: Date = new Date()): string[] {
  const dated = rows
    .map(r => ({ r, t: Date.parse(r.created_at) }))
    .filter(x => Number.isFinite(x.t) && x.t <= now.getTime())
    .sort((a, b) => b.t - a.t)                     // newest first
    .slice(0, MAX_HISTORY_ROWS)

  const lines: string[] = []
  for (const slot of DURABLE_SLOTS) {
    if (lines.length >= MAX_HISTORY_LINES) break
    for (const { r, t } of dated) {
      const st = r.decision_state
      if (!st) continue
      const raw = (st.facts as Record<string, unknown> | undefined)?.[slot.key]
      if (typeof raw !== 'string') continue
      if (CARRIED_PREFIX.test(raw)) continue                              // carried over earlier: not this chat's own answer
      if ((st.unknownFacts ?? []).includes(slot.key)) continue            // they said they did not know
      const value = clean(raw)
      if (value.length < 3 || PLACEHOLDER.test(value)) continue
      const days = (now.getTime() - t) / DAY_MS
      if (days > slot.maxAgeDays) break                                   // rows are newest-first: older ones are older still
      lines.push(`- ${slot.label} (told us ${agoLabel(days)}): ${value}`)
      break
    }
  }
  return lines
}

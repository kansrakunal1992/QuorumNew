// lib/chat-intake-plan-parse.ts
// ── Natural Intake (v7) — planner output validation (pure) ───────────────────
//
// Split out of lib/chat-intake-planner.ts so it can be unit-tested and reused
// without pulling in lib/ai-client.ts's server-only guard. The model proposes;
// everything it returns is validated here before the turn logic
// (lib/chat-intake-turn.ts) is allowed to look at it. Anything that doesn't
// pass is dropped, never "repaired" into something the person didn't say.

import type { ChatDecisionState } from '@/lib/types'
import { parseJSONLoose } from './json-repair'
import { isDecisionKind } from './chat-intake-brief'

// A "fact" that is really a shrug is not a fact (same rule the turn logic applies).
export const NON_ANSWER = /^\s*(unknown|unclear|unspecified|not (mentioned|specified|stated|provided|known|sure|given|discussed)|none given|no (info|information|answer)|n\/?a|tbd|\?+|-+)\s*\.?\s*$/i

export interface PlannerOutput {
  /** Content fields only — server-owned bookkeeping (phase, askCounts, chips...) is never taken from the model. */
  notes:               Partial<ChatDecisionState>
  answeredPending:     boolean | null
  aboutQuorum:         boolean
  next:                { slotKey: string; question: string; chips: unknown } | null
  playback:            string | null
  smartFriendQuestion: string | null
  /** v9: what the extra question is about — must be one of SMART_FRIEND_GAPS, or the question is dropped. */
  smartFriendGap?:     string | null
  /** v9: one grounded, provisional line shown above the next question (validated in lib/chat-intake-reflection.ts). */
  reflection?:         string | null
}


// ── Validation ───────────────────────────────────────────────────────────────

const str = (v: unknown, max = 400): string | null =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null

const strList = (v: unknown, max = 12, each = 200): string[] | undefined =>
  Array.isArray(v) ? v.map(x => str(x, each)).filter((x): x is string => !!x).slice(0, max) : undefined

const OPTION_TYPES = ['act', 'dont_act', 'wait', 'gather_info', 'experiment']
const CONSULT      = ['expertise', 'challenge', 'approval', 'affected', 'trust']
const REVERSIBLE   = ['reversible', 'somewhat_reversible', 'irreversible']
const STAKES       = ['low', 'medium', 'high']

/** Turns whatever the model returned into a safe PlannerOutput, or null if it is unusable. Exported for tests. */
export function parsePlannerOutput(raw: string): PlannerOutput | null {
  const j = parseJSONLoose<Record<string, unknown>>(raw)
  if (!j || typeof j !== 'object') return null

  const n = (j.notes && typeof j.notes === 'object' ? j.notes : {}) as Record<string, unknown>
  const notes: Partial<ChatDecisionState> = {}

  const statement = str(n.decisionStatement, 300)
  if (statement) notes.decisionStatement = statement
  if (isDecisionKind(n.decisionKind)) notes.decisionKind = n.decisionKind

  if (Array.isArray(n.options)) {
    const options = n.options
      .map(o => (o && typeof o === 'object' ? o as Record<string, unknown> : null))
      .filter((o): o is Record<string, unknown> => !!o && !!str(o.label, 80))
      .map(o => ({ label: str(o.label, 80)!, type: (OPTION_TYPES.includes(o.type as string) ? o.type : 'act') as 'act' | 'dont_act' | 'wait' | 'gather_info' | 'experiment' }))
      .slice(0, 6)
    if (options.length) notes.options = options
  }
  if (OPTION_TYPES.includes(n.leaningOptionType as string)) notes.leaningOptionType = n.leaningOptionType as 'act'
  if (OPTION_TYPES.includes(n.initialReaction as string))   notes.initialReaction   = n.initialReaction as 'act'
  if (REVERSIBLE.includes(n.reversibility as string))       notes.reversibility     = n.reversibility as 'reversible'
  if (STAKES.includes(n.stakes as string))                  notes.stakes            = n.stakes as 'low'

  if (Array.isArray(n.stakeholders)) {
    const st = n.stakeholders
      .map(s => (s && typeof s === 'object' ? s as Record<string, unknown> : null))
      .filter((s): s is Record<string, unknown> => !!s && !!str(s.name, 80))
      .map(s => ({
        name: str(s.name, 80)!,
        role: str(s.role, 80),
        consultReason: CONSULT.includes(s.consultReason as string) ? (s.consultReason as 'expertise') : null,
      }))
      .slice(0, 8)
    if (st.length) notes.stakeholders = st
  }

  const deadline = str(n.deadline, 120);                 if (deadline) notes.deadline = deadline
  const threshold = str(n.decisionThreshold, 240);       if (threshold) notes.decisionThreshold = threshold
  const gut = str(n.gutFeeling, 200);                    if (gut) notes.gutFeeling = gut
  const success = str(n.successPicture, 240);            if (success) notes.successPicture = success
  const assumptions = strList(n.assumptions);            if (assumptions?.length) notes.assumptions = assumptions
  const unknowns = strList(n.unknowns);                  if (unknowns?.length) notes.unknowns = unknowns
  const evidence = strList(n.evidence);                  if (evidence?.length) notes.evidence = evidence
  const corrections = strList(n.userCorrections);        if (corrections?.length) notes.userCorrections = corrections
  const tensions = strList(n.contradictions, 3, 200);    if (tensions?.length) notes.contradictions = tensions
  const corrected = strList(n.correctedSlots, 4, 40);    if (corrected?.length) notes.correctedSlots = corrected

  if (n.facts && typeof n.facts === 'object' && !Array.isArray(n.facts)) {
    const facts: Record<string, string> = {}
    for (const [k, v] of Object.entries(n.facts as Record<string, unknown>)) {
      const val = str(v, 160)
      // A placeholder like "not mentioned" is the model shrugging, not an answer.
      if (val && /^[a-z_]{2,32}$/.test(k) && !NON_ANSWER.test(val)) facts[k] = val
    }
    if (Object.keys(facts).length) notes.facts = facts
  }
  const unknownFacts = strList(n.unknownFacts, 12, 40)?.filter(k => /^[a-z_]{2,32}$/.test(k))
  if (unknownFacts?.length) notes.unknownFacts = unknownFacts
  const naSlots = strList(n.naSlots, 12, 40)?.filter(k => /^[a-z_]{2,32}$/.test(k))
  if (naSlots?.length) notes.naSlots = naSlots

  let next: PlannerOutput['next'] = null
  if (j.next && typeof j.next === 'object') {
    const x = j.next as Record<string, unknown>
    const slotKey = str(x.slotKey, 40), question = str(x.question, 300)
    if (slotKey && question) next = { slotKey, question, chips: x.chips }
  }

  return {
    notes,
    answeredPending:     typeof j.answeredPending === 'boolean' ? j.answeredPending : null,
    aboutQuorum:         j.aboutQuorum === true,
    next,
    playback:            str(j.playback, 500),
    smartFriendQuestion: str(j.smartFriendQuestion, 240),
    smartFriendGap:      str(j.smartFriendGap, 30),
    reflection:          str(j.reflection, 400),
  }
}


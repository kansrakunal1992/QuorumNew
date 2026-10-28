// lib/chat-intake-brief.ts
// ── Natural Intake (v7) — the decision brief ─────────────────────────────────
//
// Before v7 the chat worked through a fixed, domain-blind checklist (feelings,
// success picture, who's involved, reversibility...). Someone typing "I want to
// quit my job" or "Should I move to a different city" was never asked the
// obvious specifics (which job, what next, which city from and to) because
// nothing in the chat knew what KIND of decision it was looking at.
//
// v7 replaces "ask until N questions are gone" with "ask until the brief is
// filled", where filled means every required slot is either KNOWN, explicitly
// UNKNOWN ("I don't know" is data, not a failure), or NOT APPLICABLE. The slots
// depend on the kind of decision. A power user fills most of them in one message
// and is asked almost nothing; a novice is walked through the same slots one
// easy question at a time. Both end up with the same shape of brief.
//
// Pure and dependency-free (types only) on purpose: imported by the server
// routes, the planner, AND Client Components (the live brief panel), so it must
// never pull in lib/ai-client.ts's server-only guard — same rule as
// lib/chat-intake-context.ts and lib/chat-intake-lean.ts.

import type { ChatDecisionState, ChatRichness, DecisionKind } from '@/lib/types'
import { OUTLOOK_KEY } from '@/lib/chat-intake-gates'

export const DECISION_KINDS: readonly DecisionKind[] = [
  'career_exit', 'job_offer', 'relocation', 'money', 'business',
  'relationship', 'education', 'purchase', 'other',
]

export const KIND_LABELS: Record<DecisionKind, string> = {
  career_exit:  'Leaving a job',
  job_offer:    'A job offer',
  relocation:   'Moving',
  money:        'A money decision',
  business:     'A business decision',
  relationship: 'A relationship',
  education:    'Studying',
  purchase:     'A purchase',
  other:        'A decision',
}

export function isDecisionKind(v: unknown): v is DecisionKind {
  return typeof v === 'string' && (DECISION_KINDS as readonly string[]).includes(v)
}

// ── Slots ────────────────────────────────────────────────────────────────────

export interface SlotSpec {
  key:      string
  /** Short noun phrase shown in the live brief ("Money runway"). Plain words, no jargon. */
  label:    string
  /** Plain-language default question, used when the model's own wording is unusable. */
  ask:      string
  /** Tappable answers. Typing is always available; "Not sure" is added by the UI. */
  chips?:   string[]
  /** How much an answer here changes the advice (0–100). Drives question order. */
  weight:   number
  /** Required slots must be known / unknown / n.a. before the chat can wrap. */
  required: boolean
  /** If the person doesn't know, this becomes a "find out" to-do on the brief. */
  findOut?: string
  /** Only slots that can genuinely not apply (e.g. "who moves with you" when they live alone) may be marked not applicable. */
  naOk?: boolean
}

const WHY_NOW: SlotSpec = {
  key: 'why_now', label: 'What set this off',
  ask: 'What happened recently that made this come up?',
  chips: ['Something specific happened', 'It built up over time', 'Someone else is pushing it'],
  weight: 75, required: true,
  findOut: 'Pin down what actually triggered this',
}

const alt = (ask: string, chips: string[]): SlotSpec => ({
  key: 'alternatives', label: 'Other routes', ask, chips,
  weight: 65, required: true,
  findOut: 'List at least one route you haven\u2019t considered yet',
})

const KIND_SLOTS: Record<DecisionKind, SlotSpec[]> = {
  career_exit: [
    { key: 'role', label: 'The job', ask: 'What\u2019s the role, and how long have you been in it?', weight: 80, required: true },
    { key: 'next_step', label: 'What comes next', ask: 'If you left, what would you do next?',
      chips: ['Another job lined up', 'Looking for one', 'Start something of my own', 'Take a break'],
      weight: 80, required: true, findOut: 'Decide what you\u2019d actually do next' },
    { key: 'runway', label: 'Money runway', ask: 'Roughly how many months could you cover expenses without a paycheck?',
      chips: ['Under 3 months', '3\u20136 months', '6\u201312 months', 'Over a year'],
      weight: 70, required: true, findOut: 'Work out your monthly expenses and how many months your savings cover' },
    WHY_NOW,
    alt('Besides quitting outright, would a change inside the job \u2014 new role, team or terms \u2014 be worth trying?',
      ['Ask for a new role', 'Negotiate terms', 'Take a long break']),
    { key: 'people', label: 'Who depends on you', ask: 'Does anyone depend on your income?',
      chips: ['Just me', 'A partner', 'Kids or family'], weight: 40, required: false },
    // v9: only asked when the path is "build something of my own" (see lib/chat-intake-depth.ts, BECOMES_CRITICAL).
    { key: 'validation', label: 'Has the idea been tested', ask: 'Has anyone outside your own head seen or tried the idea yet?',
      chips: ['Not yet', 'A few conversations', 'Early users or customers'], weight: 50, required: false,
      findOut: 'Test the idea with a few real people before committing' },
    { key: 'timeline', label: 'Timing', ask: 'Is there a date this has to be decided by?',
      chips: ['This month', 'In 1\u20133 months', 'No deadline'], weight: 30, required: false },
  ],
  job_offer: [
    { key: 'offer', label: 'The offer', ask: 'What\u2019s the offer \u2014 role and pay \u2014 and how does it compare with where you are now?', weight: 90, required: true },
    { key: 'leaving', label: 'What you\u2019d give up', ask: 'What would you give up by taking it?', weight: 70, required: true },
    { key: 'hesitation', label: 'What\u2019s holding you back', ask: 'What\u2019s making you hesitate?', weight: 60, required: true },
    { key: 'deadline', label: 'Their deadline', ask: 'When do they need an answer?',
      chips: ['Within days', 'In a week or two', 'No deadline'], weight: 55, required: true,
      findOut: 'Ask them how long you have to decide' },
    // v10: no separate "what could you negotiate?" question for a job offer. Countering, asking for time and a later
    // start are routes the Council raises itself; asking up front added a screen without adding what it needs.
  ],
  relocation: [
    { key: 'from_to', label: 'From \u2192 to', ask: 'Which city are you in now, and where would you move?', weight: 90, required: true },
    { key: 'work_plan', label: 'Work there', ask: 'How would work look in the new place?',
      chips: ['Same job, remote', 'New job lined up', 'Not sorted yet'], weight: 70, required: true,
      findOut: 'Work out how you\u2019d earn there' },
    { key: 'who_moves', label: 'Who it affects', ask: 'Would anyone move with you, or be affected by the move?',
      chips: ['Just me', 'A partner', 'Kids or family'], weight: 60, required: true, naOk: true },
    WHY_NOW,
    alt('Is there a middle route \u2014 like trying the city for a few months first?',
      ['Trial it first', 'Visit first', 'Change something else']),
    { key: 'leaving_behind', label: 'What you\u2019d leave behind', ask: 'What would you miss most about where you are now?', weight: 35, required: false },
    { key: 'timeline', label: 'Timing', ask: 'Is there a date this has to happen by?',
      chips: ['Within 3 months', 'This year', 'No deadline'], weight: 30, required: false },
  ],
  money: [
    { key: 'amount', label: 'Amount and purpose', ask: 'Roughly how much money is involved, and what\u2019s it for?', weight: 90, required: true },
    { key: 'downside', label: 'Downside', ask: 'If it went badly, could you absorb the loss?',
      chips: ['Yes, easily', 'It would hurt', 'I couldn\u2019t'], weight: 75, required: true },
    { key: 'horizon', label: 'Time horizon', ask: 'How long could you leave this money alone?',
      chips: ['Under a year', '1\u20135 years', '5+ years'], weight: 60, required: true,
      findOut: 'Decide how long you could leave this money untouched' },
    alt('Is there a smaller or staged way to do this?', ['Start smaller', 'Do it in stages', 'Wait and watch']),
    { ...WHY_NOW, required: false, weight: 45 },
  ],
  business: [
    { key: 'what', label: 'The move', ask: 'What\u2019s the business or move you\u2019re weighing, in a sentence?', weight: 85, required: true },
    { key: 'stage', label: 'Where it stands', ask: 'Where does it stand today?',
      chips: ['Just an idea', 'Early customers', 'Already running'], weight: 65, required: true },
    { key: 'capital', label: 'Money and runway', ask: 'How much money or runway can you put behind it?', weight: 70, required: true,
      findOut: 'Work out how much money and runway you can commit' },
    WHY_NOW,
    alt('Is there a cheaper way to test this first?', ['A small pilot', 'Part-time first', 'Find a partner']),
    { key: 'people', label: 'Who\u2019s involved', ask: 'Is anyone else in this with you?', weight: 40, required: false },
  ],
  relationship: [
    { key: 'who', label: 'Who it\u2019s about', ask: 'Who is this about \u2014 a partner, family member, friend or colleague?',
      chips: ['Partner', 'Family', 'Friend', 'Colleague'], weight: 85, required: true },
    { key: 'tried', label: 'What you\u2019ve tried', ask: 'What have you already tried to sort this out?', weight: 65, required: true },
    WHY_NOW,
    alt('Is there a step between leaving things as they are and a full break?',
      ['A direct conversation', 'Set a boundary', 'Take some space']),
    { key: 'others', label: 'Who else is affected', ask: 'Is anyone else affected \u2014 kids, shared friends, work?', weight: 40, required: false },
  ],
  education: [
    { key: 'program', label: 'The program', ask: 'What would you study, and where?', weight: 85, required: true },
    { key: 'cost', label: 'Cost and funding', ask: 'What would it cost, and how would you pay for it?', weight: 70, required: true,
      findOut: 'Get the full cost and a funding plan' },
    { key: 'outcome', label: 'What it should lead to', ask: 'What do you want it to lead to?', weight: 65, required: true },
    alt('Is there a cheaper or shorter route to the same goal?', ['A short course', 'Part-time', 'Self-study']),
    { ...WHY_NOW, required: false, weight: 45 },
  ],
  purchase: [
    { key: 'item', label: 'What and how much', ask: 'What exactly is it, and what does it cost?', weight: 85, required: true },
    { key: 'budget', label: 'Budget room', ask: 'How does it sit against your budget?',
      chips: ['Comfortably', 'A stretch', 'I can\u2019t really afford it'], weight: 70, required: true },
    alt('Is there a cheaper or later option you\u2019d consider?', ['A cheaper one', 'Wait a while', 'Rent or borrow']),
    { key: 'urgency', label: 'Any deadline', ask: 'Is there a deadline on this?',
      chips: ['Sale ends soon', 'No rush'], weight: 30, required: false },
  ],
  other: [
    { key: 'what', label: 'The decision', ask: 'What exactly are you choosing between? Give me the specifics.', weight: 90, required: true },
    WHY_NOW,
    alt('Is there another route you haven\u2019t considered?', []),
    { key: 'constraints', label: 'What limits you', ask: 'What\u2019s the one thing limiting you most here?',
      chips: ['Money', 'Time', 'Other people', 'Nothing really'], weight: 55, required: true },
  ],
}

/** The probe asked once at the end ("smart friend" check) when nothing sharper turns up. */
export const CHANGE_MIND_SLOT: SlotSpec = {
  key: 'change_mind', label: 'What would change your mind',
  ask: 'What would have to be true for you to go the other way?',
  weight: 40, required: false,
}

export function slotsFor(kind: DecisionKind | null | undefined): SlotSpec[] {
  return KIND_SLOTS[kind && isDecisionKind(kind) ? kind : 'other']
}

export function slotSpec(kind: DecisionKind | null | undefined, key: string): SlotSpec | null {
  if (key === CHANGE_MIND_SLOT.key) return CHANGE_MIND_SLOT
  return slotsFor(kind).find(s => s.key === key) ?? null
}

/** Compact catalogue for the planner prompt: every kind, its slot keys and what each means. */
export function slotCatalogForPrompt(): string {
  return DECISION_KINDS.map(k => {
    const slots = slotsFor(k).map(s => `${s.key}${s.required ? '*' : ''} (${s.label})`).join(', ')
    return `- ${k}: ${slots}`
  }).join('\n')
}

// ── Resolution + status ──────────────────────────────────────────────────────

const clip = (s: string, n: number): string => {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}\u2026` : t
}

export function isKnown(state: ChatDecisionState, key: string): boolean {
  return !!state.facts?.[key]?.trim()
}
export function isUnknown(state: ChatDecisionState, key: string): boolean {
  return !!state.unknownFacts?.includes(key)
}
export function isNotApplicable(state: ChatDecisionState, key: string): boolean {
  return !!state.naSlots?.includes(key)
}
export function isDeferred(state: ChatDecisionState, key: string): boolean {
  return !!state.deferredSlots?.includes(key)
}
export function isResolved(state: ChatDecisionState, key: string): boolean {
  return isKnown(state, key) || isUnknown(state, key) || isNotApplicable(state, key) || isDeferred(state, key)
}

export interface BriefStatus {
  total:    number          // required slots for this kind
  resolved: number          // required slots known / unknown / n.a.
  missing:  SlotSpec[]      // required slots still open, in array order
  ready:    boolean
}

export function briefStatus(state: ChatDecisionState): BriefStatus {
  const required = slotsFor(state.decisionKind).filter(s => s.required)
  const missing  = required.filter(s => !isResolved(state, s.key))
  return { total: required.length, resolved: required.length - missing.length, missing, ready: missing.length === 0 }
}

/**
 * Questions ranked by how much an answer would change the advice. A sparse
 * opener gets a small boost on "what set this off" — the single best question
 * for finding the real decision underneath a vague one — but never enough to
 * beat a high-weight concrete specific (which city, from and to).
 */
export function rankMissing(state: ChatDecisionState): SlotSpec[] {
  const sparse = state.richness === 'sparse'
  return briefStatus(state).missing
    .map((s, i) => ({ s, i, score: s.weight + (sparse && s.key === 'why_now' ? 15 : 0) }))
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map(x => x.s)
}

// ── State edits (pure — return a new state) ──────────────────────────────────

const without = (list: string[] | undefined, key: string): string[] => (list ?? []).filter(k => k !== key)

export function setFact(state: ChatDecisionState, key: string, value: string): ChatDecisionState {
  const v = clip(value, 160)
  if (!v) return state
  const spec = slotSpec(state.decisionKind, key)
  return {
    ...state,
    facts:        { ...(state.facts ?? {}), [key]: v },
    unknownFacts: without(state.unknownFacts, key),
    naSlots:      without(state.naSlots, key),
    todos:        spec?.findOut ? (state.todos ?? []).filter(t => t !== spec.findOut) : state.todos,
  }
}

/** "I don't know" is data: remember it, never re-ask it, and turn it into a to-do. */
export function markUnknown(state: ChatDecisionState, key: string): ChatDecisionState {
  if (isKnown(state, key)) return state
  const spec  = slotSpec(state.decisionKind, key)
  const todos = [...(state.todos ?? [])]
  if (spec?.findOut && !todos.includes(spec.findOut)) todos.push(spec.findOut)
  return {
    ...state,
    unknownFacts: isUnknown(state, key) ? state.unknownFacts : [...(state.unknownFacts ?? []), key],
    todos,
  }
}

export function markNotApplicable(state: ChatDecisionState, key: string): ChatDecisionState {
  if (isKnown(state, key)) return state
  return { ...state, naSlots: isNotApplicable(state, key) ? state.naSlots : [...(state.naSlots ?? []), key] }
}

/** Anything still open when the chat wraps is flagged unknown, so the brief is never silently incomplete. */
export function finalizeBrief(state: ChatDecisionState): ChatDecisionState {
  return briefStatus(state).missing.reduce((s, slot) => markUnknown(s, slot.key), state)
}

// ── Rows for the live brief panel and for the context handed to the session ──

export interface BriefRow {
  key:      string
  label:    string
  value:    string | null
  status:   'known' | 'unknown' | 'open'
  required: boolean
}

export function briefRows(state: ChatDecisionState): BriefRow[] {
  const rows: BriefRow[] = []
  for (const s of slotsFor(state.decisionKind)) {
    if (isNotApplicable(state, s.key) || isDeferred(state, s.key)) continue   // deferred = not asked; listed separately, never shown as "unknown"
    const known = isKnown(state, s.key)
    if (!s.required && !known) continue            // optional slots only show once they have content
    rows.push({
      key: s.key, label: s.label, required: s.required,
      value:  known ? state.facts![s.key].trim() : null,
      status: known ? 'known' : isUnknown(state, s.key) ? 'unknown' : 'open',
    })
  }
  if (isKnown(state, CHANGE_MIND_SLOT.key)) {
    rows.push({ key: CHANGE_MIND_SLOT.key, label: CHANGE_MIND_SLOT.label, required: false, value: state.facts![CHANGE_MIND_SLOT.key].trim(), status: 'known' })
  }
  // The combined E0 + C0 probe (lib/chat-intake-gates.ts): what good looks like, and what still worries them.
  if (isKnown(state, OUTLOOK_KEY)) {
    rows.push({ key: OUTLOOK_KEY, label: 'What good looks like, and what worries you', required: false, value: state.facts![OUTLOOK_KEY].trim(), status: 'known' })
  }
  return rows
}

/** Plain-text brief appended to the session's context_text (see assembleSessionInput). */
export function briefContextLines(state: ChatDecisionState): string[] {
  const out: string[] = []
  if (state.decisionKind) out.push(`Kind of decision: ${KIND_LABELS[state.decisionKind]}`)
  const rows = briefRows(state)
  const known = rows.filter(r => r.status === 'known')
  if (known.length) out.push(`Key facts:\n${known.map(r => `- ${r.label}: ${r.value}`).join('\n')}`)
  const unknown = rows.filter(r => r.status === 'unknown')
  if (unknown.length) out.push(`Not known yet: ${unknown.map(r => r.label).join('; ')}`)
  if (state.todos?.length) out.push(`To find out: ${state.todos.join('; ')}`)
  return out
}

// ── How much did the first message already tell us? ──────────────────────────
// Cheap and deterministic: decides how hard to lean on questions. A rich opener
// goes straight to a playback; a sparse one gets guided, one easy step at a time.

export function scoreRichness(text: string): { score: number; tier: ChatRichness } {
  const t = (text ?? '').trim()
  if (!t) return { score: 0, tier: 'sparse' }
  const words = t.split(/\s+/).filter(Boolean).length

  let score = 0
  score += words >= 60 ? 40 : words >= 35 ? 30 : words >= 20 ? 18 : words >= 12 ? 8 : 0

  const numbers = (t.match(/\d[\d,.]*\s?(k|m|lakh|lakhs|crore|cr|%)?|[$\u20AC\u00A3\u20B9]/gi) ?? []).length
  score += Math.min(20, numbers * 7)

  if (/\b(or|vs\.?|versus|instead of|alternatively|either)\b/i.test(t)) score += 8
  const reasons = t.match(/\b(because|since|savings|salary|deadline|runway|family|kids|partner|visa|rent|loan|mortgage|notice|offer|manager|burnout|equity|budget|contract|lease|expenses|months?|years?)\b/gi) ?? []
  score += Math.min(20, new Set(reasons.map(r => r.toLowerCase())).size * 5)

  // Capitalised words that aren't sentence starters ≈ named places, companies, people.
  // (No regex lookbehind: this module ships in the client bundle, and older Safari
  // fails to parse the whole bundle on one.)
  let names = 0
  for (const sentence of t.split(/[.!?]+\s+|\n+/)) {
    names += sentence.trim().split(/\s+/).slice(1).filter(w => /^[A-Z][a-z]{2,}/.test(w)).length
  }
  score += Math.min(10, names * 3)

  score = Math.min(100, score)
  return { score, tier: score >= 65 ? 'rich' : score >= 35 ? 'medium' : 'sparse' }
}

// ── Reading short replies ────────────────────────────────────────────────────

const wordCount = (t: string): number => t.trim().split(/\s+/).filter(Boolean).length

export const UNKNOWN_CHIP_LABEL = 'Not sure'
export const ENOUGH_LABEL       = 'That\u2019s enough \u2014 show me'
export const WALKTHROUGH_LABEL  = 'Not sure what to say? Walk me through it'
export const WALKTHROUGH_LINE   = 'Okay \u2014 one easy step at a time. First: what\u2019s the decision, in a sentence? A rough version is fine.'
export const UNKNOWN_REPLY_TEXT = 'Not sure yet'
export const PLAYBACK_YES       = 'Yes, that\u2019s right'
export const PLAYBACK_NO        = 'Not quite'

/** "I don't know" / "no idea" — only for SHORT replies, so "I don't know whether to leave because..." is still an answer. */
export function isDontKnow(text: string): boolean {
  const t = (text ?? '').trim().toLowerCase().replace(/[.!?]+$/, '')
  if (!t || wordCount(t) > 6) return false
  return /^(i\s*(do\s*n[o\u2019']?t|dunno|have no idea|am not sure|\u2019m not sure|'m not sure)|dunno|idk|not sure|no idea|unsure|can'?t say|haven'?t (thought|figured|decided)( about it)?( yet)?|not decided|n\/?a)\b/.test(t)
    || /^(i )?(don'?t|do not) know\b/.test(t)
}

export function isAffirmative(text: string): boolean {
  const t = (text ?? '').trim().toLowerCase().replace(/[.!]+$/, '')
  if (!t || wordCount(t) > 6) return false
  // "Yes, but my partner isn't coming" is a correction, not a confirmation.
  if (/\b(but|except|although|however|though)\b/.test(t)) return false
  return /^(yes|yeah|yep|yup|correct|right|exactly|spot on|sounds right|looks right|that'?s (right|it|correct|about right)|that\u2019s (right|it|correct|about right))\b/.test(t)
}

export function isNegative(text: string): boolean {
  const t = (text ?? '').trim().toLowerCase().replace(/[.!]+$/, '')
  if (!t || wordCount(t) > 6) return false
  return /^(no|nope|nah|not quite|not really|not exactly|that'?s not|that\u2019s not|wrong|incorrect)\b/.test(t)
}

// ── Model-output hygiene ─────────────────────────────────────────────────────

/** Valid tap-answers only: short, deduped, never a "not sure" (the UI adds that itself). */
export function sanitizeChips(raw: unknown, fallback: string[] = []): string[] {
  const clean = (arr: unknown): string[] => {
    if (!Array.isArray(arr)) return []
    const out: string[] = []
    for (const c of arr) {
      if (typeof c !== 'string') continue
      const t = c.replace(/\s+/g, ' ').trim()
      if (!t || t.length > 34) continue
      if (/^(not sure|don'?t know|i don'?t know|unsure|idk)\b/i.test(t)) continue
      if (out.some(o => o.toLowerCase() === t.toLowerCase())) continue
      out.push(t)
      if (out.length >= 5) break
    }
    return out
  }
  const primary = clean(raw)
  return primary.length >= 2 ? primary : clean(fallback)
}

/** Deterministic "here's what I heard" for when the model's own playback is unusable. */
export function buildPlaybackFallback(state: ChatDecisionState): string {
  const lead = state.decisionStatement?.trim().replace(/[.\s]+$/, '')
  const facts = briefRows(state)
    .filter(r => r.status === 'known' && r.key !== CHANGE_MIND_SLOT.key && r.key !== OUTLOOK_KEY)
    .slice(0, 5)
    .map(r => `${r.label}: ${clip(r.value ?? '', 70).replace(/[.\s]+$/, '')}`)
  const head = lead ? `Here\u2019s what I\u2019ve got: ${lead}.` : 'Here\u2019s what I\u2019ve got so far.'
  return `${head}${facts.length ? ` ${facts.join('. ')}.` : ''} Did I get that right?`
}

export { clip as clipText }

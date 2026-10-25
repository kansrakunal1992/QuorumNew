// lib/chat-intake-depth.ts
// ── Natural Intake (v9) — how deep to go, and when it is enough (pure) ───────
//
// v8 asked every required slot of a decision type, whatever the stakes. v9 asks
// what the Council NEEDS before it can start, and only that:
//
//   • Stakes (the model's read, raised by reversibility) set a SAFETY ceiling —
//     5 / 7 / 9 exchanges. A ceiling is a stop, never a quota.
//   • A required slot may be DEFERRED (not asked; handed to the Council as "not
//     asked") only when it is not material — low stakes and a low-weight slot,
//     or a slot the path makes irrelevant (money runway when a job is already
//     lined up).
//   • An optional slot becomes CRITICAL when the person's own path makes it
//     material — product validation when they would build something of their
//     own, who depends on them when income is at risk — unless they already said.
//   • Nothing is deferred on the strength of its category alone: runway, affected
//     people and validation are asked whenever they change feasibility or framing.
//
// Client-safe (imported by the summary screen): no server imports.

import type { ChatDecisionState, DecisionKind } from '@/lib/types'
import { isKnown, isResolved, slotsFor } from '@/lib/chat-intake-brief'
import type { SlotSpec } from '@/lib/chat-intake-brief'

/** Written onto every new chat and every intake analytics event, so cohorts can be compared across redesigns. */
export const INTAKE_FLOW_VERSION = 'v9_progressive_cards'

export type Stakes = 'low' | 'medium' | 'high'

const CEILING_BY_STAKES: Record<Stakes, number> = { low: 5, medium: 7, high: 9 }
/** Required slots at or above this weight are never deferred on stakes alone. */
const LOW_STAKES_KEEP_WEIGHT = 70

export function effectiveStakes(s: ChatDecisionState): Stakes {
  let st: Stakes = s.stakes ?? 'medium'
  if (s.reversibility === 'irreversible') st = 'high'
  else if (s.reversibility === 'somewhat_reversible' && st === 'low') st = 'medium'
  return st
}

/** Safety limit on exchanges for this decision. Never a target. */
export function ceilingFor(s: ChatDecisionState, base: number): number {
  return Math.min(base, CEILING_BY_STAKES[effectiveStakes(s)])
}

// ── Evidence the person has already given ────────────────────────────────────

const lower = (x: unknown): string => String(x ?? '').toLowerCase()

/** Everything the person has said or chosen so far, as one lowercase string (their words, their taps, Quorum's refined statement). */
function evidenceText(s: ChatDecisionState): string {
  const facts = Object.values(s.facts ?? {}).join(' | ')
  const taps  = Object.values(s.cardAnswers ?? {}).flatMap(a => a.selectedLabels).join(' | ')
  return lower([s.decisionStatement, (s.options ?? []).join(' | '), facts, taps, (s.evidence ?? []).join(' | ')].filter(Boolean).join(' | '))
}

/** The route the person said they would actually take (their answer, not the options on the table). Empty until they have said. */
function chosenPath(s: ChatDecisionState): string {
  const parts: string[] = [s.facts?.next_step ?? '', s.facts?.work_plan ?? '', s.facts?.stage ?? '']
  for (const k of ['next_step', 'work_plan', 'stage']) parts.push(...(s.cardAnswers?.[k]?.selectedLabels ?? []))
  return lower(parts.join(' | ')).replace(/[\s|]+/g, ' ').trim()
}
/** How the decision was framed (Quorum's statement + routes). Only used when the person has not yet said what they would do. */
function framing(s: ChatDecisionState): string {
  return lower([s.decisionStatement ?? '', (s.options ?? []).join(' | ')].join(' | '))
}

const VENTURE       = /\b(something of my own|my own (thing|business|product|company)|own thing|start(ing)? (a|my|something|up)|build(ing)? (a|my|the|something|it)|launch|startup|start-up|business|product|company|venture|idea|freelanc|consult)/
const INCOME_AT_RISK = /\b(quit|resign|leave (my|the|without)|without a (paycheck|job|salary)|full[- ]?time|break|sabbatical|something of my own|my own|own thing|build|start|launch|freelanc|consult|business|product|startup)/
const JOB_SECURED   = /\b(job lined up|another job lined up|new job lined up|have an offer|accepted an offer|already have (a|another) job)/
const STILL_EMPLOYED = /\b(look for another job|job search|search for (a|another)|stay (in|at|where)|negotiate|new role or team|same job|remain)/
const PEOPLE_MENTION = /\b(partner|wife|husband|spouse|girlfriend|boyfriend|kid|kids|child|children|son|daughter|baby|parent|parents|mother|father|famil(y|ies)|dependant|dependent|depends on)\b/
const TEAM_MENTION   = /\b(co-?founder|partner|team|investor|investors|employees|staff)\b/
const VALIDATION_MENTION = /\b(customer|customers|users?|paying|pilot|tested|validated|waitlist|interviews?|spoken to|talked to|prototype|sold)\b/

// Income is at risk if the route they CHOSE puts it at risk; before they have chosen, judge from how the decision was framed.
export const incomeAtRisk  = (s: ChatDecisionState): boolean => { const c = chosenPath(s); return INCOME_AT_RISK.test(c || framing(s)) }
export const jobSecured    = (s: ChatDecisionState): boolean => JOB_SECURED.test(chosenPath(s))
export const ventureInPlay = (s: ChatDecisionState): boolean => VENTURE.test(chosenPath(s)) || VENTURE.test(framing(s))
const peopleMentioned      = (s: ChatDecisionState): boolean => PEOPLE_MENTION.test(evidenceText(s)) || !!s.stakeholders?.length

// ── Which slots are critical right now ───────────────────────────────────────

export type SlotRole = 'critical' | 'deferrable' | 'optional' | 'resolved'

/** Optional slots that become critical when the person's own path makes them material. */
function becomesCritical(s: ChatDecisionState, kind: DecisionKind | null | undefined, key: string): boolean {
  const st = effectiveStakes(s)
  if (kind === 'career_exit') {
    if (key === 'validation') return st !== 'low' && ventureInPlay(s) && !VALIDATION_MENTION.test(evidenceText(s))
    if (key === 'people')     return st !== 'low' && incomeAtRisk(s) && !peopleMentioned(s)
  }
  if (kind === 'business' && key === 'people')      return st === 'high' && !TEAM_MENTION.test(evidenceText(s))
  if (kind === 'relationship' && key === 'others')  return st === 'high' && !peopleMentioned(s)
  return false
}

/** Required slots that may be left to the Council because they are not material to THIS decision. */
function deferrable(s: ChatDecisionState, kind: DecisionKind | null | undefined, slot: SlotSpec): boolean {
  const st = effectiveStakes(s)
  // Path-based: runway only matters when income is actually at risk.
  if (kind === 'career_exit' && slot.key === 'runway') {
    if (incomeAtRisk(s)) return false
    return jobSecured(s) || STILL_EMPLOYED.test(chosenPath(s)) || st === 'low'
  }
  // Stakes-based: a low-stakes decision does not need its lower-weight required slots before the Council starts.
  return st === 'low' && slot.weight < LOW_STAKES_KEEP_WEIGHT
}

export function slotRole(s: ChatDecisionState, slot: SlotSpec): SlotRole {
  const kind = s.decisionKind
  if (isResolved(s, slot.key)) return 'resolved'
  if (slot.required) return deferrable(s, kind, slot) ? 'deferrable' : 'critical'
  return becomesCritical(s, kind, slot.key) ? 'critical' : 'optional'
}

const rank = (s: ChatDecisionState, a: SlotSpec[]): SlotSpec[] => {
  const sparse = s.richness === 'sparse'
  return a.map((x, i) => ({ x, i, score: x.weight + (sparse && x.key === 'why_now' ? 15 : 0) }))
    .sort((p, q) => q.score - p.score || p.i - q.i).map(v => v.x)
}

/** Unresolved CRITICAL slots, most decision-changing first. Empty = nothing essential is missing. */
export function criticalOpen(s: ChatDecisionState): SlotSpec[] {
  return rank(s, slotsFor(s.decisionKind).filter(sl => slotRole(s, sl) === 'critical'))
}
export function deferrableOpen(s: ChatDecisionState): SlotSpec[] {
  return slotsFor(s.decisionKind).filter(sl => slotRole(s, sl) === 'deferrable')
}

/**
 * Called when the chat wraps. Essential gaps become "unknown" with a find-out to-do (as before) and are
 * remembered as GAPS; non-material slots are recorded as "not asked" — never presented as the person not knowing.
 */
export function finalizeForCouncil(s: ChatDecisionState, markUnknown: (st: ChatDecisionState, key: string) => ChatDecisionState, closedBy: 'ready' | 'ceiling' | 'user'): ChatDecisionState {
  let out: ChatDecisionState = { ...s }
  const gaps = criticalOpen(out).map(x => x.key)
  const defer = deferrableOpen(out).map(x => x.key)
  for (const k of gaps) out = markUnknown(out, k)
  out.gapSlots      = [...new Set([...(out.gapSlots ?? []), ...gaps])]
  out.deferredSlots = [...new Set([...(out.deferredSlots ?? []), ...defer])]
  out.closedBy      = closedBy
  return out
}

// ── Council sufficiency ──────────────────────────────────────────────────────

export type CouncilReadiness = 'ready' | 'ready_with_unknowns' | 'closed_with_gaps' | 'needs_more'

export interface ReadinessResult {
  state:        CouncilReadiness
  criticalOpen: string[]
  gaps:         string[]     // critical slots the chat had to stop without
  deferred:     string[]     // not asked: not material
  unknown:      string[]     // asked, person did not know / skipped / declined
  stakes:       Stakes
}

export function councilReadiness(s: ChatDecisionState): ReadinessResult {
  const open     = criticalOpen(s).map(x => x.key)
  const gaps     = (s.gapSlots ?? []).filter(k => !isKnown(s, k))
  const deferred = [...new Set([...(s.deferredSlots ?? []), ...deferrableOpen(s).map(x => x.key)])]
  const unknown  = slotsFor(s.decisionKind).filter(x => (s.unknownFacts ?? []).includes(x.key) && !gaps.includes(x.key)).map(x => x.key)
  const state: CouncilReadiness =
    open.length ? (s.phase === 'done' ? 'closed_with_gaps' : 'needs_more')
    : gaps.length ? 'closed_with_gaps'
    : unknown.length || deferred.length ? 'ready_with_unknowns'
    : 'ready'
  return { state, criticalOpen: open, gaps, deferred, unknown, stakes: effectiveStakes(s) }
}

/** What Quorum says when the chat wraps. Honest about gaps; never claims more than is known. */
export function readinessLine(r: ReadinessResult): string {
  if (r.state === 'ready') {
    return 'Your decision now has enough context for the Council. Take a last look at how I\u2019ve put it below \u2014 correct anything that\u2019s off.'
  }
  if (r.state === 'ready_with_unknowns') {
    return 'Your decision has enough context for the Council to start. A few things are still open, and I\u2019ll tell it so rather than guess. Take a last look below.'
  }
  return 'I\u2019ll stop asking here. Some important details are still open \u2014 I\u2019ll flag them to the Council rather than guess. Check how I\u2019ve put it below and fix anything that\u2019s off.'
}

// ── Smart-friend gate (the one extra question) ───────────────────────────────

/** The only gaps the extra question may be about. Anything else is not worth a turn. */
export const SMART_FRIEND_GAPS = ['tension', 'validation', 'feasibility', 'who_affected', 'reversibility', 'timing'] as const
export type SmartFriendGap = typeof SMART_FRIEND_GAPS[number]
export const isSmartFriendGap = (x: unknown): x is SmartFriendGap => typeof x === 'string' && (SMART_FRIEND_GAPS as readonly string[]).includes(x)

/** Is the named gap genuinely unresolved given everything already on file? */
export function gapIsOpen(s: ChatDecisionState, gap: SmartFriendGap): boolean {
  const ev = evidenceText(s)
  const has = (...keys: string[]) => keys.some(k => isKnown(s, k) || !!s.cardAnswers?.[k]?.selectedIds.length)
  switch (gap) {
    case 'tension':      return !!s.contradictions?.length
    case 'validation':   return ventureInPlay(s) && !has('validation', 'stage') && !VALIDATION_MENTION.test(ev)
    case 'feasibility': {
      const keys = ['runway', 'capital', 'cost', 'budget', 'amount']
      // A money slot the path made non-material (e.g. runway when a job is lined up) is not an open gap.
      const notMaterial = slotsFor(s.decisionKind).some(x => keys.includes(x.key) && (s.deferredSlots?.includes(x.key) || slotRole(s, x) === 'deferrable'))
      return !notMaterial && !has(...keys)
    }
    case 'who_affected': return !has('people', 'who_moves', 'others') && !peopleMentioned(s)
    case 'reversibility':return !s.reversibility
    case 'timing':       return !has('timeline', 'deadline') && !s.deadline
  }
}

const STOP = new Set('the a an and or of to in on for with is are was were be been it this that these those you your yours i my me we our they their them what when where which who whom how why would could should can will do does did have has had about into from than then there here just also very really any some more most such not no yes'.split(' '))
const words = (t: string): string[] => lower(t).replace(/[\u2019']/g, '').split(/[^a-z0-9]+/).filter(w => w.length >= 4 && !STOP.has(w))

/** Would this question ask for something already on file or already asked? (token overlap, deliberately conservative) */
export function duplicatesKnown(question: string, s: ChatDecisionState, asked: string[] = []): boolean {
  const q = new Set(words(question))
  if (q.size < 3) return false
  const corpus = [
    ...asked,
    ...Object.values(s.facts ?? {}),
    ...Object.values(s.cardAnswers ?? {}).map(a => a.selectedLabels.join(' ')),
    s.decisionStatement ?? '',
  ]
  return corpus.some(c => {
    const cw = new Set(words(c))
    let hit = 0
    q.forEach(w => { if (cw.has(w)) hit += 1 })
    return hit / q.size >= 0.6
  })
}

// ── What the summary screen shows, with provenance ───────────────────────────

export interface SummaryProvenance {
  youTold:  Array<{ label: string; value: string }>                    // the person's own words (typed)
  youChose: Array<{ label: string; values: string[]; addedWords: boolean }>   // tapped on cards
  myReading: string[]                                                  // Quorum's inference — provisional
  notKnown: Array<{ label: string; why: 'unknown' | 'skipped' | 'not_asked' | 'gap' }>
}

export function summaryProvenance(s: ChatDecisionState): SummaryProvenance {
  const out: SummaryProvenance = { youTold: [], youChose: [], myReading: [], notKnown: [] }
  const label = (k: string) => slotsFor(s.decisionKind).find(x => x.key === k)?.label ?? k
  for (const sl of slotsFor(s.decisionKind)) {
    const ca = s.cardAnswers?.[sl.key]
    const known = isKnown(s, sl.key)
    if (ca?.responseType === 'cards' && ca.selectedLabels.length) {
      out.youChose.push({ label: sl.label, values: ca.selectedLabels, addedWords: ca.usedFreeText })
      continue
    }
    if (known) out.youTold.push({ label: sl.label, value: s.facts![sl.key].trim() })
  }
  if (s.userCorrections?.length) out.youTold.push({ label: 'You corrected', value: s.userCorrections[s.userCorrections.length - 1] })
  if (s.decisionStatement && !s.userEditedDecision) out.myReading.push(`The decision, as I\u2019ve framed it: ${s.decisionStatement}`)
  if (s.options?.length) out.myReading.push(`Routes I think you\u2019re weighing: ${s.options.slice(0, 4).join('; ')}`)
  if (s.contradictions?.length) out.myReading.push(`A possible tension: ${s.contradictions[0]}`)
  if (s.unknowns?.length) out.myReading.push(`The main unknown, as I read it: ${s.unknowns[0]}`)
  const r = councilReadiness(s)
  const seen = new Set<string>()
  const add = (k: string, why: SummaryProvenance['notKnown'][number]['why']) => { if (!seen.has(k)) { seen.add(k); out.notKnown.push({ label: label(k), why }) } }
  r.gaps.forEach(k => add(k, 'gap'))
  ;(s.skippedSlots ?? []).forEach(k => add(k, 'skipped'))
  r.unknown.forEach(k => add(k, 'unknown'))
  r.deferred.forEach(k => add(k, 'not_asked'))
  return out
}

// lib/chat-intake-turn.ts
// ── Natural Intake (v7) — what happens on each turn (pure) ───────────────────
//
// The model proposes (lib/chat-intake-planner.ts); this module decides. It has
// no network and no model calls, so every behaviour below is unit-tested
// (tests/chat-intake-turn.test.ts) and replayed against scripted personas
// (tests/chat-intake-personas.test.ts).
//
// The loop, in plain terms:
//   1. Read the reply. A tapped chip, "I don't know", "yes that's right" and
//      "that's enough" are understood directly — no model needed.
//   2. Fold the model's notes into the brief. If the person clearly answered the
//      question that was pending but the model didn't capture it, keep their
//      words anyway — a slot is never re-asked because extraction missed.
//   3. Decide: ask the single most useful open slot / ask the one "smart friend"
//      question / play back what we understood / wrap.
//
// Invariants (tested): a slot is asked at most twice; anything still open when
// the chat wraps is flagged unknown rather than silently dropped; the chat
// never runs past its ceiling; v8 wraps straight to the summary screen (no in-chat playback).

import type {
  ChatCardGroup, ChatCardResponseMeta, ChatDecisionState, ChatPendingTurn, ChatQuickReplies,
} from '@/lib/types'
import {
  CHANGE_MIND_SLOT,
  clipText, isAffirmative,
  isDecisionKind, isDontKnow, isKnown, isNegative, isNotApplicable, isResolved,
  markNotApplicable, markUnknown, sanitizeChips, scoreRichness,
  setFact, slotSpec, slotsFor,
} from './chat-intake-brief'
import {
  DEPENDENCY_CHIPS, OUTLOOK_ASK, OUTLOOK_KEY, applyOutlookAnswer, dependencyQuestion, detectUpstreamDecision,
  outlookCovered, parkedReply, parseDependencyChoice,
} from './chat-intake-gates'
import { allSelectedNote, buildCardGroup, recordCardAnswer, sanitizeCardMeta } from './chat-intake-cards'
import { criticalOpen, duplicatesKnown, effectiveStakes, finalizeForCouncil, gapIsOpen, isSmartFriendGap } from './chat-intake-depth'
import type { SmartFriendGap } from './chat-intake-depth'
import { composeReply, reflectionPrint, validateReflection } from './chat-intake-reflection'
import { NON_ANSWER } from './chat-intake-plan-parse'
import type { PlannerOutput } from './chat-intake-plan-parse'

// ── Public shapes ────────────────────────────────────────────────────────────

// v8: 'cards' = a card group answer; 'declined' = "Prefer not to say" / "Skip for now" (resolved, no to-do made).
export type QuickReplyKind = 'chip' | 'cards' | 'unknown' | 'declined' | 'playback_yes' | 'playback_no' | 'enough'
export interface QuickReplyMeta {
  kind: QuickReplyKind; slotKey?: string | null; card?: ChatCardResponseMeta | null
  /** v9: the answer to the second card group shown in the same step. `text` is exactly what was appended to the chat message. */
  companion?: { text: string; card?: ChatCardResponseMeta | null } | null
}

export type TurnAction = 'ask' | 'smart_friend' | 'playback' | 'correct' | 'close' | 'faq' | 'park'

export interface TurnResult {
  state:          ChatDecisionState
  action:         TurnAction
  reply:          string
  quickReplies:   ChatQuickReplies
  readyToReflect: boolean
  /** v9: whether a grounded reflection went out above the question, and if not, why not (for analytics — never the text). */
  reflection?:    { shown: boolean; reason: string | null }
}

export const MAX_ASKS_PER_SLOT = 2
const NO_CHIPS: ChatQuickReplies = { kind: 'none', chips: [] }

// ── Small helpers ────────────────────────────────────────────────────────────

function quickFromPending(p: ChatPendingTurn | null | undefined): ChatQuickReplies {
  if (!p) return NO_CHIPS
  if (p.kind === 'playback') return { kind: 'playback', chips: p.chips }
  if (p.kind === 'ask' || p.kind === 'smart_friend') return { kind: 'ask', slotKey: p.slotKey ?? null, chips: p.chips, card: p.card ?? null, companion: p.companion ?? null }
  return NO_CHIPS
}

const JARGON = /\b(examiner|council|ontology|checkpoint|slot|slots|brief|structural read|rule engine)\b/i

/** A model-written question is only used if it reads like one a person would be asked. */
export function usableQuestion(q: string | null | undefined): q is string {
  if (!q) return false
  const t = q.trim()
  const words = t.split(/\s+/).length
  return t.length >= 8 && t.length <= 280 && words <= 48 && !JARGON.test(t)
}

const union = (a: string[] | undefined, b: string[] | undefined, max = 12): string[] | undefined => {
  const out = [...(a ?? [])]
  for (const x of b ?? []) if (!out.some(y => y.toLowerCase() === x.toLowerCase())) out.push(x)
  return out.length ? out.slice(0, max) : undefined
}

// ── Folding the model's notes into the state ─────────────────────────────────

// Evidence that the PERSON said they don't know / haven't decided something.
// "Unasked" is not "unknown": a model that marks every slot it hasn't heard about
// as unknown makes the brief look complete after one question, and the chat wraps
// abruptly with the real specifics never asked (seen live, Oct 2026: a job-offer
// chat ended after one question with four required slots "Not sure yet").
const DECLARED_UNKNOWN = /\b(don'?t know|do not know|dunno|idk|not sure|unsure|no idea|can'?t say|not decided|undecided|haven'?t (thought|decided|figured|worked|sorted)|yet to (decide|figure|work)|still (figuring|deciding|working))\b/i
const MAX_MODEL_UNKNOWNS_PER_TURN = 2
const MAX_MODEL_NA_PER_TURN       = 1

export function mergeNotes(
  prior: ChatDecisionState,
  notes: PlannerOutput['notes'],
  opts:  { userText?: string } = {},
): ChatDecisionState {
  let s: ChatDecisionState = { ...prior }

  if (notes.decisionStatement) s.decisionStatement = notes.decisionStatement
  if (isDecisionKind(notes.decisionKind)) s.decisionKind = notes.decisionKind
  if (notes.deadline)          s.deadline          = notes.deadline
  if (notes.decisionThreshold) s.decisionThreshold = notes.decisionThreshold
  if (notes.reversibility)     s.reversibility     = notes.reversibility
  if (notes.stakes)            s.stakes            = notes.stakes
  // v9.1: the person changed their mind about something they TAPPED. Both signals are required (the model names the slot AND
  // writes a new value for it) so a restated fact can't hide a real selection. The tap is flagged, never deleted.
  for (const k of notes.correctedSlots ?? []) {
    const ca = s.cardAnswers?.[k]
    if (ca && !ca.superseded && typeof notes.facts?.[k] === 'string' && notes.facts[k].trim()) {
      s.cardAnswers = { ...(s.cardAnswers ?? {}), [k]: { ...ca, superseded: true } }
    }
  }
  if (notes.leaningOptionType) s.leaningOptionType = notes.leaningOptionType
  if (notes.gutFeeling)        s.gutFeeling        = notes.gutFeeling
  if (notes.successPicture)    s.successPicture    = notes.successPicture
  // The very first gut reaction is never overwritten (missing piece #1).
  if (notes.initialReaction && !s.initialReaction) s.initialReaction = notes.initialReaction

  if (notes.options?.length) s.options = notes.options
  s.assumptions     = union(s.assumptions, notes.assumptions)
  s.unknowns        = union(s.unknowns, notes.unknowns)
  s.evidence        = union(s.evidence, notes.evidence, 16)
  s.userCorrections = union(s.userCorrections, notes.userCorrections)
  // v8: tensions the model noticed. Quorum's reading — carried to the Council as unconfirmed, never as fact.
  s.contradictions  = union(s.contradictions, notes.contradictions, 4)
  if (notes.stakeholders?.length) {
    const have = new Set((s.stakeholders ?? []).map(x => x.name.toLowerCase()))
    s.stakeholders = [...(s.stakeholders ?? []), ...notes.stakeholders.filter(x => !have.has(x.name.toLowerCase()))].slice(0, 8)
  }

  // Brief facts — only keys that are real slots for this kind of decision, and only real answers.
  const valid = (key: string) => key === CHANGE_MIND_SLOT.key || !!slotsFor(s.decisionKind).some(x => x.key === key)
  for (const [k, v] of Object.entries(notes.facts ?? {})) {
    // A slot the person chose to skip / not share stays that way, even if the model "extracts" something from the reply.
    if (valid(k) && !NON_ANSWER.test(v) && !(s.skippedSlots ?? []).includes(k)) s = setFact(s, k, v)
  }

  // Unknown: accepted only if the person's own message says they don't know. The pending
  // slot's "I don't know" is already handled deterministically in preprocessTurn.
  const said = DECLARED_UNKNOWN.test((opts.userText ?? '').replace(/\u2019/g, "'"))
  let unknownTaken = 0, dropped = 0
  for (const k of notes.unknownFacts ?? []) {
    if (!valid(k) || isKnown(s, k)) continue
    if (said && unknownTaken < MAX_MODEL_UNKNOWNS_PER_TURN) { s = markUnknown(s, k); unknownTaken += 1 }
    else dropped += 1
  }

  // Not applicable: only slots that can genuinely not apply (spec.naOk), at most one per turn.
  // Never "their deadline" or "what's holding you back" — those apply to everyone.
  let naTaken = 0
  for (const k of notes.naSlots ?? []) {
    if (!valid(k) || isKnown(s, k)) continue
    const spec = slotSpec(s.decisionKind, k)
    if (spec?.naOk && naTaken < MAX_MODEL_NA_PER_TURN) {
      s = markNotApplicable(s, k); naTaken += 1
    } else dropped += 1
  }

  if (dropped > 0) console.warn(`[ChatIntake] ignored ${dropped} model-proposed unknown / n.a. slot(s) the person never said (kept them open)`)
  return s
}

// ── Step 1: read the reply ───────────────────────────────────────────────────

export interface PreResult {
  state:     ChatDecisionState
  dontKnow:  boolean
  /** v8: one line for the planner when the card answer needs special reading (e.g. every option ticked). */
  cardNote?: string | null
  /** v9: the message with the companion answer removed — what the generic "never lose an answer" capture should store for the primary slot. */
  primaryText?: string
  /** Set when the reply needs no model at all (playback yes/no, "that's enough"). */
  shortCircuit?: TurnResult
}

/**
 * Wraps the chat. Critical gaps become "unknown" (with a find-out to-do) and are remembered as gaps; slots that
 * were not material are recorded as "not asked". The route swaps `reply` for the readiness copy that matches.
 */
export function closeTurn(state: ChatDecisionState, closingLine: string, closedBy?: 'ready' | 'ceiling' | 'user'): TurnResult {
  const by = closedBy ?? (criticalOpen(state).length ? 'ceiling' : 'ready')
  const s: ChatDecisionState = { ...finalizeForCouncil(state, markUnknown, by), phase: 'done', pending: null }
  return { state: s, action: 'close', reply: closingLine, quickReplies: NO_CHIPS, readyToReflect: true }
}

export function preprocessTurn(
  prior:    ChatDecisionState,
  userText: string,
  quick:    QuickReplyMeta | null | undefined,
  ctx:      { firstMessage: boolean; walkthrough?: boolean; closingLine: string; exchange?: number },
): PreResult {
  let s: ChatDecisionState = { ...prior }

  if (ctx.firstMessage) {
    s.walkthrough = !!ctx.walkthrough
    s.richness    = ctx.walkthrough ? 'sparse' : scoreRichness(userText).tier
    s.phase       = 'gathering'
  } else if (ctx.walkthrough && !s.walkthrough) {
    s.walkthrough = true
  }

  const pending = s.pending ?? null

  if (quick?.kind === 'enough') {
    return { state: s, dontKnow: false, shortCircuit: closeTurn(s, ctx.closingLine, 'user') }
  }

  if (pending?.kind === 'playback') {
    if (quick?.kind === 'playback_yes' || isAffirmative(userText)) {
      return { state: s, dontKnow: false, shortCircuit: closeTurn(s, ctx.closingLine) }
    }
    if (quick?.kind === 'playback_no' || isNegative(userText)) {
      const next: ChatDecisionState = { ...s, phase: 'gathering', pending: { kind: 'correct', chips: [] } }
      return {
        state: next, dontKnow: false,
        shortCircuit: { state: next, action: 'correct', reply: 'Okay \u2014 what did I get wrong?', quickReplies: NO_CHIPS, readyToReflect: false },
      }
    }
    // Anything longer is read as a correction or an addition — handled by decideTurn.
  }

  let dontKnow = false
  let cardNote: string | null = null
  let primaryText = userText

  // v9: the second card group answered in the same step. Recorded deterministically here so it is never lost,
  // whatever the model extracts; the primary answer is what the generic capture below sees.
  const comp: ChatCardGroup | null = pending?.kind === 'ask' ? (pending.companion ?? null) : null
  if (comp && quick?.companion) {
    const raw   = String(quick.companion.text ?? '')
    const ctext = clipText(raw, 900)
    const cmeta = sanitizeCardMeta(quick.companion.card, comp)
    if (raw && userText.endsWith(raw)) primaryText = userText.slice(0, userText.length - raw.length).trim()
    if (cmeta) {
      const exchange = ctx.exchange ?? 0
      s = recordCardAnswer(s, comp, cmeta, exchange)
      if (cmeta.responseType === 'not_sure') s = markUnknown(s, comp.slotKey)
      else if (cmeta.responseType !== 'prefer_not' && cmeta.responseType !== 'skip' && ctext.trim().length >= 2 && !isResolved(s, comp.slotKey)) s = setFact(s, comp.slotKey, ctext)
      const label = slotSpec(s.decisionKind, comp.slotKey)?.label ?? comp.slotKey
      cardNote = `In the same message they also answered a second question, "${label}": ${ctext}. Treat that as answered.`
    }
  }

  // v8: a card answer (or a typed reply to a question that was showing cards).
  const card: ChatCardGroup | null = pending?.kind === 'ask' ? (pending.card ?? null) : null
  const meta = card ? sanitizeCardMeta(quick?.card, card) : null
  if (card && pending?.slotKey === card.slotKey) {
    const exchange = ctx.exchange ?? 0
    if (meta) {
      s = recordCardAnswer(s, card, meta, exchange)
      cardNote = [cardNote, allSelectedNote(card, meta)].filter(Boolean).join(' ') || null
      // "Prefer not to say" / "Skip for now": resolved without a to-do — handled in recordCardAnswer; the planner must not capture it either.
      if (meta.responseType === 'prefer_not' || meta.responseType === 'skip') dontKnow = true
    } else if (quick?.kind !== 'unknown' && !isDontKnow(primaryText)) {
      // Ignored the cards and typed: still a real answer, recorded as such.
      s = recordCardAnswer(s, card, { questionId: card.questionId, responseType: 'free_text_only', selectedIds: [], usedFreeText: true }, exchange)
    }
  }

  if ((pending?.kind === 'ask' || pending?.kind === 'smart_friend') && (quick?.kind === 'unknown' || isDontKnow(primaryText))) {
    dontKnow = true
    if (pending.kind === 'ask' && pending.slotKey) s = markUnknown(s, pending.slotKey)
  }
  return { state: s, dontKnow, cardNote, primaryText }
}

// ── Step 2 + 3: fold the model's output in, then decide ──────────────────────

export interface DecideInput {
  planner:       PlannerOutput | null
  userText:      string
  dontKnow:      boolean
  exchangeCount: number          // this turn, after incrementing
  ceiling:       number
  closingLine:   string
  /** Pre-written answer when the person asked about Quorum itself (route generates it). */
  faqReply?:     string | null
  /** v9: text to store for the pending slot when it differs from `userText` (PreResult.primaryText). */
  captureText?:  string
  /** v9: Quorum's earlier messages, so the extra question never repeats one. */
  asked?:        string[]
  /** Examiner-in-chat experiment (lib/feature-flags.ts). Off => behaviour is identical to before it existed. */
  examinerInChat?: boolean
}

export function decideTurn(pre: ChatDecisionState, inp: DecideInput): TurnResult {
  const { planner, userText, dontKnow, exchangeCount, ceiling, closingLine } = inp
  const pending = pre.pending ?? null
  let s: ChatDecisionState = planner ? mergeNotes(pre, planner.notes, { userText }) : { ...pre }

  // The person asked about Quorum itself: answer, keep whatever was pending.
  if (planner?.aboutQuorum && inp.faqReply) {
    return { state: s, action: 'faq', reply: inp.faqReply, quickReplies: quickFromPending(pending), readyToReflect: false }
  }

  // Never lose an answer because extraction missed it.
  const text = (inp.captureText ?? userText).trim()
  if (pending?.kind === 'ask' && pending.slotKey && !dontKnow && !isResolved(s, pending.slotKey) && text.length >= 2
      && (!planner || planner.answeredPending !== false)) {
    s = setFact(s, pending.slotKey, text)
  }
  const gateAnswer = !!inp.examinerInChat && pending?.kind === 'smart_friend' && (pending.gap === 'dependency' || pending.slotKey === OUTLOOK_KEY)
  if (pending?.kind === 'smart_friend' && !dontKnow && text.length >= 2 && !gateAnswer) {
    s = pending.slotKey === CHANGE_MIND_SLOT.key
      ? setFact(s, CHANGE_MIND_SLOT.key, text)
      : { ...s, evidence: union(s.evidence, [clipText(text, 200)], 16) }
    // v9: answering a question about a tension settles it — the person's own words now outrank Quorum's earlier reading.
    if (pending.gap === 'tension' && s.contradictions?.length) {
      s = { ...s, contradictions: undefined, userCorrections: union(s.userCorrections, [`Clarified: ${clipText(text, 180)}`]) }
    }
  }
  // -- Oct 2026: the two Examiner questions that now live inside the chat (lib/chat-intake-gates.ts) --
  // E0 + C0: one free-text answer fills BOTH anchors, so the Examiner only has to ask for a one-tap confirm.
  if (inp.examinerInChat && pending?.kind === 'smart_friend' && pending.slotKey === OUTLOOK_KEY && !dontKnow && text.length >= 2) {
    s = applyOutlookAnswer(s, text)
  }
  // R1: the person answers the "this hinges on another decision" gate (a don't-know defaults to keep-going,
  // never to a block). 'park' ends the chat here; the client files it on the Watchlist.
  if (inp.examinerInChat && pending?.kind === 'smart_friend' && pending.gap === 'dependency' && s.dependency) {
    const choice = parseDependencyChoice(text) ?? 'keep_going'
    s = { ...s, dependency: { ...s.dependency, choice }, pending: null }
    if (choice === 'park_this') {
      return { state: s, action: 'park', reply: parkedReply(s.dependency!.text), quickReplies: NO_CHIPS, readyToReflect: false }
    }
  } else if (inp.examinerInChat && !s.dependency) {
    // Caught the moment it is said (not after the Council has run). Only ever raised once.
    const dep = detectUpstreamDecision(userText)
    if (dep) s = { ...s, dependency: { text: dep } }
  }
  const correcting = pending?.kind === 'correct' || pending?.kind === 'playback'
  if (correcting && text && !(planner?.notes.userCorrections?.length)) {
    s = { ...s, userCorrections: union(s.userCorrections, [clipText(text, 200)]) }
  }

  // Nagging protection: a slot asked twice and still open is flagged unknown.
  for (const slot of slotsFor(s.decisionKind).filter(x => x.required && !isResolved(s, x.key))) {
    if ((s.askCounts?.[slot.key] ?? 0) >= MAX_ASKS_PER_SLOT) s = markUnknown(s, slot.key)
  }

  const atCeiling   = exchangeCount >= ceiling
  const nearCeiling = exchangeCount >= ceiling - 1

  // Someone added a thing after the chat had already wrapped ("Add one more thing first").
  if (pre.phase === 'done') return closeTurn(s, closingLine)
  if (atCeiling)            return closeTurn(s, closingLine, 'ceiling')

  // v8: no separate "did I get that right?" step. The refined decision is confirmed ONCE, on the summary
  // screen (components/DecisionCheckpoint.tsx), where the person can confirm, edit, add more, or go back.
  // Chats saved before that change may still be waiting on a playback answer -- handled in preprocessTurn.
  const wrap = (state: ChatDecisionState): TurnResult => closeTurn(state, closingLine)

  if (correcting) return wrap(s)   // a correction to a pre-v8 playback: keep it, then wrap

  // v9: "ready" means nothing ESSENTIAL is missing (lib/chat-intake-depth.ts) — not that every slot was asked.
  const ready = criticalOpen(s).length === 0

  // v9: the reflection that goes above the next question, if the model's is good enough. Never substituted.
  const labels = Object.values(s.cardAnswers ?? {}).filter(a => a.exchange === exchangeCount).flatMap(a => a.selectedLabels)
  const verdict = validateReflection(planner?.reflection, { userText, selectedLabels: labels, onFile: Object.values(s.facts ?? {}), previousPrints: s.reflectionPrints })
  const reflection = verdict.ok ? verdict.text : null
  const reflectionMeta = { shown: verdict.ok, reason: verdict.ok ? null : verdict.reason }
  const noteReflection = (state: ChatDecisionState): ChatDecisionState => verdict.ok
    ? { ...state, reflectionCount: (state.reflectionCount ?? 0) + 1, turnsSinceReflection: 0, reflectionPrints: [...(state.reflectionPrints ?? []), reflectionPrint(verdict.text)].slice(-3) }
    : { ...state, turnsSinceReflection: (state.turnsSinceReflection ?? 0) + 1 }

  if (ready || nearCeiling) {
    // Last look before wrapping: ONE extra question, only for a critical, still-open, non-deferrable gap.
    if (ready && !nearCeiling && !s.smartFriendAsked) {
      const q = smartFriendGate(s, planner, inp.asked ?? [], !!inp.examinerInChat)
      s = { ...s, smartFriendAsked: true }
      if (q) {
        const next: ChatDecisionState = noteReflection({ ...s, phase: 'gathering', pending: { kind: 'smart_friend', slotKey: q.slotKey, chips: q.chips ?? [], gap: q.gap } })
        return { state: next, action: 'smart_friend', reply: composeReply(reflection, q.question), quickReplies: { kind: 'ask', slotKey: q.slotKey, chips: q.chips ?? [] }, readyToReflect: false, reflection: reflectionMeta }
      }
    }
    return wrap(s)
  }

  const asked = askNext(s, planner, closingLine, reflection)
  return asked.action === 'ask' ? { ...asked, state: noteReflection(asked.state), reflection: reflectionMeta } : asked
}

/**
 * The one extra question (v9 gate). It may only be asked when ALL hold:
 *   • the decision is not low-stakes;
 *   • the planner names a gap from a fixed list (tension, validation, feasibility, who_affected, reversibility, timing);
 *   • that gap is genuinely still open given every fact, card answer and earlier answer on file (and not a slot the
 *     path made non-material);
 *   • the question does not repeat something already asked or already known.
 * If the planner failed, the only fallback is the change-of-mind probe, and only on a high-stakes decision.
 */
type GateQuestion = { question: string; slotKey: string | null; gap: SmartFriendGap | 'change_mind' | 'dependency' | 'outlook'; chips?: string[] }

/**
 * Still exactly ONE extra question at most (the v9 contract) -- this only decides WHICH one. Priority:
 *   1. an unresolved upstream decision the person named (Examiner R1): it changes what the Council can honestly say;
 *   2. the model's own sharp-friend gap, or the change-of-mind probe (unchanged v9 behaviour);
 *   3. the combined outlook probe (Examiner E0 + C0) -- only when neither anchor is on file and nothing sharper applies.
 * Low-stakes decisions never get an extra question.
 */
function smartFriendGate(s: ChatDecisionState, planner: PlannerOutput | null, asked: string[], examinerInChat: boolean): GateQuestion | null {
  if (effectiveStakes(s) === 'low') return null
  if (examinerInChat && s.dependency && !s.dependency.choice) {
    return { question: dependencyQuestion(s.dependency.text), slotKey: null, gap: 'dependency', chips: [...DEPENDENCY_CHIPS] }
  }
  const base = baseSmartFriendGate(s, planner, asked)
  if (base) return base
  if (examinerInChat && !outlookCovered(s) && !duplicatesKnown(OUTLOOK_ASK, s, asked)) {
    return { question: OUTLOOK_ASK, slotKey: OUTLOOK_KEY, gap: 'outlook' }
  }
  return null
}

function baseSmartFriendGate(s: ChatDecisionState, planner: PlannerOutput | null, asked: string[]): GateQuestion | null {
  if (effectiveStakes(s) === 'low') return null
  if (!planner) {
    return effectiveStakes(s) === 'high' && !s.contradictions?.length && !isResolved(s, CHANGE_MIND_SLOT.key) && !duplicatesKnown(CHANGE_MIND_SLOT.ask, s, asked)
      ? { question: CHANGE_MIND_SLOT.ask, slotKey: CHANGE_MIND_SLOT.key, gap: 'change_mind' }
      : null
  }
  const q = planner.smartFriendQuestion
  if (!usableQuestion(q)) return null
  const gap = planner.smartFriendGap
  if (!isSmartFriendGap(gap)) return null
  if (!gapIsOpen(s, gap)) return null
  if (duplicatesKnown(q, s, asked)) return null
  return { question: q.trim(), slotKey: null, gap }
}

/** A second, related card group to open in the SAME message once the first is answered (progressive; never a form). */
function pickCompanion(s: ChatDecisionState, slotKey: string): ChatCardGroup | null {
  if (s.walkthrough) return null     // step-by-step mode: one small thing at a time
  const rest = criticalOpen(s).filter(x => x.key !== slotKey && (s.askCounts?.[x.key] ?? 0) < MAX_ASKS_PER_SLOT && !isNotApplicable(s, x.key))
  for (const cand of rest.slice(0, 2)) {
    const g = buildCardGroup({ kind: s.decisionKind, slot: cand, question: cand.ask })
    if (g) return g
  }
  return null
}

function askNext(s: ChatDecisionState, planner: PlannerOutput | null, closingLine: string, reflection: string | null): TurnResult {
  const ranked = criticalOpen(s).filter(x => (s.askCounts?.[x.key] ?? 0) < MAX_ASKS_PER_SLOT)
  const proposed = planner?.next && !isNotApplicable(s, planner.next.slotKey)
    ? ranked.find(x => x.key === planner.next!.slotKey) ?? null
    : null
  const slot = proposed ?? ranked[0]

  // Nothing askable is left (every essential slot has been asked twice and flagged unknown).
  if (!slot) {
    return closeTurn(s, closingLine)
  }

  const useModelWording = !!proposed && usableQuestion(planner!.next!.question)
  const question = useModelWording ? planner!.next!.question.trim() : slot.ask
  const chips    = sanitizeChips(useModelWording ? planner!.next!.chips : slot.chips, slot.chips ?? [])

  // Cards: approved template + the planner's adaptation, validated. No usable options -> asked as plain text.
  const card = buildCardGroup({ kind: s.decisionKind, slot, question, modelChips: useModelWording ? planner!.next!.chips : undefined })
  const shownChips = card ? card.options.map(o => o.label) : chips

  // v9: a related second group in the same step (only next to a real card group, and only for a still-essential slot).
  const companion = card ? pickCompanion(s, slot.key) : null

  const askCounts = { ...(s.askCounts ?? {}), [slot.key]: (s.askCounts?.[slot.key] ?? 0) + 1 }
  if (companion) askCounts[companion.slotKey] = (askCounts[companion.slotKey] ?? 0) + 1

  const next: ChatDecisionState = {
    ...s, phase: 'gathering', askCounts,
    pending:   { kind: 'ask', slotKey: slot.key, chips: shownChips, card, companion },
  }
  return {
    state: next, action: 'ask', reply: composeReply(reflection, question),
    quickReplies: { kind: 'ask', slotKey: slot.key, chips: shownChips, card, companion },
    readyToReflect: false,
  }
}

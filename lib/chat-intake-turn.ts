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
// never runs past its ceiling; a playback always precedes a normal wrap.

import type {
  ChatDecisionState, ChatPendingTurn, ChatQuickReplies, DecisionKind,
} from '@/lib/types'
import {
  CHANGE_MIND_SLOT, PLAYBACK_NO, PLAYBACK_YES,
  briefStatus, buildPlaybackFallback, clipText, finalizeBrief, isAffirmative,
  isDecisionKind, isDontKnow, isNegative, isNotApplicable, isResolved,
  markNotApplicable, markUnknown, rankMissing, sanitizeChips, scoreRichness,
  setFact, slotSpec, slotsFor,
} from './chat-intake-brief'
import type { PlannerOutput } from './chat-intake-plan-parse'

// ── Public shapes ────────────────────────────────────────────────────────────

export type QuickReplyKind = 'chip' | 'unknown' | 'playback_yes' | 'playback_no' | 'enough'
export interface QuickReplyMeta { kind: QuickReplyKind; slotKey?: string | null }

export type TurnAction = 'ask' | 'smart_friend' | 'playback' | 'correct' | 'close' | 'faq'

export interface TurnResult {
  state:          ChatDecisionState
  action:         TurnAction
  reply:          string
  quickReplies:   ChatQuickReplies
  readyToReflect: boolean
}

export const MAX_ASKS_PER_SLOT = 2
const NO_CHIPS: ChatQuickReplies = { kind: 'none', chips: [] }

// ── Small helpers ────────────────────────────────────────────────────────────

function quickFromPending(p: ChatPendingTurn | null | undefined): ChatQuickReplies {
  if (!p) return NO_CHIPS
  if (p.kind === 'playback') return { kind: 'playback', chips: p.chips }
  if (p.kind === 'ask' || p.kind === 'smart_friend') return { kind: 'ask', slotKey: p.slotKey ?? null, chips: p.chips }
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

const canBeNotApplicable = (kind: DecisionKind | null | undefined, key: string): boolean => {
  const spec = slotSpec(kind, key)
  return !!spec && spec.weight < 80 && spec.key !== 'alternatives'
}

// ── Folding the model's notes into the state ─────────────────────────────────

export function mergeNotes(prior: ChatDecisionState, notes: PlannerOutput['notes']): ChatDecisionState {
  let s: ChatDecisionState = { ...prior }

  if (notes.decisionStatement) s.decisionStatement = notes.decisionStatement
  if (isDecisionKind(notes.decisionKind)) s.decisionKind = notes.decisionKind
  if (notes.deadline)          s.deadline          = notes.deadline
  if (notes.decisionThreshold) s.decisionThreshold = notes.decisionThreshold
  if (notes.reversibility)     s.reversibility     = notes.reversibility
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
  if (notes.stakeholders?.length) {
    const have = new Set((s.stakeholders ?? []).map(x => x.name.toLowerCase()))
    s.stakeholders = [...(s.stakeholders ?? []), ...notes.stakeholders.filter(x => !have.has(x.name.toLowerCase()))].slice(0, 8)
  }

  // Brief facts — only keys that are real slots for this kind of decision.
  const valid = (key: string) => key === CHANGE_MIND_SLOT.key || !!slotsFor(s.decisionKind).some(x => x.key === key)
  for (const [k, v] of Object.entries(notes.facts ?? {})) if (valid(k)) s = setFact(s, k, v)
  for (const k of notes.unknownFacts ?? []) if (valid(k)) s = markUnknown(s, k)
  for (const k of notes.naSlots ?? [])      if (valid(k) && canBeNotApplicable(s.decisionKind, k)) s = markNotApplicable(s, k)
  return s
}

// ── Step 1: read the reply ───────────────────────────────────────────────────

export interface PreResult {
  state:     ChatDecisionState
  dontKnow:  boolean
  /** Set when the reply needs no model at all (playback yes/no, "that's enough"). */
  shortCircuit?: TurnResult
}

export function closeTurn(state: ChatDecisionState, closingLine: string): TurnResult {
  const s: ChatDecisionState = { ...finalizeBrief(state), phase: 'done', pending: null }
  return { state: s, action: 'close', reply: closingLine, quickReplies: NO_CHIPS, readyToReflect: true }
}

export function preprocessTurn(
  prior:    ChatDecisionState,
  userText: string,
  quick:    QuickReplyMeta | null | undefined,
  ctx:      { firstMessage: boolean; walkthrough?: boolean; closingLine: string },
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
    return { state: s, dontKnow: false, shortCircuit: closeTurn(s, ctx.closingLine) }
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
  if ((pending?.kind === 'ask' || pending?.kind === 'smart_friend') && (quick?.kind === 'unknown' || isDontKnow(userText))) {
    dontKnow = true
    if (pending.kind === 'ask' && pending.slotKey) s = markUnknown(s, pending.slotKey)
  }
  return { state: s, dontKnow }
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
}

export function decideTurn(pre: ChatDecisionState, inp: DecideInput): TurnResult {
  const { planner, userText, dontKnow, exchangeCount, ceiling, closingLine } = inp
  const pending = pre.pending ?? null
  let s: ChatDecisionState = planner ? mergeNotes(pre, planner.notes) : { ...pre }

  // The person asked about Quorum itself: answer, keep whatever was pending.
  if (planner?.aboutQuorum && inp.faqReply) {
    return { state: s, action: 'faq', reply: inp.faqReply, quickReplies: quickFromPending(pending), readyToReflect: false }
  }

  // Never lose an answer because extraction missed it.
  let capturedRaw = false
  const text = userText.trim()
  if (pending?.kind === 'ask' && pending.slotKey && !dontKnow && !isResolved(s, pending.slotKey) && text.length >= 2
      && (!planner || planner.answeredPending !== false)) {
    s = setFact(s, pending.slotKey, text)
    capturedRaw = true
  }
  if (pending?.kind === 'smart_friend' && !dontKnow && text.length >= 2) {
    s = pending.slotKey === CHANGE_MIND_SLOT.key
      ? setFact(s, CHANGE_MIND_SLOT.key, text)
      : { ...s, evidence: union(s.evidence, [clipText(text, 200)], 16) }
    capturedRaw = true
  }
  const correcting = pending?.kind === 'correct' || pending?.kind === 'playback'
  if (correcting && text && !(planner?.notes.userCorrections?.length)) {
    s = { ...s, userCorrections: union(s.userCorrections, [clipText(text, 200)]) }
    capturedRaw = true
  }

  // Nagging protection: a slot asked twice and still open is flagged unknown.
  for (const slot of briefStatus(s).missing) {
    if ((s.askCounts?.[slot.key] ?? 0) >= MAX_ASKS_PER_SLOT) s = markUnknown(s, slot.key)
  }

  const atCeiling   = exchangeCount >= ceiling
  const nearCeiling = exchangeCount >= ceiling - 1

  // Someone added a thing after the chat had already wrapped ("Add one more thing first").
  if (pre.phase === 'done') return closeTurn(s, closingLine)
  if (atCeiling)            return closeTurn(s, closingLine)

  const playback = (state: ChatDecisionState): TurnResult => {
    const st = finalizeBrief(state)
    const usable = !capturedRaw && planner?.playback && planner.playback.length >= 24 && !JARGON.test(planner.playback)
    const reply = usable ? planner!.playback! : buildPlaybackFallback(st)
    const next: ChatDecisionState = {
      ...st, phase: 'playback', playbackShown: (st.playbackShown ?? 0) + 1,
      pending: { kind: 'playback', chips: [PLAYBACK_YES, PLAYBACK_NO] },
    }
    return { state: next, action: 'playback', reply, quickReplies: { kind: 'playback', chips: [PLAYBACK_YES, PLAYBACK_NO] }, readyToReflect: false }
  }

  if (correcting) {
    if ((s.playbackShown ?? 0) >= 2) return closeTurn(s, closingLine)   // two playbacks is plenty
    return playback(s)
  }

  const status = briefStatus(s)

  if (status.ready || nearCeiling) {
    // Last look before wrapping: the one thing a sharp friend would still ask.
    if (status.ready && !nearCeiling && !s.smartFriendAsked) {
      const q = smartFriendQuestion(s, planner)
      s = { ...s, smartFriendAsked: true }
      if (q) {
        const next: ChatDecisionState = { ...s, phase: 'gathering', pending: { kind: 'smart_friend', slotKey: q.slotKey, chips: [] } }
        return { state: next, action: 'smart_friend', reply: q.question, quickReplies: { kind: 'ask', slotKey: q.slotKey, chips: [] }, readyToReflect: false }
      }
    }
    return playback(s)
  }

  return askNext(s, planner)
}

function smartFriendQuestion(s: ChatDecisionState, planner: PlannerOutput | null): { question: string; slotKey: string | null } | null {
  if (planner) {
    return usableQuestion(planner.smartFriendQuestion) ? { question: planner.smartFriendQuestion!.trim(), slotKey: null } : null
  }
  // Planner failed: fall back to the one probe every decision benefits from.
  return isResolved(s, CHANGE_MIND_SLOT.key) ? null : { question: CHANGE_MIND_SLOT.ask, slotKey: CHANGE_MIND_SLOT.key }
}

function askNext(s: ChatDecisionState, planner: PlannerOutput | null): TurnResult {
  const ranked = rankMissing(s).filter(x => (s.askCounts?.[x.key] ?? 0) < MAX_ASKS_PER_SLOT)
  const proposed = planner?.next && !isNotApplicable(s, planner.next.slotKey)
    ? ranked.find(x => x.key === planner.next!.slotKey) ?? null
    : null
  const slot = proposed ?? ranked[0]

  // Nothing askable is left (every open slot has been asked twice and flagged unknown).
  if (!slot) {
    const st = finalizeBrief(s)
    const reply = buildPlaybackFallback(st)
    const next: ChatDecisionState = { ...st, phase: 'playback', playbackShown: (st.playbackShown ?? 0) + 1, pending: { kind: 'playback', chips: [PLAYBACK_YES, PLAYBACK_NO] } }
    return { state: next, action: 'playback', reply, quickReplies: { kind: 'playback', chips: [PLAYBACK_YES, PLAYBACK_NO] }, readyToReflect: false }
  }

  const useModelWording = !!proposed && usableQuestion(planner!.next!.question)
  const question = useModelWording ? planner!.next!.question.trim() : slot.ask
  const chips    = sanitizeChips(useModelWording ? planner!.next!.chips : slot.chips, slot.chips ?? [])

  const next: ChatDecisionState = {
    ...s, phase: 'gathering',
    askCounts: { ...(s.askCounts ?? {}), [slot.key]: (s.askCounts?.[slot.key] ?? 0) + 1 },
    pending:   { kind: 'ask', slotKey: slot.key, chips },
  }
  return { state: next, action: 'ask', reply: question, quickReplies: { kind: 'ask', slotKey: slot.key, chips }, readyToReflect: false }
}

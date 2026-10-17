// tests/chat-intake-turn.test.ts
// ── Natural Intake v7 — what happens on each turn (pure logic) ───────────────
// The model proposes; this logic decides. These tests pin the invariants that
// stop the chat from nagging, stalling, running long, or silently dropping an
// answer — no network, no model calls.

import { describe, it, expect } from 'vitest'
import { decideTurn, mergeNotes, preprocessTurn, usableQuestion, MAX_ASKS_PER_SLOT } from '../lib/chat-intake-turn'
import type { PlannerOutput } from '../lib/chat-intake-plan-parse'
import { briefStatus, isKnown, PLAYBACK_NO, PLAYBACK_YES, setFact } from '../lib/chat-intake-brief'
import type { ChatDecisionState } from '../lib/types'

const CLOSE = 'CLOSING LINE'
const planner = (p: Partial<PlannerOutput> = {}): PlannerOutput => ({
  notes: {}, answeredPending: null, aboutQuorum: false, next: null, playback: null, smartFriendQuestion: null, ...p,
})
const decide = (pre: ChatDecisionState, userText: string, p: PlannerOutput | null, over: Record<string, unknown> = {}) =>
  decideTurn(pre, { planner: p, userText, dontKnow: false, exchangeCount: 2, ceiling: 9, closingLine: CLOSE, ...over })

const job: ChatDecisionState = { decisionKind: 'career_exit', richness: 'sparse', phase: 'gathering' }
const ready = (s: ChatDecisionState): ChatDecisionState => {
  let out = s
  for (const m of briefStatus(s).missing) out = setFact(out, m.key, 'x')
  return out
}

describe('reading the reply (no model needed)', () => {
  it('"that\u2019s enough" wraps immediately and flags whatever is still open', () => {
    const r = preprocessTurn(job, '', { kind: 'enough' }, { firstMessage: false, closingLine: CLOSE }).shortCircuit!
    expect(r.readyToReflect).toBe(true)
    expect(r.reply).toBe(CLOSE)
    expect(briefStatus(r.state).ready).toBe(true)
    expect(r.state.unknownFacts!.length).toBeGreaterThan(0)
  })
  it('a yes to the playback wraps; a typed "yes" works too', () => {
    const pb: ChatDecisionState = { ...ready(job), pending: { kind: 'playback', chips: [PLAYBACK_YES, PLAYBACK_NO] } }
    expect(preprocessTurn(pb, PLAYBACK_YES, { kind: 'playback_yes' }, { firstMessage: false, closingLine: CLOSE }).shortCircuit?.readyToReflect).toBe(true)
    expect(preprocessTurn(pb, 'yeah', null, { firstMessage: false, closingLine: CLOSE }).shortCircuit?.readyToReflect).toBe(true)
  })
  it('"not quite" asks what was wrong and does not wrap', () => {
    const pb: ChatDecisionState = { ...ready(job), pending: { kind: 'playback', chips: [] } }
    const r = preprocessTurn(pb, PLAYBACK_NO, { kind: 'playback_no' }, { firstMessage: false, closingLine: CLOSE }).shortCircuit!
    expect(r.readyToReflect).toBe(false)
    expect(r.state.pending?.kind).toBe('correct')
  })
  it('"not sure" on a pending question is recorded as an unknown, not re-asked', () => {
    const pending: ChatDecisionState = { ...job, pending: { kind: 'ask', slotKey: 'runway', chips: [] } }
    const pre = preprocessTurn(pending, 'Not sure yet', { kind: 'unknown', slotKey: 'runway' }, { firstMessage: false, closingLine: CLOSE })
    expect(pre.dontKnow).toBe(true)
    expect(pre.state.unknownFacts).toContain('runway')
    expect(pre.state.todos?.length).toBe(1)
  })
  it('a detailed first message sets richness; walk-through forces the gentle path', () => {
    expect(preprocessTurn({}, 'quit', null, { firstMessage: true, closingLine: CLOSE }).state.richness).toBe('sparse')
    const rich = 'I am a PM at HDFC in Mumbai for 4 years, offer from a Bengaluru startup at 40 lakh vs 28 lakh now, 9 months savings, my partner works here, offer expires in two weeks, manager is pushing me too.'
    expect(preprocessTurn({}, rich, null, { firstMessage: true, closingLine: CLOSE }).state.richness).toBe('rich')
    const w = preprocessTurn({}, rich, null, { firstMessage: true, walkthrough: true, closingLine: CLOSE }).state
    expect(w.richness).toBe('sparse')
    expect(w.walkthrough).toBe(true)
  })
})

describe('choosing the next question', () => {
  it('uses the model\u2019s question and chips when they are about a real open slot', () => {
    const r = decide(job, 'quit my job', planner({ next: { slotKey: 'runway', question: 'Roughly how many months could you manage without a paycheck?', chips: ['Under 3 months', '3\u20136 months', '6+ months'] } }))
    expect(r.action).toBe('ask')
    expect(r.state.pending).toMatchObject({ kind: 'ask', slotKey: 'runway' })
    expect(r.quickReplies.chips).toEqual(['Under 3 months', '3\u20136 months', '6+ months'])
    expect(r.state.askCounts?.runway).toBe(1)
  })
  it('falls back to the slot list when the model names a slot that is not open', () => {
    const r = decide(setFact(job, 'role', 'PM'), 'hi', planner({ next: { slotKey: 'role', question: 'What is your role at work?', chips: [] } }))
    expect(r.state.pending?.slotKey).not.toBe('role')
  })
  it('falls back to the slot\u2019s own plain question when the model\u2019s wording is unusable', () => {
    const r = decide(job, 'x', planner({ next: { slotKey: 'runway', question: 'What does the Examiner slot brief say?', chips: [] } }))
    expect(r.reply).toMatch(/months could you cover/i)
  })
  it('asks from the slot list when the planner failed entirely (never stalls)', () => {
    const r = decide(job, 'quit my job', null)
    expect(r.action).toBe('ask')
    expect(r.reply.length).toBeGreaterThan(10)
  })
  it('usableQuestion rejects jargon and walls of text', () => {
    expect(usableQuestion('Which city are you in now, and where would you move?')).toBe(true)
    expect(usableQuestion('Tell me about the Council checkpoint')).toBe(false)
    expect(usableQuestion('word '.repeat(60))).toBe(false)
    expect(usableQuestion(null)).toBe(false)
  })
})

describe('never nag, never lose an answer', () => {
  it('keeps the person\u2019s own words when the model missed the answer to the pending question', () => {
    const pending: ChatDecisionState = { ...job, pending: { kind: 'ask', slotKey: 'runway', chips: [] } }
    expect(isKnown(decide(pending, 'about 8 months', planner()).state, 'runway')).toBe(true)
    expect(isKnown(decide(pending, 'about 8 months', null).state, 'runway')).toBe(true)
  })
  it('but does not treat it as an answer when the model says it was not one', () => {
    const pending: ChatDecisionState = { ...job, pending: { kind: 'ask', slotKey: 'runway', chips: [] } }
    expect(isKnown(decide(pending, 'what do you mean?', planner({ answeredPending: false })).state, 'runway')).toBe(false)
  })
  it('flags a slot unknown after it has been asked twice, so it is never asked a third time', () => {
    let s: ChatDecisionState = { ...job, askCounts: { runway: MAX_ASKS_PER_SLOT } }
    s = decide(s, 'hmm', planner({ answeredPending: false })).state
    expect(s.unknownFacts).toContain('runway')
  })
  it('keeps a fact the model already captured instead of overwriting it with the raw reply', () => {
    const pending: ChatDecisionState = { ...job, pending: { kind: 'ask', slotKey: 'runway', chips: [] } }
    const r = decide(pending, 'around 8 months, maybe a bit more', planner({ notes: { facts: { runway: '8+ months' } }, answeredPending: true }))
    expect(r.state.facts?.runway).toBe('8+ months')
  })
})

describe('mergeNotes', () => {
  it('ignores fact keys that are not real slots for the kind, and cannot mark a core specific "not applicable"', () => {
    const s = mergeNotes({ decisionKind: 'relocation' }, { facts: { bogus: 'x', from_to: 'Pune to Berlin' }, naSlots: ['from_to', 'who_moves'] })
    expect(s.facts).toEqual({ from_to: 'Pune to Berlin' })
    expect(s.naSlots).toEqual(['who_moves'])
  })
  it('never overwrites the very first gut reaction, and keeps what it already had', () => {
    const s = mergeNotes({ initialReaction: 'act', evidence: ['a'] }, { initialReaction: 'dont_act', evidence: ['b'] })
    expect(s.initialReaction).toBe('act')
    expect(s.evidence).toEqual(['a', 'b'])
  })
  it('never touches the lean chips the person tapped', () => {
    const s = mergeNotes({ chosenLean: 'accept', optimizationPriority: 'money' }, { decisionStatement: 'x' })
    expect(s.chosenLean).toBe('accept')
    expect(s.optimizationPriority).toBe('money')
  })
})

describe('when to stop', () => {
  it('a filled brief gets the one "sharp friend" question, once, then a playback', () => {
    const first = decide(ready(job), 'ok', planner({ smartFriendQuestion: 'What would make you stay?' }))
    expect(first.action).toBe('smart_friend')
    expect(first.state.smartFriendAsked).toBe(true)
    const second = decide(first.state, 'a raise and a new manager', planner({ smartFriendQuestion: 'Anything else?' }))
    expect(second.action).toBe('playback')
    expect(second.state.evidence).toContain('a raise and a new manager')
  })
  it('skips the sharp-friend question when nothing material is missing', () => {
    expect(decide(ready(job), 'ok', planner()).action).toBe('playback')
  })
  it('a playback always comes before a normal wrap and offers yes / not quite', () => {
    const r = decide({ ...ready(job), smartFriendAsked: true }, 'ok', planner())
    expect(r.action).toBe('playback')
    expect(r.readyToReflect).toBe(false)
    expect(r.quickReplies).toEqual({ kind: 'playback', chips: [PLAYBACK_YES, PLAYBACK_NO] })
    expect(r.state.playbackShown).toBe(1)
  })
  it('near the ceiling it plays back and flags whatever is still open', () => {
    const r = decide(job, 'ok', planner(), { exchangeCount: 8 })
    expect(r.action).toBe('playback')
    expect(briefStatus(r.state).ready).toBe(true)
  })
  it('at the ceiling it wraps no matter what', () => {
    const r = decide(job, 'ok', planner(), { exchangeCount: 9 })
    expect(r.readyToReflect).toBe(true)
  })
  it('a correction after the playback shows it again, then stops after two', () => {
    const pb: ChatDecisionState = { ...ready(job), smartFriendAsked: true, playbackShown: 1, pending: { kind: 'playback', chips: [] } }
    const again = decide(pb, 'actually my partner is not coming', planner())
    expect(again.action).toBe('playback')
    expect(again.state.userCorrections).toContain('actually my partner is not coming')
    expect(decide(again.state, 'and I have a second offer', planner()).readyToReflect).toBe(true)
  })
  it('adding something after the chat already wrapped just wraps again, no second playback', () => {
    expect(decide({ ...ready(job), phase: 'done' }, 'one more thing', planner()).readyToReflect).toBe(true)
  })
  it('answers a question about Quorum without losing the pending question or its chips', () => {
    const pending: ChatDecisionState = { ...job, pending: { kind: 'ask', slotKey: 'runway', chips: ['A', 'B'] } }
    const r = decide(pending, 'is this private?', planner({ aboutQuorum: true }), { faqReply: 'Yes, private.' })
    expect(r.action).toBe('faq')
    expect(r.reply).toBe('Yes, private.')
    expect(r.state.pending?.slotKey).toBe('runway')
    expect(r.quickReplies.chips).toEqual(['A', 'B'])
    expect(r.state.askCounts?.runway ?? 0).toBe(0)
  })
})

describe('REGRESSION: "unasked" is not "unknown"', () => {
  const offer: ChatDecisionState = {
    decisionKind: 'job_offer', richness: 'sparse', phase: 'gathering',
    askCounts: { offer: 1 }, pending: { kind: 'ask', slotKey: 'offer', chips: [] },
  }
  const overEager = planner({
    notes: { facts: { offer: 'Senior Project Manager, 38 LPA (current 42 LPA)' }, unknownFacts: ['leaving', 'hesitation', 'deadline', 'alternatives'] },
    answeredPending: true,
  })

  it('a model that flags every unasked slot as unknown does NOT end the chat after one question', () => {
    const r = decide(offer, 'Exact title is Senior Project Manager, Comp is 38LPA less than my current 42 LPA', overEager)
    expect(r.action).toBe('ask')
    expect(r.readyToReflect).toBe(false)
    expect(r.state.unknownFacts ?? []).toEqual([])
    expect(r.state.facts?.offer).toMatch(/38 LPA/)
  })
  it('accepts a model-flagged unknown when the person really said they do not know', () => {
    const r = decide(offer, 'Offer is 38 LPA. Not sure about the deadline yet.', planner({
      notes: { facts: { offer: '38 LPA' }, unknownFacts: ['deadline'] }, answeredPending: true,
    }))
    expect(r.state.unknownFacts).toEqual(['deadline'])
  })
  it('accepts at most two model-flagged unknowns per turn, even when the person said "not sure"', () => {
    const r = decide(offer, 'Offer is 38 LPA, not sure about the rest', planner({
      notes: { facts: { offer: '38 LPA' }, unknownFacts: ['leaving', 'hesitation', 'deadline', 'alternatives'] }, answeredPending: true,
    }))
    expect(r.state.unknownFacts).toHaveLength(2)
    expect(r.action).toBe('ask')
  })
  it('lets only an opt-in slot (who it affects) be "not applicable" — never a core specific or a deadline', () => {
    const s = mergeNotes({ decisionKind: 'relocation' }, { naSlots: ['from_to', 'who_moves', 'timeline', 'work_plan'] })
    expect(s.naSlots).toEqual(['who_moves'])
  })
  it('does not treat "not mentioned" style placeholders as facts', () => {
    const s = mergeNotes(offer, { facts: { deadline: 'Not mentioned', leaving: 'unknown', hesitation: 'n/a', offer: '38 LPA' } })
    expect(s.facts).toEqual({ offer: '38 LPA' })
  })
})


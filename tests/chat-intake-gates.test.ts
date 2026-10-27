// tests/chat-intake-gates.test.ts
// Examiner-in-chat: (A) E0 + C0 captured by one in-chat probe, (B) an unresolved upstream decision gated in chat.
import { describe, it, expect } from 'vitest'
import {
  detectUpstreamDecision, parseDependencyChoice, outlookCovered, applyOutlookAnswer, readCoverageFromContext,
  dependencyContextLine, DEPENDENCY_CHIPS, OUTLOOK_ASK, OUTLOOK_KEY, DEPENDS_LINE_PREFIX,
} from '../lib/chat-intake-gates'
import { decideTurn } from '../lib/chat-intake-turn'
import { assembleSessionInput } from '../lib/chat-intake-state'
import { briefRows } from '../lib/chat-intake-brief'
import type { PlannerOutput } from '../lib/chat-intake-plan-parse'
import type { ChatDecisionState } from '../lib/types'

const CLOSE = 'CLOSE'
const career = (o: Partial<ChatDecisionState> = {}): ChatDecisionState => ({ decisionKind: 'career_exit', phase: 'gathering', facts: {}, ...o })
const plan = (o: Partial<PlannerOutput> = {}): PlannerOutput => ({ notes: {}, answeredPending: null, aboutQuorum: false, next: null, playback: null, smartFriendQuestion: null, ...o } as PlannerOutput)
// Every essential slot answered => the chat is "ready" and reaches the smart-friend gate.
const full = career({ stakes: 'high', facts: { role: 'a', next_step: 'Take a break', runway: 'o12', why_now: 'z', alternatives: 'q', people: 'wife' } })
const turn = (s: ChatDecisionState, userText: string, on: boolean, extra: Record<string, unknown> = {}) =>
  decideTurn(s, { planner: plan(), userText, dontKnow: false, exchangeCount: 3, ceiling: 9, closingLine: CLOSE, examinerInChat: on, ...extra })

describe('B — detectUpstreamDecision is conservative', () => {
  it.each([
    ['Whether I take the offer depends on whether I move to Pune', 'move to Pune'],
    ['I can\u2019t say until I decide whether to sell the flat.', 'sell the flat'],
    ['Once I\u2019ve decided about my visa I\u2019ll know', 'my visa'],
    ['First I need to decide whether to get married, then the job', 'get married'],
  ])('finds the upstream decision in %j', (text, expected) => {
    expect(detectUpstreamDecision(text)).toContain(expected)
  })
  it.each([
    // The pasted session: an external EVENT, not a decision of theirs — stays an unknown, never a gate.
    'Help me decide if I should quit current job I joined 3 weeks back since it will be acquired next year mid 2027',
    'Fear role will be redundant after acquisition; I want to avoid transition uncertainty',
    'I have asked the manager and others if role redundancy is a possibility',
    'It depends.',
    '',
  ])('does NOT fire on %j', text => { expect(detectUpstreamDecision(text)).toBeNull() })
})

describe('B — parseDependencyChoice', () => {
  it('maps the two chips and free text; unknown => null (caller defaults to keep-going, never a block)', () => {
    expect(parseDependencyChoice(DEPENDENCY_CHIPS[0])).toBe('keep_going')
    expect(parseDependencyChoice(DEPENDENCY_CHIPS[1])).toBe('park_this')
    expect(parseDependencyChoice('let\u2019s park it')).toBe('park_this')
    expect(parseDependencyChoice('hmm')).toBeNull()
  })
})

describe('flag OFF = byte-identical to before (the v9 contract holds)', () => {
  it('a ready chat with no named gap still wraps with no extra question', () => {
    expect(turn(full, 'x', false).action).toBe('close')
  })
  it('an upstream decision in the message is not detected, gated or recorded', () => {
    const r = turn(full, 'It depends on whether I move to Pune', false)
    expect(r.action).toBe('close')
    expect(r.state.dependency).toBeUndefined()
  })
})

describe('B — the gate, flag ON', () => {
  it('detects the dependency the moment it is said and spends the ONE extra question on it', () => {
    const r = turn(full, 'It depends on whether I move to Pune', true)
    expect(r.action).toBe('smart_friend')
    expect(r.state.pending?.gap).toBe('dependency')
    expect(r.quickReplies.chips).toEqual([...DEPENDENCY_CHIPS])
    expect(r.reply).toContain('move to Pune')
    expect(r.state.smartFriendAsked).toBe(true)      // still at most one extra question
  })
  it('never raises it on a low-stakes decision', () => {
    expect(turn({ ...full, stakes: 'low' }, 'It depends on whether I move to Pune', true).action).toBe('close')
  })
  it('"keep going" records the choice and the chat wraps normally', () => {
    const asked = turn(full, 'It depends on whether I move to Pune', true)
    const r = turn(asked.state, DEPENDENCY_CHIPS[0], true)
    expect(r.state.dependency?.choice).toBe('keep_going')
    expect(r.action).toBe('close')
    expect(r.readyToReflect).toBe(true)
  })
  it('an unparseable / "not sure" answer defaults to keep-going, never to a block', () => {
    const asked = turn(full, 'It depends on whether I move to Pune', true)
    expect(turn(asked.state, 'not sure', true, { dontKnow: true }).state.dependency?.choice).toBe('keep_going')
  })
  it('"park" ends the chat here with a parked reply; no session is queued', () => {
    const asked = turn(full, 'It depends on whether I move to Pune', true)
    const r = turn(asked.state, DEPENDENCY_CHIPS[1], true)
    expect(r.action).toBe('park')
    expect(r.readyToReflect).toBe(false)
    expect(r.state.dependency).toMatchObject({ text: expect.stringContaining('move to Pune'), choice: 'park_this' })
    expect(r.reply).toMatch(/Parked/)
  })
  it('the gate answer is not mistaken for evidence', () => {
    const asked = turn(full, 'It depends on whether I move to Pune', true)
    const r = turn(asked.state, DEPENDENCY_CHIPS[0], true)
    expect(JSON.stringify(r.state.evidence ?? [])).not.toContain('Keep going')
  })
})

describe('A — the outlook probe (E0 + C0 in one turn), flag ON', () => {
  it('asked in the single extra-question slot only when neither anchor is on file', () => {
    const r = turn(full, 'x', true)
    expect(r.action).toBe('smart_friend')
    expect(r.reply).toContain(OUTLOOK_ASK)
    expect(r.state.pending?.slotKey).toBe(OUTLOOK_KEY)
  })
  it('skipped when the person already volunteered either anchor', () => {
    expect(turn({ ...full, gutFeeling: 'dreading it' }, 'x', true).action).toBe('close')
    expect(turn({ ...full, successPicture: 'calm and paid fairly' }, 'x', true).action).toBe('close')
  })
  it('the model\u2019s own sharper gap question still wins (unchanged v9 behaviour)', () => {
    const r = decideTurn(full, { planner: plan({ smartFriendQuestion: 'How hard would this be to undo?', smartFriendGap: 'reversibility' } as Partial<PlannerOutput>),
      userText: 'x', dontKnow: false, exchangeCount: 3, ceiling: 9, closingLine: CLOSE, examinerInChat: true })
    expect(r.state.pending?.gap).toBe('reversibility')
  })
  it('one answer fills BOTH Examiner anchors and is never overwritten', () => {
    const asked = turn(full, 'x', true)
    const r = turn(asked.state, 'Calm, stable pay. I worry I\u2019d regret leaving too early.', true)
    expect(r.state.gutFeeling).toContain('regret')
    expect(r.state.successPicture).toContain('stable pay')
    expect(applyOutlookAnswer({ gutFeeling: 'keep me', facts: {} }, 'new').gutFeeling).toBe('keep me')
    expect(outlookCovered(r.state)).toBe(true)
  })
  it('shows up in the live brief as a readable row', () => {
    const s = applyOutlookAnswer(career(), 'Stable, and I worry about money')
    expect(briefRows(s).some(r => r.key === OUTLOOK_KEY && r.status === 'known')).toBe(true)
  })
  it('a "don\u2019t know" is accepted without re-asking or filling the anchors', () => {
    const asked = turn(full, 'x', true)
    const r = turn(asked.state, 'not sure', true, { dontKnow: true })
    expect(r.state.gutFeeling).toBeFalsy()
    expect(r.action).toBe('close')
  })
})

describe('what the Examiner reads back (context_text round trip)', () => {
  it('assembleSessionInput writes the lines; readCoverageFromContext recovers them exactly', () => {
    const s: ChatDecisionState = career({
      decisionStatement: 'Should I take the Pune offer?',
      gutFeeling: 'Excited but dreading the move', successPicture: 'Settled in a year, still close to family',
      dependency: { text: 'move to Pune', choice: 'keep_going' },
    })
    const { contextText } = assembleSessionInput(s, [])
    expect(contextText).toContain(DEPENDS_LINE_PREFIX)
    const cov = readCoverageFromContext(contextText)
    expect(cov.gut).toBe('Excited but dreading the move')
    expect(cov.success).toBe('Settled in a year, still close to family')
    expect(cov.dependency).toEqual({ text: 'move to Pune', choice: 'keep_going' })
  })
  it('an unresolved dependency carries no choice (so the Examiner\u2019s R1 block is left alone)', () => {
    const line = dependencyContextLine({ text: 'sell the flat' })!
    expect(readCoverageFromContext(line).dependency).toEqual({ text: 'sell the flat', choice: null })
  })
  it('a chat with nothing recorded reads back as empty', () => {
    expect(readCoverageFromContext('Kind of decision: Leaving a job')).toEqual({})
  })
})

describe('B — detection edge cases', () => {
  it('stops at a clause connector instead of swallowing the rest of the sentence', () => {
    expect(detectUpstreamDecision('Once I\u2019ve decided about my visa I\u2019ll know')).toBe('my visa')
    expect(detectUpstreamDecision('It hinges on whether I sell the flat, then I can plan')).toBe('sell the flat')
  })
  it('handles curly apostrophes (phone keyboards) identically to straight ones', () => {
    expect(detectUpstreamDecision('Once I\u2019ve decided about my visa.')).toBe(detectUpstreamDecision("Once I've decided about my visa."))
  })
})

import { shouldDowngradeR1, shouldAskS0, upstreamPrefill } from '../lib/chat-intake-gates'

describe('R1 downgrade — the Examiner never re-blocks a dependency the person already answered in chat', () => {
  const ctx = (choice?: string) => `Kind of decision: A job offer\n${DEPENDS_LINE_PREFIX}move to Pune${choice ? ` (${choice})` : ''}`
  const input = (o: Record<string, unknown> = {}) => ({ ruleMode: 'REDIRECT', redirectRule: 'R1', intakeMode: 'chat', contextText: ctx('keep_going'), ...o })
  it('downgrades when the person chose to keep going', () => {
    expect(shouldDowngradeR1(input())).toBe(true)
  })
  it('does NOT downgrade a dependency with no recorded choice (the original R1 block stands)', () => {
    expect(shouldDowngradeR1(input({ contextText: ctx() }))).toBe(false)
  })
  it('does NOT downgrade a parked decision', () => {
    expect(shouldDowngradeR1(input({ contextText: ctx('park_this') }))).toBe(false)
  })
  it('does NOT downgrade when no dependency was recorded at all', () => {
    expect(shouldDowngradeR1(input({ contextText: 'Kind of decision: A job offer' }))).toBe(false)
  })
  it('only ever touches R1 — an R7 redirect is left to its own resolvability check', () => {
    expect(shouldDowngradeR1(input({ redirectRule: 'R7' }))).toBe(false)
  })
  it('only ever touches a REDIRECT', () => {
    expect(shouldDowngradeR1(input({ ruleMode: 'GATE' }))).toBe(false)
    expect(shouldDowngradeR1(input({ ruleMode: null }))).toBe(false)
  })
  it('never applies to classic-intake sessions, even if a stray line is present', () => {
    expect(shouldDowngradeR1(input({ intakeMode: 'classic' }))).toBe(false)
    expect(shouldDowngradeR1(input({ intakeMode: undefined }))).toBe(false)
  })
})

describe('S0 — only re-asked when the chat has not already deepened the brief', () => {
  const s0 = (o: Record<string, unknown> = {}) => shouldAskS0({ decisionWordCount: 10, effectiveMode: 'GATE', intakeMode: 'chat', examinerInChat: false, ...o } as never)
  it('flag OFF: unchanged — a thin brief (<25 words) gets S0, in chat or classic', () => {
    expect(s0()).toBe(true)
    expect(s0({ intakeMode: 'classic' })).toBe(true)
  })
  it('flag OFF: a long brief never gets S0', () => { expect(s0({ decisionWordCount: 40 })).toBe(false) })
  it('flag ON + chat session: suppressed (the chat is the deepening)', () => {
    expect(s0({ examinerInChat: true })).toBe(false)
  })
  it('flag ON + classic session: unchanged', () => {
    expect(s0({ examinerInChat: true, intakeMode: 'classic' })).toBe(true)
  })
  it('never in REDIRECT, regardless of the flag', () => {
    expect(s0({ effectiveMode: 'REDIRECT' })).toBe(false)
    expect(s0({ effectiveMode: 'REDIRECT', examinerInChat: true })).toBe(false)
  })
})

describe('upstreamPrefill', () => {
  it('turns the parked dependency into the opening of the next chat', () => {
    expect(upstreamPrefill('move to Pune')).toBe('I need to decide: move to Pune')
  })
  it('round-trips with detection: the prefill is not itself re-detected as another dependency', () => {
    expect(detectUpstreamDecision(upstreamPrefill('move to Pune'))).toBeNull()
  })
})

describe('end to end: chat turn → session context → Examiner decision', () => {
  const full: ChatDecisionState = { decisionKind: 'career_exit', phase: 'gathering', stakes: 'high', facts: { role: 'a', next_step: 'Take a break', runway: 'o12', why_now: 'z', alternatives: 'q', people: 'wife' } }
  const run = (s: ChatDecisionState, text: string) =>
    decideTurn(s, { planner: plan(), userText: text, dontKnow: false, exchangeCount: 3, ceiling: 9, closingLine: CLOSE, examinerInChat: true })

  it('keep going ⇒ the recorded choice reaches the Examiner and R1 is downgraded', () => {
    const gate = run(full, 'It depends on whether I move to Pune')
    const done = run(gate.state, DEPENDENCY_CHIPS[0])
    const { contextText } = assembleSessionInput(done.state, [])
    expect(shouldDowngradeR1({ ruleMode: 'REDIRECT', redirectRule: 'R1', intakeMode: 'chat', contextText })).toBe(true)
  })
  it('the gate was asked but never answered ⇒ R1 still blocks, exactly as before', () => {
    const gate = run(full, 'It depends on whether I move to Pune')
    const { contextText } = assembleSessionInput(gate.state, [])
    expect(shouldDowngradeR1({ ruleMode: 'REDIRECT', redirectRule: 'R1', intakeMode: 'chat', contextText })).toBe(false)
  })
  it('outlook answered in chat ⇒ both Examiner anchors are recoverable verbatim from context_text', () => {
    const asked = run(full, 'x')
    const answered = run(asked.state, 'Calm, stable pay. I worry I would regret leaving early.')
    const cov = readCoverageFromContext(assembleSessionInput(answered.state, []).contextText)
    expect(cov.gut).toContain('regret')
    expect(cov.success).toContain('stable pay')
  })
})

describe('the gate only offers "park" when parking can actually be saved', () => {
  const full2: ChatDecisionState = { decisionKind: 'career_exit', phase: 'gathering', stakes: 'high', gutFeeling: 'x', facts: { role: 'a', next_step: 'Take a break', runway: 'o12', why_now: 'z', alternatives: 'q', people: 'wife' } }
  const t = (canPark?: boolean) => decideTurn(full2, { planner: plan(), userText: 'It depends on whether I move to Pune', dontKnow: false, exchangeCount: 3, ceiling: 9, closingLine: CLOSE, examinerInChat: true, canPark })
  it('Watchlist on (or unspecified): the gate is raised', () => {
    expect(t(true).state.pending?.gap).toBe('dependency')
    expect(t(undefined).state.pending?.gap).toBe('dependency')
  })
  it('Watchlist off: the gate is not raised, so no decision is silently lost; the dependency stays recorded without a choice', () => {
    const r = t(false)
    expect(r.state.pending?.gap).not.toBe('dependency')
    expect(r.state.dependency?.choice).toBeUndefined()
    expect(r.action).toBe('close')
  })
})

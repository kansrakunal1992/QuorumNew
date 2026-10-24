// tests/chat-intake-personas.test.ts
// ── Natural Intake v7 — whole conversations, replayed ────────────────────────
// Runs each scripted persona (tests/fixtures/chat-intake-personas.ts) through
// the real turn logic. A scripted stand-in plays the model: it extracts only
// what the persona would plausibly have said, and proposes the top open slot as
// the next question. So this pins the ORCHESTRATION — question counts, order,
// no repeats, a complete-or-flagged brief at the end — not model wording.

import { describe, it, expect } from 'vitest'
import { decideTurn, mergeNotes, preprocessTurn } from '../lib/chat-intake-turn'
import type { QuickReplyMeta, TurnResult } from '../lib/chat-intake-turn'
import type { PlannerOutput } from '../lib/chat-intake-plan-parse'
import { PLAYBACK_YES, UNKNOWN_REPLY_TEXT, briefStatus, rankMissing, slotSpec } from '../lib/chat-intake-brief'
import type { ChatDecisionState } from '../lib/types'
import { PERSONAS } from './fixtures/chat-intake-personas'
import type { Persona } from './fixtures/chat-intake-personas'

const CEILING = 9

function fakePlanner(p: Persona, pre: ChatDecisionState, text: string, first: boolean): PlannerOutput {
  const notes: PlannerOutput['notes'] = {}
  if (first) {
    notes.decisionKind      = p.kind
    notes.decisionStatement = p.statement
    notes.initialReaction   = 'act'
    notes.facts             = { ...p.volunteered }
  } else if (p.behavior === 'normal' && pre.pending?.kind === 'ask' && pre.pending.slotKey && text !== UNKNOWN_REPLY_TEXT) {
    notes.facts = { [pre.pending.slotKey]: text }     // a good extraction
  }
  // 'emotional': the model extracts nothing from a vent — the turn logic must still progress.
  const after = mergeNotes(pre, notes)
  const top   = rankMissing(after)[0]
  return {
    notes, answeredPending: null, aboutQuorum: false,
    next: top ? { slotKey: top.key, question: slotSpec(after.decisionKind, top.key)!.ask, chips: top.chips ?? [] } : null,
    playback: null,
    smartFriendQuestion: p.smartQuestion && !pre.smartFriendAsked ? p.smartQuestion : null,
  }
}

interface Run { exchanges: number; questions: number; askedSlots: string[]; final: ChatDecisionState; first: TurnResult; last: TurnResult }

function simulate(p: Persona, opts: { overEager?: boolean } = {}): Run {
  let state: ChatDecisionState = {}
  let text = p.opening
  let meta: QuickReplyMeta | null = null
  let exchanges = 0, questions = 0
  const askedSlots: string[] = []
  let first: TurnResult | null = null
  let last!: TurnResult

  for (;;) {
    exchanges += 1
    if (exchanges > 25) throw new Error(`${p.id}: did not terminate`)
    const pre = preprocessTurn(state, text, meta, { firstMessage: exchanges === 1, walkthrough: p.walkthrough, closingLine: 'CLOSE' })
    const planned = pre.shortCircuit ? null : fakePlanner(p, pre.state, text, exchanges === 1)
    // An over-eager model: every turn it flags every still-open slot as "unknown" (the live failure).
    if (planned && opts.overEager) {
      planned.notes.unknownFacts = rankMissing(mergeNotes(pre.state, planned.notes)).map(x => x.key)
      planned.notes.naSlots      = planned.notes.unknownFacts
    }
    const result = pre.shortCircuit ?? decideTurn(pre.state, {
      planner: planned,
      userText: text, dontKnow: pre.dontKnow, exchangeCount: exchanges, ceiling: CEILING, closingLine: 'CLOSE',
    })
    state = result.state
    last = result
    first ??= result

    if (result.action === 'ask')          { questions += 1; askedSlots.push(result.state.pending!.slotKey!) }
    if (result.action === 'smart_friend') { questions += 1 }
    if (result.readyToReflect) break

    // the persona's reply
    meta = null
    if (result.action === 'playback') { text = PLAYBACK_YES; meta = { kind: 'playback_yes' } }
    else if (p.behavior === 'evasive')   { text = UNKNOWN_REPLY_TEXT; meta = { kind: 'unknown', slotKey: state.pending?.slotKey } }
    else if (p.behavior === 'emotional') { text = 'I just cannot take it anymore, everything feels so heavy right now' }
    else if (result.action === 'smart_friend') { text = 'a real raise and a different manager' }
    else { text = p.answers[state.pending?.slotKey ?? ''] ?? 'not much to add'; meta = { kind: 'chip', slotKey: state.pending?.slotKey } }
  }
  return { exchanges, questions, askedSlots, final: state, first: first!, last }
}

describe('persona conversations', () => {
  for (const p of PERSONAS) {
    describe(p.id, () => {
      const run = simulate(p)

      it(`stays within ${p.maxQuestions} questions and ${p.maxExchanges} exchanges`, () => {
        expect(run.questions).toBeLessThanOrEqual(p.maxQuestions)
        expect(run.exchanges).toBeLessThanOrEqual(p.maxExchanges)
      })
      it('never asks the same slot twice', () => {
        expect(new Set(run.askedSlots).size).toBe(run.askedSlots.length)
      })
      it('ends with every required specific known or explicitly flagged unknown', () => {
        expect(briefStatus(run.final).ready).toBe(true)
        expect(run.final.phase).toBe('done')
        expect(run.last.readyToReflect).toBe(true)
      })
      it('v8: the chat wraps without a separate in-chat confirmation (the summary screen is the one confirmation)', () => {
        expect(run.final.playbackShown ?? 0).toBe(0)
      })
    })
  }

  it('POWER USER: a detailed opener skips straight past the specifics', () => {
    const run = simulate(PERSONAS.find(p => p.id === 'power-user-job-offer')!)
    expect(run.askedSlots).toEqual([])               // no specifics asked at all
    expect(run.first.action).toBe('smart_friend')    // one probe, then wrap
  })

  it('NOVICE (vague job exit): the very first question is the trigger, then the real specifics', () => {
    const run = simulate(PERSONAS.find(p => p.id === 'novice-quit-job')!)
    expect(run.askedSlots[0]).toBe('why_now')
    expect(run.askedSlots).toEqual(expect.arrayContaining(['role', 'next_step', 'runway', 'alternatives']))
    expect(run.final.facts?.runway).toBe('3\u20136 months')
  })

  it('NOVICE (vague move): asks which city, from and to, within the first two questions', () => {
    const run = simulate(PERSONAS.find(p => p.id === 'novice-vague-move')!)
    expect(run.askedSlots.slice(0, 2)).toContain('from_to')
    expect(run.final.facts?.from_to).toBe('Jaipur to Bengaluru')
  })

  it('RAMBLER: volunteering several specifics at once removes those questions', () => {
    const run = simulate(PERSONAS.find(p => p.id === 'rambler-relocation')!)
    for (const done of ['from_to', 'work_plan', 'who_moves', 'why_now']) expect(run.askedSlots).not.toContain(done)
  })

  it('EVASIVE: "not sure" is data — flagged, turned into to-dos, and never re-asked', () => {
    const run = simulate(PERSONAS.find(p => p.id === 'evasive-quit-job')!)
    expect(run.final.unknownFacts!.length).toBeGreaterThanOrEqual(4)
    expect(run.final.todos!.length).toBeGreaterThanOrEqual(2)
    expect(Object.values(run.final.askCounts ?? {}).every(n => n === 1)).toBe(true)
  })

  it('EMOTIONAL: progresses even though the model extracts nothing from a vent', () => {
    const run = simulate(PERSONAS.find(p => p.id === 'emotional-relationship')!)
    expect(run.exchanges).toBeLessThanOrEqual(9)
    expect(Object.keys(run.final.facts ?? {}).length).toBeGreaterThan(0)   // their own words were kept
  })

  it('WALK-THROUGH: always takes the gentle path, even for a messy opener', () => {
    const run = simulate(PERSONAS.find(p => p.id === 'walkthrough-novice')!)
    expect(run.final.walkthrough).toBe(true)
    expect(run.final.richness).toBe('sparse')
  })

  it('REGRESSION (live, Oct 2026): a model that marks every unasked slot "unknown" cannot make the chat end after one question', () => {
    const p   = PERSONAS.find(x => x.id === 'novice-job-offer')!
    const run = simulate(p, { overEager: true })
    // every required specific of a job offer is actually asked, in the person's own conversation
    expect(run.askedSlots).toEqual(expect.arrayContaining(['offer', 'leaving', 'hesitation', 'deadline', 'alternatives']))
    expect(run.exchanges).toBeGreaterThanOrEqual(6)
    // and what they said is kept as facts, not buried under "not sure yet"
    expect(run.final.facts?.offer).toMatch(/38 LPA/)
    expect(run.final.facts?.deadline).toBe('In a week or two')
    expect(run.final.unknownFacts ?? []).toEqual([])
  })
})

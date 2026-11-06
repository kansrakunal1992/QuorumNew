import { describe, it, expect } from 'vitest'
import { classifyKind, classifyDecisionText, SCORE_THRESHOLD } from '../lib/decision-taxonomy'
import { DECISION_KINDS, slotsFor } from '../lib/chat-intake-brief'
import { mergeNotes } from '../lib/chat-intake-turn'
import { DECISION_CORPUS, KNOWN_SILENT_MISSES } from './fixtures/decision-corpus'
import type { ChatDecisionState } from '../lib/types'

describe('decision-type coverage (seed corpus)', () => {
  it('every corpus phrase resolves to its expected kind (or stays silent)', () => {
    const wrong = DECISION_CORPUS
      .map(([text, expected]) => ({ text, expected, got: classifyKind(text) }))
      .filter(r => r.got !== r.expected)
    expect(wrong, `misrouted:\n${wrong.map(w => `  "${w.text}" expected ${w.expected} got ${w.got}`).join('\n')}`).toEqual([])
  })

  it('PRECISION: nothing in the "should stay silent" set is ever given a kind (a wrong kind asks the wrong questions)', () => {
    for (const [text, expected] of DECISION_CORPUS.filter(r => r[1] === null)) {
      expect(classifyKind(text), text).toBeNull()
    }
  })

  it('adding a decision type forces adding corpus rows: every kind except `other` has at least 5 examples', () => {
    for (const k of DECISION_KINDS.filter(k => k !== 'other')) {
      const n = DECISION_CORPUS.filter(r => r[1] === k).length
      expect(n, `kind ${k}`).toBeGreaterThanOrEqual(5)
    }
  })

  it('every kind the classifier can return has a full slot set (no kind silently falls back to `other`)', () => {
    const seen = new Set(DECISION_CORPUS.map(r => classifyKind(r[0])).filter(Boolean))
    for (const k of seen) expect(slotsFor(k!).filter(s => s.required).length).toBeGreaterThanOrEqual(3)
    // and none of the new kinds shares the generic `other` slot list
    for (const k of ['housing', 'health', 'family', 'team', 'product'] as const) {
      expect(slotsFor(k)).not.toEqual(slotsFor('other'))
    }
  })

  it('known gaps stay SILENT (planner decides) and are never answered with the wrong kind', () => {
    for (const [text, expected] of KNOWN_SILENT_MISSES) {
      const got = classifyKind(text)
      expect(got === null || got === expected, `"${text}" expected ${expected} or silence, got ${got}`).toBe(true)
    }
  })

  it('stays silent on empty / very short / junk input and never throws', () => {
    for (const v of [null, undefined, '', '   ', 'hi', 'ok?']) expect(classifyKind(v as string)).toBeNull()
    expect(() => classifyDecisionText('\u0000\u0001 ??? '.repeat(200))).not.toThrow()
  })

  it('reports a score at or above the threshold when it answers', () => {
    expect(classifyDecisionText('Should I buy the house now?')!.score).toBeGreaterThanOrEqual(SCORE_THRESHOLD)
  })

  it('REGRESSION: a home is no longer force-fit into the generic purchase kind', () => {
    expect(classifyKind('Should I buy the house now or keep looking?')).toBe('housing')
    expect(classifyKind('Should I buy a phone?')).toBe('purchase')
  })
})

describe('mergeNotes uses the classifier only as a fallback', () => {
  const noKind = { decisionStatement: '' } as never

  it('fills a missing kind from the person\'s own words', () => {
    const s = mergeNotes({} as ChatDecisionState, noKind, { userText: 'Should I buy the house now or keep looking?' })
    expect(s.decisionKind).toBe('housing')
  })
  it('NEVER overrides a kind the planner already chose', () => {
    const s = mergeNotes({} as ChatDecisionState, { decisionKind: 'money' } as never, { userText: 'Should I buy the house now?' })
    expect(s.decisionKind).toBe('money')
  })
  it('never overrides a kind that was already set on an earlier turn', () => {
    const s = mergeNotes({ decisionKind: 'career_exit' } as ChatDecisionState, noKind, { userText: 'Should I buy the house now?' })
    expect(s.decisionKind).toBe('career_exit')
  })
  it('leaves the kind unset when the words give no confident answer', () => {
    const s = mergeNotes({} as ChatDecisionState, noKind, { userText: 'Should I get a dog?' })
    expect(s.decisionKind).toBeUndefined()
  })
})

// tests/chat-intake-brief.test.ts
// ── Natural Intake v7 — the decision brief (pure logic) ──────────────────────
// Covers what decides which specifics get asked, in what order, and when the
// brief counts as filled. No network, no model calls.

import { describe, it, expect } from 'vitest'
import {
  briefStatus, briefRows, briefContextLines, buildPlaybackFallback, finalizeBrief,
  isAffirmative, isDontKnow, isNegative, markNotApplicable, markUnknown, rankMissing,
  sanitizeChips, scoreRichness, setFact, slotsFor, DECISION_KINDS,
} from '../lib/chat-intake-brief'
import type { ChatDecisionState } from '../lib/types'

const career: ChatDecisionState = { decisionKind: 'career_exit', richness: 'sparse' }

describe('slots per kind of decision', () => {
  it('every kind has required specifics and a shared "other routes" slot', () => {
    for (const k of DECISION_KINDS) {
      const req = slotsFor(k).filter(s => s.required)
      expect(req.length).toBeGreaterThanOrEqual(3)
      expect(req.length).toBeLessThanOrEqual(6)
      expect(req.some(s => s.key === 'alternatives')).toBe(true)
    }
  })
  it('a job exit asks about the job, what is next and the runway — the specifics the old chat never asked', () => {
    const keys = slotsFor('career_exit').filter(s => s.required).map(s => s.key)
    expect(keys).toEqual(expect.arrayContaining(['role', 'next_step', 'runway']))
  })
  it('a move asks which city, from and to', () => {
    expect(slotsFor('relocation').find(s => s.key === 'from_to')?.required).toBe(true)
  })
  it('never asks about feelings or "what would success look like"', () => {
    for (const k of DECISION_KINDS) {
      for (const s of slotsFor(k)) expect(s.ask).not.toMatch(/\b(feel|feeling|success)\b/i)
    }
  })
})

describe('question order', () => {
  it('a vague job exit leads with "what set this off", then the concrete specifics', () => {
    const order = rankMissing(career).map(s => s.key)
    expect(order[0]).toBe('why_now')
    expect(order.slice(1, 4)).toEqual(expect.arrayContaining(['role', 'next_step']))
  })
  it('a vague move leads with which city — a concrete specific beats the trigger question', () => {
    expect(rankMissing({ decisionKind: 'relocation', richness: 'sparse' })[0].key).toBe('from_to')
  })
  it('a detailed opener does not get the trigger boost', () => {
    expect(rankMissing({ decisionKind: 'career_exit', richness: 'rich' })[0].key).toBe('role')
  })
})

describe('known / unknown / not applicable', () => {
  it('is ready only when every required slot is resolved one way or another', () => {
    let s = { ...career }
    expect(briefStatus(s).ready).toBe(false)
    for (const slot of briefStatus(s).missing) s = setFact(s, slot.key, 'x')
    expect(briefStatus(s).ready).toBe(true)
  })
  it('"I don\u2019t know" counts as resolved, is remembered, and becomes a to-do', () => {
    const s = markUnknown(career, 'runway')
    expect(briefStatus(s).missing.map(m => m.key)).not.toContain('runway')
    expect(s.unknownFacts).toContain('runway')
    expect(s.todos?.[0]).toMatch(/expenses/i)
  })
  it('a later answer replaces an earlier "not sure" and clears its to-do', () => {
    const s = setFact(markUnknown(career, 'runway'), 'runway', '6 months')
    expect(s.unknownFacts).not.toContain('runway')
    expect(s.todos ?? []).toHaveLength(0)
  })
  it('does not downgrade a known fact to unknown', () => {
    expect(markUnknown(setFact(career, 'role', 'PM, 3 yrs'), 'role').unknownFacts ?? []).not.toContain('role')
  })
  it('marks a slot that does not apply, and hides it from the brief', () => {
    const s = markNotApplicable({ decisionKind: 'relocation' }, 'who_moves')
    expect(briefRows(s).some(r => r.key === 'who_moves')).toBe(false)
    expect(briefStatus(s).missing.map(m => m.key)).not.toContain('who_moves')
  })
  it('finalizeBrief flags anything still open so the brief is never silently incomplete', () => {
    const s = finalizeBrief(setFact(career, 'role', 'PM'))
    expect(briefStatus(s).ready).toBe(true)
    expect(s.unknownFacts?.length).toBeGreaterThanOrEqual(3)
  })
})

describe('brief output', () => {
  it('writes facts, unknowns and to-dos into the session context', () => {
    const s = finalizeBrief(setFact({ ...career }, 'role', 'PM at a bank, 3 years'))
    const text = briefContextLines(s).join('\n')
    expect(text).toMatch(/Kind of decision: Leaving a job/)
    expect(text).toMatch(/The job: PM at a bank/)
    expect(text).toMatch(/Not known yet/)
    expect(text).toMatch(/To find out/)
  })
  it('the fallback playback uses the person\u2019s specifics and ends with a question', () => {
    const s = setFact({ ...career, decisionStatement: 'Whether to leave my bank job' }, 'runway', '6 months')
    const t = buildPlaybackFallback(s)
    expect(t).toMatch(/leave my bank job/)
    expect(t).toMatch(/6 months/)
    expect(t.trim().endsWith('?')).toBe(true)
  })
})

describe('how much did the first message tell us', () => {
  it('short vague openers are sparse', () => {
    expect(scoreRichness('I want to quit my job').tier).toBe('sparse')
    expect(scoreRichness('Should I move to a different city').tier).toBe('sparse')
    expect(scoreRichness('').tier).toBe('sparse')
  })
  it('a detailed opener with numbers, names, options and constraints is rich', () => {
    const t = 'I am a product manager at HDFC in Mumbai, 4 years in. I have an offer from a Bengaluru startup at 40 lakh with equity, versus staying at 28 lakh. I have about 9 months of savings, my partner works in Mumbai, and the offer expires in two weeks. My manager is also pushing me to take a bigger team, so I am torn.'
    expect(scoreRichness(t).tier).toBe('rich')
  })
  it('a middling message is not rich', () => {
    expect(scoreRichness('I have been thinking about leaving my job at the bank because I am bored and the pay is not great').tier).not.toBe('rich')
  })
})

describe('reading short replies', () => {
  it('knows "I don\u2019t know" only when it is short', () => {
    for (const t of ['not sure', 'I don\u2019t know', "i don't know", 'no idea', 'idk', 'Not sure yet', 'dunno']) expect(isDontKnow(t)).toBe(true)
    expect(isDontKnow("I don't know whether to leave because my manager keeps moving the goalposts every week")).toBe(false)
    expect(isDontKnow('about six months')).toBe(false)
  })
  it('knows yes / no for a playback, but "yes, but..." is a correction', () => {
    expect(isAffirmative('Yes, that\u2019s right')).toBe(true)
    expect(isAffirmative('yep')).toBe(true)
    expect(isAffirmative('Yes but my partner is not coming')).toBe(false)
    expect(isNegative('Not quite')).toBe(true)
    expect(isNegative('nope')).toBe(true)
    expect(isNegative('no, I have another offer too')).toBe(true)
    expect(isNegative('about six months')).toBe(false)
  })
})

describe('chips', () => {
  it('keeps short, distinct tap-answers and drops "not sure" (the UI adds that)', () => {
    expect(sanitizeChips(['Trial it first', 'trial it first', 'Not sure', 'Visit first', 'x'.repeat(60)])).toEqual(['Trial it first', 'Visit first'])
  })
  it('falls back when the model gives fewer than two usable chips', () => {
    expect(sanitizeChips(['only one'], ['A', 'B'])).toEqual(['A', 'B'])
    expect(sanitizeChips(undefined, [])).toEqual([])
  })
})

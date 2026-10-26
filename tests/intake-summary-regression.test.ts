// tests/intake-summary-regression.test.ts
// ── Regression: a real summary screen (HR program manager, company to be acquired mid-2027) showed ──
//   • "Routes I think you're weighing: [object Object]; [object Object]…"
//   • an irrelevant question, "Has the idea been tested", for someone with no idea or venture
//   • "The main unknown, as I read it: runway" (a raw slot name)
//   • the refined decision twice, and a "Who's involved: You" block
// Each is pinned here so it cannot come back.

import { describe, it, expect } from 'vitest'
import { councilReadiness, criticalOpen, gapIsOpen, incomeAtRisk, jobSecured, optionLabels, readinessLine, summaryProvenance, ventureInPlay } from '../lib/chat-intake-depth'
import type { ChatDecisionState } from '../lib/types'

const STATEMENT = 'Should I quit my HR program management job I joined 3 weeks ago because the company will be acquired mid-2027, or should I stay through the acquisition and reassess?'
const ROUTES = ['Quit now and look for a new HR role', 'Stay through acquisition and reassess', 'Negotiate role clarity or protections with current employer', 'Seek an internal move or short-term contract elsewhere']

const hr = (o: Partial<ChatDecisionState> = {}): ChatDecisionState => ({
  decisionKind: 'career_exit', phase: 'done', stakes: 'medium',
  decisionStatement: STATEMENT,
  options: ROUTES.map((label, i) => ({ label, type: (['act', 'wait', 'experiment', 'gather_info'] as const)[i] })) as never,
  facts: { role: 'HR program management', next_step: 'Look for another job', why_now: 'Fear role will be redundant after acquisition; I want to avoid transition uncertainty', alternatives: 'I have asked the manager and others if role redundancy is a possibility', timeline: 'Joined 3 weeks ago; acquisition mid-2027' },
  cardAnswers: {
    next_step: { questionId: 'career_exit.next_step', slotKey: 'next_step', responseType: 'cards', selectedIds: ['next_step.job_search'], selectedLabels: ['Look for another job'], usedFreeText: false, selectedAll: false, exchange: 2 },
    why_now:   { questionId: 'career_exit.why_now', slotKey: 'why_now', responseType: 'cards', selectedIds: ['why_now.a1', 'why_now.a2'], selectedLabels: ['Fear role will be redundant after acquisition', 'I want to avoid transition uncertainty'], usedFreeText: false, selectedAll: false, exchange: 3 },
  },
  contradictions: ['Joined only 3 weeks ago but already looking to leave versus leaning to stay through acquisition to reassess'],
  stakeholders: [{ name: 'You' }] as never,
  ...o,
})
const keys = (a: { key: string }[]) => a.map(x => x.key)

describe('summary: options are shown as text, never as "[object Object]"', () => {
  it('lists the routes by their labels', () => {
    expect(optionLabels(hr())).toEqual(ROUTES)
    const reading = summaryProvenance(hr()).myReading.join('\n')
    expect(reading).not.toMatch(/object Object/)
    expect(reading).toContain('Quit now and look for a new HR role')
  })
  it('the routes now count as evidence (they were silently dropped before)', () => {
    // "family" appears ONLY in a route label; if option labels are read, the who-is-affected gap is no longer open.
    const s = hr({ options: [{ label: 'Talk it through with my family first', type: 'gather_info' }] as never, facts: { next_step: 'Take a proper break' } })
    expect(gapIsOpen({ ...s, stakes: 'high' }, 'who_affected')).toBe(false)
  })
})

describe('"Has the idea been tested" only for someone building something of their own', () => {
  it('is NOT asked when the decision merely mentions a company being acquired', () => {
    const s = hr({ unknownFacts: [] })
    expect(ventureInPlay(s)).toBe(false)
    expect(keys(criticalOpen(s))).not.toContain('validation')
    expect(gapIsOpen(s, 'validation')).toBe(false)
  })
  it('ignores everyday words that used to trigger it (company, product, idea, business, consult)', () => {
    for (const statement of [
      'Should I leave the company after the merger?', 'I am a product manager and the idea of staying makes me tired',
      'Should I leave before the business trip season?', 'My boss wants me to consult on a new account — should I quit?',
    ]) expect(ventureInPlay({ decisionKind: 'career_exit', decisionStatement: statement })).toBe(false)
  })
  it('IS asked on a genuine build-your-own path', () => {
    const s = hr({ decisionStatement: 'Should I quit and start something of my own?', facts: { next_step: 'Start something of my own' } })
    expect(ventureInPlay(s)).toBe(true)
    expect(keys(criticalOpen(s))).toContain('validation')
  })
})

describe('money runway follows income risk, in the right direction', () => {
  it('"Look for another job" (searching after leaving) puts income at risk, so runway IS essential', () => {
    const s = hr({ unknownFacts: [] })
    expect(incomeAtRisk(s)).toBe(true)
    expect(jobSecured(s)).toBe(false)
    expect(keys(criticalOpen(s))).toContain('runway')
  })
  it('a job already lined up still lets runway wait', () => {
    const s = hr({ facts: { ...hr().facts, next_step: 'Another job lined up' }, cardAnswers: undefined })
    expect(keys(criticalOpen(s))).not.toContain('runway')
  })
})

describe('summary wording', () => {
  it('never shows a bare slot name as "the main unknown"', () => {
    const s = hr({ unknowns: ['runway'], unknownFacts: ['runway'] })
    expect(summaryProvenance(s).myReading.join('\n')).not.toMatch(/main unknown/)
    expect(summaryProvenance(s).notKnown.map(x => x.label)).toContain('Money runway')
  })
  it('does show a real sentence as the main unknown', () => {
    const s = hr({ unknowns: ['Whether the acquirer will keep the HR program team intact'] })
    expect(summaryProvenance(s).myReading.join('\n')).toMatch(/main unknown, as I read it: Whether the acquirer/)
  })
  it('does not repeat the refined decision (it is already shown above the blocks)', () => {
    expect(summaryProvenance(hr()).myReading.join('\n')).not.toContain(STATEMENT)
  })
  it('keeps what they tapped under "What you chose", including model-written options they picked', () => {
    const chose = summaryProvenance(hr()).youChose
    expect(chose.find(c => c.label === 'What set this off')?.values).toEqual(['Fear role will be redundant after acquisition', 'I want to avoid transition uncertainty'])
  })
})

describe('readiness wording matches what is actually listed as open', () => {
  it('says "one thing" when exactly one thing is open (the screen listed only runway but said "a few things")', () => {
    const r = councilReadiness(hr({ unknownFacts: ['runway'], unknowns: ['runway'], facts: { ...hr().facts, people: 'Just me', validation: 'n/a' } }))
    expect(r.state).toBe('ready_with_unknowns')
    expect(r.unknown.length + r.deferred.length).toBe(1)
    expect(readinessLine(r)).toMatch(/One thing is still open/)
  })
  it('says "a few things" for several', () => {
    const r = { state: 'ready_with_unknowns' as const, criticalOpen: [], gaps: [], deferred: ['a', 'b'], unknown: ['c'], stakes: 'medium' as const }
    expect(readinessLine(r)).toMatch(/A few things are still open/)
  })
})

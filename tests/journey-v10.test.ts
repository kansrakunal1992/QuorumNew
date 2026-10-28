// tests/journey-v10.test.ts
// ── v10: the shortened journey (confirm → Council) ───────────────────────────
// Two kinds of test, both without a browser or a network:
//   1. the pure rules about which questions a person is ever shown before the Council (lib/checkpoint-launch.ts)
//      and who counts as "someone else" (lib/real-stakeholders.ts);
//   2. wiring guards that read the component source, so the things this change deliberately removed or moved
//      cannot quietly come back (the repo already does this — see tag-wiring-guardrail.test.ts).

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  autoConfirmed, blockingQuestions, buildExaminerRows, hasDerivedAnswer, isCouncilCritical, isResolved,
  needsCheck, questionsToAsk, type CheckpointQuestion,
} from '../lib/checkpoint-launch'
import { isSelfReference, realStakeholders } from '../lib/real-stakeholders'
import { isIntakeEvent, sanitizeIntakeProps } from '../lib/event-props'

const src = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf-8')

const q = (over: Partial<CheckpointQuestion> & { order: number }): CheckpointQuestion => ({
  text: `Question ${over.order}?`, gap: `gap${over.order}`, rule_id: null, criticality: 'important', ...over,
})

// The two questions from the walkthrough that prompted this change: both optional, one already answered in the chat.
const WALKTHROUGH: CheckpointQuestion[] = [
  q({ order: 1, criticality: 'important' }),
  q({ order: 2, criticality: 'important', derived: true, derivedAnswer: 'Daily routine and stability' }),
]

describe('which questions are ever shown before the Council', () => {
  it('only critical questions count — and R1/R7 redirect blocks are never put on this screen', () => {
    expect(isCouncilCritical(q({ order: 1, criticality: 'critical', rule_id: 'R2' }))).toBe(true)
    expect(isCouncilCritical(q({ order: 1, criticality: 'critical', rule_id: 'R3' }))).toBe(true)
    expect(isCouncilCritical(q({ order: 1, criticality: 'critical', rule_id: 'R1' }))).toBe(false)
    expect(isCouncilCritical(q({ order: 1, criticality: 'critical', rule_id: 'R7' }))).toBe(false)
    expect(isCouncilCritical(q({ order: 1, criticality: 'important' }))).toBe(false)
    expect(isCouncilCritical(q({ order: 1, criticality: 'optional' }))).toBe(false)
  })

  it('WALKTHROUGH: two optional questions mean no screen at all — straight to the Council', () => {
    expect(needsCheck(WALKTHROUGH)).toBe(false)
    expect(questionsToAsk(WALKTHROUGH)).toEqual([])
    expect(blockingQuestions(WALKTHROUGH, autoConfirmed(WALKTHROUGH), {})).toEqual([])
  })

  it('a critical question puts exactly that question in front of the person, and nothing else', () => {
    const qs = [...WALKTHROUGH, q({ order: 3, criticality: 'critical', rule_id: 'R3' })]
    expect(needsCheck(qs)).toBe(true)
    expect(questionsToAsk(qs).map(x => x.order)).toEqual([3])
  })
})

describe('what is recorded without a screen', () => {
  it('a chat-covered answer to a NON-critical question is recorded "from chat"; an unanswered one is recorded blank', () => {
    const conf = autoConfirmed(WALKTHROUGH)
    expect(conf).toEqual({ 2: true })
    const rows = buildExaminerRows(WALKTHROUGH, conf, {})
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ question_order: 1, response_text: null, derived_from_chat: false, criticality: 'important' })
    expect(rows[1]).toMatchObject({ question_order: 2, response_text: 'Daily routine and stability', derived_from_chat: true })
  })

  it('a chat-covered CRITICAL answer is never recorded silently: it needs the one-tap confirmation', () => {
    const qs = [q({ order: 1, criticality: 'critical', rule_id: 'R2', derived: true, derivedAnswer: 'My title matters to me' })]
    expect(autoConfirmed(qs)).toEqual({})
    expect(blockingQuestions(qs, {}, {})).toHaveLength(1)
    expect(blockingQuestions(qs, { 1: true }, {})).toHaveLength(0)   // after the person taps "These look right"
  })

  it('a typed answer wins over nothing, and resolves a critical gap', () => {
    const qs = [q({ order: 1, criticality: 'critical', rule_id: 'R3' })]
    expect(blockingQuestions(qs, {}, {})).toHaveLength(1)
    expect(blockingQuestions(qs, {}, { 1: '   ' })).toHaveLength(1)        // whitespace is not an answer
    expect(blockingQuestions(qs, {}, { 1: 'About 10 lakh a year' })).toHaveLength(0)
    expect(isResolved(qs[0], {}, { 1: 'x' })).toBe(true)
  })

  it('"Change this" (derived turned off) means the chat answer is no longer used', () => {
    const changed = q({ order: 1, criticality: 'critical', rule_id: 'R2', derived: false, derivedAnswer: 'old' })
    expect(isResolved(changed, { 1: true }, {})).toBe(false)
    expect(buildExaminerRows([changed], { 1: true }, { 1: 'new wording' })[0]).toMatchObject({ response_text: 'new wording', derived_from_chat: false })
  })

  it('rows keep the exact shape POST /api/examiner has always received', () => {
    const rows = buildExaminerRows([q({ order: 4, rule_id: 'R5', criticality: 'optional' })], {}, { 4: '  hi  ' })
    expect(Object.keys(rows[0]).sort()).toEqual([
      'criticality', 'derived_from_chat', 'question_order', 'question_text', 'response_text', 'rule_id', 'unknown_unknown_gap',
    ])
    expect(rows[0].response_text).toBe('hi')
  })

  it('an empty or whitespace derived answer does not count as covered', () => {
    expect(hasDerivedAnswer(q({ order: 1, derived: true, derivedAnswer: '  ' }))).toBe(false)
    expect(autoConfirmed([q({ order: 1, derived: true, derivedAnswer: '' })])).toEqual({})
  })
})

describe('"Ask You" bug — the person is not their own stakeholder', () => {
  it('recognises self references', () => {
    for (const n of ['You', 'you', ' Me ', 'myself', 'I', '', '   ']) expect(isSelfReference(n)).toBe(true)
    for (const n of ['Priya', 'My manager', 'Amit']) expect(isSelfReference(n)).toBe(false)
  })
  it('keeps real people, in order, and tolerates missing lists', () => {
    const list = [{ name: 'You' }, { name: 'Priya' }, { name: 'myself' }, { name: 'Amit' }] as never
    expect(realStakeholders(list).map(s => s.name)).toEqual(['Priya', 'Amit'])
    expect(realStakeholders(undefined)).toEqual([])
    expect(realStakeholders([{ name: 'You' }] as never)).toEqual([])
  })
})

describe('analytics for the new tap', () => {
  it('council_specificity_feedback is an allow-listed intake event and keeps only the id', () => {
    expect(isIntakeEvent('council_specificity_feedback')).toBe(true)
    expect(sanitizeIntakeProps('council_specificity_feedback', { specific: 'partly', note: 'a sentence of free text' })).toEqual({ specific: 'partly' })
    expect(sanitizeIntakeProps('council_launch_requested', { check_shown: false, auto_recorded: 1, lean_saved: true, free: 'no spaces allowed here' }))
      .toEqual({ check_shown: false, auto_recorded: 1, lean_saved: true })
  })
  it('the event is registered in the client type and the server allow-list', () => {
    expect(src('lib/track.ts')).toContain("'council_specificity_feedback'")
    expect(src('app/api/events/route.ts')).toContain("'council_specificity_feedback'")
  })
})

describe('wiring guards — what v10 removed or moved must stay that way', () => {
  const cp = src('components/DecisionCheckpoint.tsx')
  const sv = src('components/SessionView.tsx')

  it('the confirm screen: one primary Convene button, no separate reveal screen, no pre-Council prediction or insight', () => {
    expect(cp).toContain('Convene the Council')
    expect(cp).not.toMatch(/subPhase === 'reveal'/)
    expect(cp).not.toContain('Worth a closer look')
    expect(cp).not.toContain('We predict you')
    expect(cp).not.toContain('/api/chat-intake/insight')
    expect(cp).not.toContain('intake_summary_feedback')           // "did this capture it?" moved after the Council
  })

  it('lean + priority stay required: the session page refuses to start without them', () => {
    expect(cp).toContain('const canConfirm = !unified || (!!leanPick && !!priorityPick)')
    expect(sv).toContain('isUnifiedSessionEnabled() && !instinctLocked')
  })

  it('a retry never re-saves the lean on an already-closed chat', () => {
    expect(cp).toMatch(/if \(sessionIdRef\.current\) return sessionIdRef\.current/)
  })

  it('only critical questions can send the person to a screen', () => {
    expect(cp).toContain('blockingQuestions(qs, conf, answers).length > 0')
    expect(cp).toContain('autoConfirmed(qs)')
  })

  it('the prediction call is not made before Convene (no 15 s wait) — only on the "I\'m done" path', () => {
    const convene = cp.slice(cp.indexOf('async function handleConvene('), cp.indexOf('async function handleExamineContinue('))
    expect(convene).not.toContain('loadPrediction')
    expect(convene).not.toContain('predictionInFlight')
    expect(cp).toContain('if (unified && leanSavedRef.current) loadPrediction(sid)')
  })

  it('outreach and "I\'m done" are small links on the confirm screen; outreach filters out "You"', () => {
    expect(cp).toContain('realStakeholders(state.stakeholders)')
    expect(cp).toContain('onClick={handleOutreach}')
    expect(src('components/StakeholderOutreach.tsx')).toContain('realStakeholders(allStakeholders)')
  })

  it('the session page makes the prediction but does not show it, and its tour step is gone', () => {
    expect(sv).toMatch(/<QuorumPrediction\s+hidden/)
    expect(sv).not.toContain('data-tour-id="council-prediction"')
    expect(sv).not.toContain("id:             'council-prediction'")
    expect(src('components/QuorumPrediction.tsx')).toContain('if (hidden) return null')
  })

  it('the graph teaser now sits below the six advisors, not above the Council', () => {
    const teaser   = sv.indexOf('<DecisionGraph')
    const personas = sv.indexOf('4. Six persona panels')
    const synth    = sv.indexOf('<SynthesisCard')
    const capture  = sv.indexOf('Capture Position — after personas')
    expect(teaser).toBeGreaterThan(-1)
    expect(teaser).toBeGreaterThan(synth)
    expect(teaser).toBeGreaterThan(personas)
    expect(teaser).toBeLessThan(capture)
  })

  it('the after-Council additions: the specificity tap, and reveal copy that no longer mentions a hypothesis the person never saw', () => {
    expect(sv).toContain('<SpecificityCheck sessionId={session.id} />')
    expect(sv).toMatch(/synthesisDone && \(totalSessionCount \?\? 0\) <= 5/)
    expect(src('components/PredictionReveal.tsx')).not.toContain("seen Quorum's hypothesis")
  })

  it('landing: a brand-new visitor does not get the sign-in card (header link remains); a returning one does; the visitor pill is untouched', () => {
    const ci = src('components/ChatIntake.tsx')
    expect(ci).toContain('{!hasEmail && historySessions.length > 0 && (')
    expect(ci).toContain("historySessions.length > 0 ? 'Keep my record' : 'Sign in'")
    expect(src('components/VisitorCounter.tsx')).toContain('people already here')
  })

  it('job offer: the negotiables card and question are gone; the deadline card stays', () => {
    const cards = src('lib/chat-intake-cards.ts')
    expect(cards).not.toContain("'neg_pay'")
    expect(cards).toContain("deadline: { mode: 'single', options: [['days', 'Within days']")
    expect(src('lib/chat-intake-brief.ts')).not.toContain('counter or negotiate')
  })
})

// tests/chat-intake-v9.test.ts
// ── Natural Intake v9 — depth, readiness, reflection, combined steps, provenance ──
// Scripted-logic tests only (no live model): they pin the rules the planner's output is held to.

import { describe, it, expect } from 'vitest'
import {
  ceilingFor, councilReadiness, criticalOpen, deferrableOpen, duplicatesKnown, effectiveStakes, gapIsOpen,
  readinessLine, summaryProvenance,
} from '../lib/chat-intake-depth'
import { composeReply, reflectionDue, validateReflection } from '../lib/chat-intake-reflection'
import { closeTurn, decideTurn, preprocessTurn } from '../lib/chat-intake-turn'
import { buildCardGroup, cardContextLines, metaFor, serializeSelection } from '../lib/chat-intake-cards'
import { assembleSessionInput } from '../lib/chat-intake-state'
import type { PlannerOutput } from '../lib/chat-intake-plan-parse'
import type { ChatDecisionState, DecisionKind } from '../lib/types'

const CLOSE = 'CLOSE'
const keys = (a: { key: string }[]) => a.map(x => x.key)
const career = (o: Partial<ChatDecisionState> = {}): ChatDecisionState => ({ decisionKind: 'career_exit', phase: 'gathering', facts: {}, ...o })
const plan = (o: Partial<PlannerOutput> = {}): PlannerOutput => ({ notes: {}, answeredPending: null, aboutQuorum: false, next: null, playback: null, smartFriendQuestion: null, ...o } as PlannerOutput)

describe('depth: stakes set a safety ceiling, never a quota', () => {
  it('scales the ceiling with stakes and never raises the base', () => {
    expect(ceilingFor(career({ stakes: 'low' }), 9)).toBe(5)
    expect(ceilingFor(career({ stakes: 'medium' }), 9)).toBe(7)
    expect(ceilingFor(career({ stakes: 'high' }), 9)).toBe(9)
    expect(ceilingFor(career({ stakes: 'high' }), 6)).toBe(6)
  })
  it('irreversibility raises stakes; "somewhat reversible" lifts low to medium', () => {
    expect(effectiveStakes(career({ stakes: 'low', reversibility: 'irreversible' }))).toBe('high')
    expect(effectiveStakes(career({ stakes: 'low', reversibility: 'somewhat_reversible' }))).toBe('medium')
    expect(effectiveStakes(career({}))).toBe('medium')
  })
})

describe('depth: critical fields are conditional, not universally deferred', () => {
  it('runway is NOT deferred when the chosen route puts income at risk', () => {
    const s = career({ stakes: 'medium', facts: { next_step: 'Start something of my own' } })
    expect(keys(criticalOpen(s))).toContain('runway')
    expect(keys(deferrableOpen(s))).not.toContain('runway')
  })
  it('runway IS deferred when a job is already lined up', () => {
    const s = career({ stakes: 'medium', facts: { next_step: 'Another job lined up' } })
    expect(keys(criticalOpen(s))).not.toContain('runway')
    expect(keys(deferrableOpen(s))).toContain('runway')
  })
  it('runway stays critical before the person has said what they would do (feasibility unknown)', () => {
    expect(keys(criticalOpen(career({ stakes: 'medium' })))).toContain('runway')
  })
  it('product validation becomes critical only for a build-my-own path above low stakes, and only if not already said', () => {
    const own = career({ stakes: 'medium', facts: { next_step: 'Start something of my own' } })
    expect(keys(criticalOpen(own))).toContain('validation')
    expect(keys(criticalOpen({ ...own, stakes: 'low' }))).not.toContain('validation')
    expect(keys(criticalOpen({ ...own, facts: { ...own.facts, why_now: 'I have not spoken to customers yet' } }))).not.toContain('validation')
    expect(keys(criticalOpen(career({ stakes: 'medium', facts: { next_step: 'Look for another job' } })))).not.toContain('validation')
  })
  it('who depends on you is asked when income is at risk — and suppressed when they already said', () => {
    const s = career({ stakes: 'medium', facts: { next_step: 'Take a proper break' } })
    expect(keys(criticalOpen(s))).toContain('people')
    expect(keys(criticalOpen({ ...s, facts: { ...s.facts, why_now: 'My wife and one-year-old son rely on it' } }))).not.toContain('people')
  })
  it('a low-stakes decision does not need its lower-weight required slots; a high-stakes one keeps them all', () => {
    const low  = { decisionKind: 'purchase' as DecisionKind, stakes: 'low' as const, facts: {} }
    const high = { decisionKind: 'purchase' as DecisionKind, stakes: 'high' as const, facts: {} }
    expect(keys(criticalOpen(low)).length).toBeLessThan(keys(criticalOpen(high)).length)
    expect(keys(deferrableOpen(low)).length).toBeGreaterThan(0)
  })
})

describe('readiness and the wrap', () => {
  it('wrapping records gaps (essential, still open) separately from not-asked (not material)', () => {
    const s = career({ stakes: 'low', facts: { next_step: 'Another job lined up' } })
    const r = closeTurn(s, CLOSE)
    expect(r.state.gapSlots?.length).toBeGreaterThan(0)          // role etc. were essential and never answered
    expect(r.state.deferredSlots).toContain('runway')            // not material: not asked
    expect(r.state.unknownFacts).not.toContain('runway')         // never presented as "the person doesn't know"
    expect(r.state.closedBy).toBe('ceiling')
  })
  it('readiness copy is honest about gaps', () => {
    const ready = councilReadiness(career({ stakes: 'low', facts: { role: 'a', next_step: 'x', runway: 'y', why_now: 'z', alternatives: 'q' } }))
    expect(ready.state).toBe('ready')
    expect(readinessLine(ready)).toMatch(/enough context for the Council/)
    const gap = councilReadiness(closeTurn(career({ stakes: 'high' }), CLOSE).state)
    expect(gap.state).toBe('closed_with_gaps')
    expect(readinessLine(gap)).toMatch(/won.t guess|rather than guess/)
  })
  it('the ceiling is a stop, not a quota: a rich opener wraps with no questions asked', () => {
    const s = career({ stakes: 'medium', facts: { role: 'a', next_step: 'Another job lined up', why_now: 'z', alternatives: 'q' } })
    const out = decideTurn(s, { planner: plan(), userText: 'x', dontKnow: false, exchangeCount: 1, ceiling: 9, closingLine: CLOSE })
    expect(out.action).toBe('close')
  })
})

describe('the extra question is gated (smart friend)', () => {
  const full = career({ stakes: 'high', facts: { role: 'a', next_step: 'Take a break', runway: 'o12', why_now: 'z', alternatives: 'q', people: 'wife' } })
  const ask = (s: ChatDecisionState, p: Partial<PlannerOutput>, asked: string[] = []) =>
    decideTurn(s, { planner: plan(p), userText: 'x', dontKnow: false, exchangeCount: 3, ceiling: 9, closingLine: CLOSE, asked })
  it('never on a low-stakes decision', () => {
    expect(ask({ ...full, stakes: 'low' }, { smartFriendQuestion: 'What would make you stay in the role?', smartFriendGap: 'reversibility' }).action).toBe('close')
  })
  it('needs a named gap from the fixed list', () => {
    expect(ask(full, { smartFriendQuestion: 'What would make you stay in the role?' }).action).toBe('close')
    expect(ask(full, { smartFriendQuestion: 'What would make you stay in the role?', smartFriendGap: 'vibes' }).action).toBe('close')
  })
  it('asks when the named gap is genuinely open', () => {
    expect(ask(full, { smartFriendQuestion: 'How hard would this be to undo?', smartFriendGap: 'reversibility' }).action).toBe('smart_friend')
  })
  it('does not ask about a gap already on file', () => {
    expect(ask({ ...full, reversibility: 'reversible' }, { smartFriendQuestion: 'How hard would this be to undo?', smartFriendGap: 'reversibility' }).action).toBe('close')
    expect(gapIsOpen(full, 'feasibility')).toBe(false)            // runway is known
    expect(gapIsOpen(full, 'who_affected')).toBe(false)           // people is known
  })
  it('does not ask about money when the path made runway non-material', () => {
    const s = career({ stakes: 'medium', facts: { role: 'a', next_step: 'Another job lined up', why_now: 'z', alternatives: 'q' } })
    expect(gapIsOpen(s, 'feasibility')).toBe(false)
  })
  it('does not repeat a question already asked or already known', () => {
    expect(duplicatesKnown('How long could your savings last without a salary?', career({ facts: { runway: 'My savings would last over a year without a salary' } }))).toBe(true)
    expect(ask(full, { smartFriendQuestion: 'How hard would this be to undo, realistically?', smartFriendGap: 'reversibility' }, ['How hard would this be to undo, realistically?']).action).toBe('close')
  })
  it('answering a question about a tension settles it: the person\'s words replace the inference', () => {
    const s: ChatDecisionState = { ...full, contradictions: ['Wants to build this for years, but would stay if the job were manageable'], smartFriendAsked: true,
      pending: { kind: 'smart_friend', slotKey: null, chips: [], gap: 'tension' } }
    const out = decideTurn(s, { planner: plan(), userText: 'I would leave anyway, the job is not the point', dontKnow: false, exchangeCount: 4, ceiling: 9, closingLine: CLOSE })
    expect(out.state.contradictions).toBeUndefined()
    expect(out.state.userCorrections?.join(' ')).toMatch(/Clarified: I would leave anyway/)
  })
})

describe('reflections are grounded, provisional and never generic', () => {
  const ctx = { userText: 'Burnout or unhappiness; I have wanted to build something for a long time. I still like parts of my work.', selectedLabels: ['Burnout or unhappiness', 'I have wanted this for a long time'], onFile: [] as string[] }
  const good = 'Two things may be tangled here: needing relief from this job, and wanting to build something of your own. They can point to different moves.'
  it('accepts a grounded distinction', () => { expect(validateReflection(good, ctx).ok).toBe(true) })
  const bad: Array<[string, string]> = [
    ['generic_ack', 'Got it, that is really helpful to know and I appreciate you sharing it with me today.'],
    ['is_a_question', 'Two things may be tangled here: relief from the job and wanting to build, which one is it?'],
    ['recommends', 'You should probably take the break first, because that could be the best option for you right now.'],
    ['mind_reading', 'Deep down you are really afraid of failing, but you may be hiding it behind the burnout from your work.'],
    ['not_provisional', 'Relief from this job and wanting to build something of your own are different things, separate in your answers.'],
    ['not_grounded', 'Decisions of this size often involve a tension between security and freedom, which can pull in opposite directions.'],
    ['repeats_labels', 'Burnout or unhappiness, and wanted this for a long time, may be what you chose between those two.'],
    ['too_short', 'This may be tangled.'],
  ]
  for (const [reason, text] of bad) {
    it(`rejects: ${reason}`, () => { const v = validateReflection(text, ctx); expect(v.ok).toBe(false); if (!v.ok) expect(v.reason).toBe(reason) })
  }
  it('at most one question turn in a row may go out without one (from the second message)', () => {
    expect(reflectionDue(1, 0)).toBe(false)
    expect(reflectionDue(2, 1)).toBe(true)
    expect(reflectionDue(3, 0)).toBe(false)
    expect(reflectionDue(4, 1)).toBe(true)
  })
  it('composes reflection above the question; a rejected one is omitted, never replaced by filler', () => {
    expect(composeReply('R.', 'Q?')).toBe('R.\n\nQ?')
    expect(composeReply(null, 'Q?')).toBe('Q?')
    const s = career({ stakes: 'high' })
    const withR = decideTurn(s, { planner: plan({ reflection: good, next: { slotKey: 'why_now', question: 'What set this off right now?', chips: [] } }), userText: ctx.userText, dontKnow: false, exchangeCount: 2, ceiling: 9, closingLine: CLOSE })
    expect(withR.reply.startsWith(good)).toBe(true)
    expect(withR.reflection?.shown).toBe(true)
    expect(withR.state.turnsSinceReflection).toBe(0)
    const without = decideTurn(s, { planner: plan({ reflection: 'Got it, thanks so much for sharing that with me, it really does help me understand things.', next: { slotKey: 'why_now', question: 'What set this off right now?', chips: [] } }), userText: ctx.userText, dontKnow: false, exchangeCount: 2, ceiling: 9, closingLine: CLOSE })
    expect(without.reply).toBe('What set this off right now?')
    expect(without.reflection).toEqual({ shown: false, reason: 'generic_ack' })
    expect(without.state.turnsSinceReflection).toBe(1)
  })
})

describe('one step, two related card groups (progressive)', () => {
  const s0 = career({ stakes: 'high', facts: { role: 'Product manager' } })
  const ask = decideTurn(s0, { planner: plan({ next: { slotKey: 'why_now', question: 'What is making you consider leaving now?', chips: [] } }), userText: 'x', dontKnow: false, exchangeCount: 1, ceiling: 9, closingLine: CLOSE })
  it('pairs the question with the next essential one that also has cards', () => {
    expect(ask.quickReplies.card?.slotKey).toBe('why_now')
    expect(ask.quickReplies.companion?.slotKey).toBeTruthy()
    expect(ask.quickReplies.companion?.slotKey).not.toBe('why_now')
    expect(ask.state.pending?.companion?.slotKey).toBe(ask.quickReplies.companion?.slotKey)
  })
  it('never pairs a free-text question, a deferred slot, or an already-answered one', () => {
    const c = ask.quickReplies.companion!
    expect(c.options.length).toBeGreaterThanOrEqual(2)
    expect(keys(criticalOpen(s0))).toContain(c.slotKey)
  })
  it('records BOTH answers from one reply; the primary capture never swallows the companion text', () => {
    const g = ask.quickReplies.card!, c = ask.quickReplies.companion!
    const sel1 = { selectedIds: [g.options[0].id], freeText: '', special: null as null }
    const sel2 = { selectedIds: [c.options[0].id], freeText: 'Not spoken to anyone yet.', special: null as null }
    const t1 = serializeSelection(g, sel1), t2 = serializeSelection(c, sel2)
    const text = `${t1}\n${t2}`
    const pre = preprocessTurn(ask.state, text, { kind: 'cards', slotKey: g.slotKey, card: metaFor(g, sel1), companion: { text: t2, card: metaFor(c, sel2) } }, { firstMessage: false, closingLine: CLOSE, exchange: 2 })
    expect(pre.primaryText).toBe(t1)
    expect(pre.state.cardAnswers?.[c.slotKey]?.selectedLabels.length).toBe(1)
    expect(pre.state.facts?.[c.slotKey]).toBe(t2)
    const out = decideTurn(pre.state, { planner: null, userText: text, dontKnow: pre.dontKnow, exchangeCount: 2, ceiling: 9, closingLine: CLOSE, captureText: pre.primaryText })
    expect(out.state.facts?.[g.slotKey]).toBe(t1)
    expect(out.state.facts?.[g.slotKey]).not.toMatch(/Not spoken/)
    expect(pre.cardNote).toMatch(/also answered a second question/)
  })
  it('"Not sure" on the second group becomes an unknown with a to-do; the first is unaffected', () => {
    const g = ask.quickReplies.card!, c = ask.quickReplies.companion!
    const sel1 = { selectedIds: [g.options[0].id], freeText: '', special: null as null }
    const sel2 = { selectedIds: [], freeText: '', special: 'not_sure' as const }
    const t1 = serializeSelection(g, sel1), t2 = serializeSelection(c, sel2)
    const pre = preprocessTurn(ask.state, `${t1}\n${t2}`, { kind: 'cards', slotKey: g.slotKey, card: metaFor(g, sel1), companion: { text: t2, card: metaFor(c, sel2) } }, { firstMessage: false, closingLine: CLOSE, exchange: 2 })
    expect(pre.state.unknownFacts).toContain(c.slotKey)
    expect(pre.dontKnow).toBe(false)
  })
  it('a typed reply that ignores the cards leaves the companion open (not lost, not faked)', () => {
    const pre = preprocessTurn(ask.state, 'Honestly, burnout.', null, { firstMessage: false, closingLine: CLOSE, exchange: 2 })
    const c = ask.quickReplies.companion!
    expect(pre.state.facts?.[c.slotKey]).toBeUndefined()
    expect(keys(criticalOpen(pre.state))).toContain(c.slotKey)
  })
})

describe('summary provenance and corrections', () => {
  const s: ChatDecisionState = career({
    stakes: 'medium', decisionStatement: 'Should I leave now to recover and build, or stage it?', options: [{ label: 'Quit and build', type: 'act' }, { label: 'Staged transition', type: 'experiment' }] as never,
    facts: { role: 'Product manager', why_now: 'Burnout or unhappiness', next_step: 'Take a proper break' },
    cardAnswers: { why_now: { questionId: 'career_exit.why_now', slotKey: 'why_now', responseType: 'cards', selectedIds: ['why_now.burnout'], selectedLabels: ['Burnout or unhappiness'], usedFreeText: true, selectedAll: false, exchange: 2 } },
    contradictions: ['Likes parts of the job, yet wants to leave'], skippedSlots: ['runway'], unknownFacts: ['runway'], deferredSlots: ['alternatives'],
  })
  it('separates what was typed, what was tapped, Quorum\'s reading, and what is open', () => {
    const p = summaryProvenance(s)
    expect(p.youTold.map(x => x.label)).toContain('The job')
    expect(p.youChose[0].values).toEqual(['Burnout or unhappiness'])
    expect(p.youChose[0].addedWords).toBe(true)
    expect(p.myReading.join(' ')).toMatch(/possible tension/i)
    expect(p.notKnown.map(x => x.why)).toEqual(expect.arrayContaining(['skipped', 'not_asked']))
  })
  it('the person\'s own rewrite is authoritative and reaches the Council with a note and the superseded framing', () => {
    const { decisionText, contextText } = assembleSessionInput(s, [{ id: '', chat_intake_id: 'c', role: 'user', content: 'Should I quit and start something of my own?', turn_order: 0, created_at: '' }], { editedDecision: 'Should I take six months off before deciding anything?' })
    expect(decisionText).toBe('Should I take six months off before deciding anything?')
    expect(contextText).toMatch(/rewrote Quorum.s framing/)
    expect(contextText).toMatch(/earlier framing \(superseded/)
    expect(contextText).toMatch(/Should I quit and start something of my own\?/)      // their original wording is kept
    expect(contextText).toMatch(/Not asked in intake/)                                  // deferred, labelled
    expect(contextText).toMatch(/Chosen from options/)                                  // tapped selections survive
  })
  it('context lines never contain free text and label inferences as inferences', () => {
    const t = cardContextLines(s).join('\n')
    expect(t).toMatch(/Quorum.s reading, not confirmed/)
    expect(t).not.toMatch(/secret/)
  })
})

describe('cards stay relevant after the change', () => {
  it('validation gets its own approved single-choice card', () => {
    const g = buildCardGroup({ kind: 'career_exit', slot: { key: 'validation', label: 'x', ask: 'q?', chips: [], weight: 50, required: false } as never, question: 'q?' })
    expect(g?.options.map(o => o.id)).toContain('validation.not_yet')
    expect(g?.maxSelections).toBe(1)
  })
})

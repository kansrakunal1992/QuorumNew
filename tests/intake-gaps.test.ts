// tests/intake-gaps.test.ts
// ── Natural Intake v9 — closing the code-closable gaps (4 duplicates, 5 reflections, 6 corrections, 7 launch, 10 static) ──
// Scripted only. What these CANNOT prove (live model quality, real phones, production traffic) is listed in
// docs/INTAKE_LIVE_REVIEW_PROTOCOL.md.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { duplicatesKnown, gapIsOpen, summaryProvenance } from '../lib/chat-intake-depth'
import { reflectionPrint, validateReflection } from '../lib/chat-intake-reflection'
import { CARD_PRESETS, cardContextLines } from '../lib/chat-intake-cards'
import { decideTurn } from '../lib/chat-intake-turn'
import { CLAIM_STALE_MS, claimCheckpoint, internalSessionHeaders, releaseClaim } from '../lib/chat-intake-checkpoint-helpers'
import type { PlannerOutput } from '../lib/chat-intake-plan-parse'
import type { ChatDecisionState } from '../lib/types'

const career = (o: Partial<ChatDecisionState> = {}): ChatDecisionState => ({ decisionKind: 'career_exit', phase: 'gathering', facts: {}, ...o })
const plan = (o: Partial<PlannerOutput> = {}): PlannerOutput => ({ notes: {}, answeredPending: null, aboutQuorum: false, next: null, playback: null, smartFriendQuestion: null, ...o } as PlannerOutput)

describe('4 · duplicate detection tolerates paraphrase (lexical, not semantic)', () => {
  const s = career({ facts: { runway: 'My savings would last over a year without a salary', people: 'My wife and one-year-old son depend on me' } })
  const dup: Array<[string, string]> = [
    ['How long could your cash last without pay?', 'cash/pay vs savings/salary'],
    ['How many months of income do you have saved up?', 'months/income vs year/salary'],
    ['Does your wife and son rely on you?', 'same people named'],
  ]
  for (const [q, why] of dup) it(`flags: ${why}`, () => expect(duplicatesKnown(q, s)).toBe(true))
  it('does not flag a genuinely different question', () => {
    expect(duplicatesKnown('Which city would you move to if you left?', s)).toBe(false)
    expect(duplicatesKnown('Has anyone tried the product yet?', s)).toBe(false)
  })
  it('a paraphrase the word check misses is still caught by the slot-level gap check', () => {
    // "Does anyone rely on you financially?" shares no words with the stored fact — but the gap itself is closed by what is on file.
    expect(duplicatesKnown('Does anyone rely on you financially?', s)).toBe(false)
    expect(gapIsOpen({ ...s, stakes: 'high' }, 'who_affected')).toBe(false)
    expect(gapIsOpen({ ...s, stakes: 'high' }, 'feasibility')).toBe(false)
  })
  it('repeats of Quorum\'s own earlier question are caught', () => {
    expect(duplicatesKnown('What would your savings cover without a salary?', career(), ['How long would your savings last without a salary?'])).toBe(true)
  })
})

describe('5 · reflections: golden set + no near-repeats', () => {
  const ctx = { userText: 'I still like parts of my work but I have no energy left. I have been thinking about the product for two years and have not spoken to customers.', selectedLabels: ['Burnout or unhappiness', 'I have wanted this for a long time'], onFile: ['Takes a break first', 'Savings last over a year'] }
  const good = [
    'Two things may be tangled here: needing relief from this job, and wanting to build the product. They can point to different moves.',
    'You still like parts of the work yet have no energy left, which could mean the job is not the whole problem.',
    'The product has been on your mind for two years but never met a customer, so the real unknown may be demand rather than courage.',
    'Having savings for over a year may change what a break costs, though it does not tell us whether the idea itself holds up.',
    'It sounds like recovering and building might be competing for the same energy, which the Council could treat as separate questions.',
  ]
  const bad: Array<[string, string]> = [
    ['Got it, thank you so much for sharing all of that with me today, it genuinely helps.', 'generic_ack'],
    ['You should take the break first because that is clearly the right move for you here.', 'recommends'],
    ['Deep down you are afraid of failing and that fear may be driving the whole burnout story.', 'mind_reading'],
    ['Which matters more to you right now, getting relief from the job or building the product?', 'is_a_question'],
    ['Decisions like this often involve a trade-off between security and freedom that can pull in opposite directions.', 'not_grounded'],
    ['Burnout or unhappiness, and wanted this for a long time, may be the two things you picked.', 'repeats_labels'],
    ['The job and the product are separate topics in what you wrote about your situation.', 'not_provisional'],
  ]
  for (const t of good) it(`accepts: ${t.slice(0, 48)}…`, () => { const v = validateReflection(t, ctx); expect(v.ok).toBe(true) })
  for (const [t, reason] of bad) it(`rejects (${reason}): ${t.slice(0, 40)}…`, () => { const v = validateReflection(t, ctx); expect(v.ok).toBe(false); if (!v.ok) expect(v.reason).toBe(reason) })

  it('rejects a near-repeat of an earlier reflection, accepts a different one', () => {
    const prints = [reflectionPrint(good[0])]
    const again = validateReflection('Two things may be tangled here: needing relief from this job, and wanting to build your product. They could point to different moves.', { ...ctx, previousPrints: prints })
    expect(again.ok).toBe(false); if (!again.ok) expect(again.reason).toBe('repeats_earlier')
    expect(validateReflection(good[2], { ...ctx, previousPrints: prints }).ok).toBe(true)
  })
  it('stores hashes, never text', () => {
    const p = reflectionPrint(good[0])
    expect(p.length).toBeGreaterThan(3)
    expect(p.join(' ')).not.toMatch(/tangled|relief|product/)
  })
  it('decideTurn remembers prints (max 3) and refuses the repeat on the next turn', () => {
    const s0 = career({ stakes: 'high' })
    const next = { slotKey: 'why_now', question: 'What set this off right now?', chips: [] }
    const a = decideTurn(s0, { planner: plan({ reflection: good[0], next }), userText: ctx.userText, dontKnow: false, exchangeCount: 2, ceiling: 9, closingLine: 'C' })
    expect(a.reflection?.shown).toBe(true)
    expect(a.state.reflectionPrints?.length).toBe(1)
    const b = decideTurn({ ...a.state, askCounts: {} }, { planner: plan({ reflection: good[0], next }), userText: ctx.userText, dontKnow: false, exchangeCount: 4, ceiling: 9, closingLine: 'C' })
    expect(b.reflection).toEqual({ shown: false, reason: 'repeats_earlier' })
  })
})

describe('6 · a later correction supersedes an earlier TAP without losing it', () => {
  const tapped = (): ChatDecisionState => career({
    stakes: 'high', facts: { why_now: 'Burnout or unhappiness' },
    cardAnswers: { why_now: { questionId: 'career_exit.why_now', slotKey: 'why_now', responseType: 'cards', selectedIds: ['why_now.burnout'], selectedLabels: ['Burnout or unhappiness'], usedFreeText: false, selectedAll: false, exchange: 2 } },
  })
  const turn = (notes: PlannerOutput['notes']) => decideTurn(tapped(), { planner: plan({ notes }), userText: 'Actually it is not burnout, I just want to build this.', dontKnow: false, exchangeCount: 5, ceiling: 9, closingLine: 'C' })

  it('needs BOTH signals: the model names the slot and writes a new value for it', () => {
    expect(turn({ correctedSlots: ['why_now'], facts: { why_now: 'Not burnout — I want to build this' } }).state.cardAnswers!.why_now.superseded).toBe(true)
    expect(turn({ facts: { why_now: 'Not burnout — I want to build this' } }).state.cardAnswers!.why_now.superseded).toBeUndefined()
    expect(turn({ correctedSlots: ['why_now'] }).state.cardAnswers!.why_now.superseded).toBeUndefined()
    expect(turn({ correctedSlots: ['nonsense'], facts: { nonsense: 'x' } }).state.cardAnswers!.why_now.superseded).toBeUndefined()
  })
  it('the newer words lead the summary and the tap stays visible', () => {
    const s = turn({ correctedSlots: ['why_now'], facts: { why_now: 'Not burnout — I want to build this' } }).state
    const p = summaryProvenance(s)
    expect(p.youChose.map(x => x.label)).not.toContain('Why now')
    expect(p.youTold.map(x => x.value).join(' ')).toMatch(/Not burnout.*you earlier chose: Burnout or unhappiness/)
  })
  it('the Council is told which taps were changed, and they are not listed as current choices', () => {
    const s = turn({ correctedSlots: ['why_now'], facts: { why_now: 'Not burnout — I want to build this' } }).state
    const text = cardContextLines(s).join('\n')
    expect(text).toMatch(/Earlier taps the person later changed/)
    expect(text).toMatch(/earlier chose Burnout or unhappiness/)
    expect(text).not.toMatch(/Chosen from options[^]*Burnout or unhappiness/)
  })
})

describe('7 · launch helpers (fake database, no network)', () => {
  const db = (result: { data: unknown[] | null; error: { message: string } | null } | 'throw', log: string[] = []) => ({
    from: (t: string) => ({
      update: (v: Record<string, unknown>) => {
        log.push(`update:${t}:${JSON.stringify(v)}`)
        const chain: any = {
          eq: (c: string, id: string) => { log.push(`eq:${c}=${id}`); return Object.assign(Promise.resolve({}), { or: (f: string) => { log.push(`or:${f}`); return { select: () => (result === 'throw' ? Promise.reject(new Error('x')) : Promise.resolve(result)) } } }) },
        }
        return chain
      },
    }),
  })
  it('claims when the conditional write matched a row', async () => { expect(await claimCheckpoint(db({ data: [{ id: 'a' }], error: null }), 'a')).toBe('claimed') })
  it('reports "held" when a fresh claim exists (no row matched)', async () => { expect(await claimCheckpoint(db({ data: [], error: null }), 'a')).toBe('held') })
  it('never blocks a launch because the claim itself failed (missing column, error, throw)', async () => {
    expect(await claimCheckpoint(db({ data: null, error: { message: 'column "checkpoint_claimed_at" does not exist' } }), 'a')).toBe('unavailable')
    expect(await claimCheckpoint(db('throw'), 'a')).toBe('unavailable')
  })
  it('treats a claim older than the stale window as abandoned', async () => {
    const log: string[] = []
    const now = Date.parse('2026-10-25T10:00:00.000Z')
    await claimCheckpoint(db({ data: [{ id: 'a' }], error: null }, log), 'a', now)
    expect(log.join('\n')).toContain(`checkpoint_claimed_at.lt.${new Date(now - CLAIM_STALE_MS).toISOString()}`)
    expect(log.join('\n')).toContain('checkpoint_claimed_at.is.null')
  })
  it('release clears the claim and never throws', async () => {
    const log: string[] = []
    await releaseClaim(db({ data: [], error: null }, log), 'a')
    expect(log.join('\n')).toContain('"checkpoint_claimed_at":null')
    let threw = false
    try { await releaseClaim({ from: () => { throw new Error('boom') } } as never, 'a') } catch { threw = true }
    expect(threw).toBe(false)
  })
  it('forwards the real client address so the per-IP limit applies per person', () => {
    const h = internalSessionHeaders({ authorization: 'Bearer t', forwardedFor: '203.0.113.9, 10.0.0.1', realIp: '203.0.113.9' })
    expect(h['x-forwarded-for']).toBe('203.0.113.9, 10.0.0.1')
    expect(h['x-real-ip']).toBe('203.0.113.9')
    expect(h.Authorization).toBe('Bearer t')
    const bare = internalSessionHeaders({})
    expect(Object.keys(bare)).toEqual(['Content-Type'])
  })
})

describe('10 · static quality gates on cards and components (what code can check without a browser)', () => {
  it('every approved template is well-formed: 2-7 options, unique ids and labels, short, no look-alikes of the system buttons', () => {
    const lookalike = /^(not sure|none of|something else|prefer not|skip)/i
    for (const [kind, slots] of Object.entries(CARD_PRESETS)) for (const [slot, p] of Object.entries(slots ?? {})) {
      const where = `${kind}.${slot}`
      expect(p.options.length >= 2 && p.options.length <= (p.mode === 'multi' ? 7 : 5), `${where} option count`).toBe(true)
      expect(new Set(p.options.map(o => o[0])).size, `${where} unique ids`).toBe(p.options.length)
      expect(new Set(p.options.map(o => o[1].toLowerCase())).size, `${where} unique labels`).toBe(p.options.length)
      for (const [, label, exclusive] of p.options) {
        expect(label.length <= 60, `${where} "${label}" length`).toBe(true)
        expect(lookalike.test(label), `${where} "${label}" looks like a system button`).toBe(false)
        if (exclusive) expect(p.mode, `${where} exclusive only makes sense for multi`).toBe('multi')
      }
    }
  })
  const group = readFileSync('components/ChatCardGroup.tsx', 'utf8')
  const step  = readFileSync('components/ChatCardStep.tsx', 'utf8')
  it('card group keeps its accessibility structure', () => {
    expect(group).toMatch(/<fieldset/); expect(group).toMatch(/<legend/)
    expect(group).toMatch(/type=\{single \? 'radio' : 'checkbox'\}/)
    expect(group).toMatch(/role="alert"/); expect(group).toMatch(/aria-live="polite"/)
    expect(group).toMatch(/aria-expanded/); expect(group).toMatch(/htmlFor=/)
    expect(group).toMatch(/fontSize: 16/)                       // no iOS zoom on focus
    expect(group).not.toMatch(/e\.preventDefault\(/)             // desyncs controlled inputs / screen readers
    expect(group).toMatch(/minmax\(min\(100%, 230px\), 1fr\)/)  // one column on a 320 px screen
  })
  it('combined step keeps both groups mounted so "Change" never loses entries, and announces the second group', () => {
    expect(step).toMatch(/hidden=\{!!firstSel\}/)
    expect(step).toMatch(/hidden=\{!firstSel\}/)
    expect(step).toMatch(/aria-live="polite"/)
    expect(step).toMatch(/Next question:/)
    expect(step).toMatch(/minHeight: 44/)
  })
})

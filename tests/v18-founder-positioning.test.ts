// tests/v18-founder-positioning.test.ts
// v18 (Nov 2026): the first-visit screen leads with consequential business decisions. The product is not narrowed.
// Pure logic runs the real code; wiring tests read the source, like the earlier journey tests.

import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { FEEDER_STARTER, FOUNDER_STARTERS } from '@/lib/founder-starters'
import { getPlaybook, classifyPlaybook } from '@/lib/decision-playbooks'
import { mergeNotes } from '@/lib/chat-intake-turn'
import { baseKindLabel, segmentOfKind } from '@/lib/segment'
import { INTAKE_QUICK_STARTS, INTAKE_EXAMPLES } from '@/lib/intake-examples'
import { POST_SCENARIOS } from '@/lib/post-scenarios'
import { scoreRichness } from '@/lib/chat-intake-brief'
import { isFounderFrontDoorEnabled } from '@/lib/feature-flags'
import { sanitizeIntakeProps } from '@/lib/event-props'
import type { ChatDecisionState } from '@/lib/types'

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const stripAllComments = (code: string) => code.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
const UNVERIFIED_CLAIM = /\b(free|no\s*sign-?\s*up|no\s*signup|no\s*account|without\s+(an\s+)?account|\d+\s*(min|minute|minutes|sec|seconds)\b|in\s+minutes|instant(ly)?|guarantee[sd]?)\b/i

describe('1. The six founder starters', () => {
  it('are exactly the six decisions the team chose, in that order, in their wording', () => {
    expect(FOUNDER_STARTERS.map(s => s.label)).toEqual([
      'Should we raise funding now or continue bootstrapping?',
      'Should I hire a senior leader or continue managing this function myself?',
      'Should we enter a new market or focus on our existing market?',
      'Should I bring on a co-founder or continue independently?',
      'Should we change our pricing or packaging?',
      'Should I sell the company or continue scaling it?',
    ])
    for (const s of FOUNDER_STARTERS) expect(s.text).toBe(s.label)    // what is sent is what is shown: no hidden rewrite
    expect(new Set(FOUNDER_STARTERS.map(s => s.id)).size).toBe(6)
  })

  it('each names a playbook that really exists, in the right family', () => {
    const expected = ['business.raise_funding', 'team.hire', 'business.expand', 'business.cofounder', 'product.pricing', 'business.sell']
    expect(FOUNDER_STARTERS.map(s => s.playbook)).toEqual(expected)
    for (const s of [...FOUNDER_STARTERS, FEEDER_STARTER]) expect(getPlaybook(s.playbook), s.playbook).not.toBeNull()
  })

  it('exist because keywords alone miss two of them (the reason for carrying the playbook)', () => {
    const missed = FOUNDER_STARTERS.filter(s => !classifyPlaybook(s.text))
    expect(missed.map(s => s.id).sort()).toEqual(['fs_cofounder', 'fs_hire_leader'])
  })

  it('the feeder is a quieter seventh line, not one of the six', () => {
    expect(FOUNDER_STARTERS).toHaveLength(6)
    expect(FEEDER_STARTER.label).toBe('Thinking of leaving a job to start something of your own?')
    expect(FEEDER_STARTER.playbook).toBe('business.start')
  })

  it('claim nothing about price, sign-up or time, and invent no facts', () => {
    for (const s of [...FOUNDER_STARTERS, FEEDER_STARTER]) expect(`${s.label} ${s.text}`).not.toMatch(UNVERIFIED_CLAIM)
    for (const s of FOUNDER_STARTERS) expect(s.text).not.toMatch(/\d/)
  })
})

describe('2. A starter\'s playbook reaches the server safely', () => {
  const route = src('app/api/chat-intake/route.ts')
  it('it is used for a brand-new chat only, and only if it is a real playbook', () => {
    expect(route).toContain("if (!priorState && typeof starterPlaybook === 'string' && getPlaybook(starterPlaybook)) {")
    expect(route).toContain("state0.decisionKind = starterPlaybook as ChatDecisionState['decisionKind']")
    expect(route).toContain('starterPlaybook,\n    } = (await req.json())')
  })
  it('the client sends it on the first message of a new chat and never otherwise', () => {
    const ci = src('components/ChatIntake.tsx')
    expect(ci).toContain('starterPlaybook: !chatIntakeId ? opts?.playbook : undefined,')
    expect(ci).toContain('void send(st.text, undefined, { playbook: st.playbook })')
    expect(ci).toContain("track('starter_picked', { placement: 'founder_starter', example: st.id, position: 'below' })")
  })
  it('the planner cannot downgrade a specific playbook to its own parent type, but can change to a genuinely different kind', () => {
    const prior = { decisionKind: 'team.hire' } as ChatDecisionState
    const notes = (k: string) => ({ decisionKind: k, decisionStatement: null, slots: {}, unknownSlots: [], naSlots: [] }) as any
    expect(mergeNotes(prior, notes('team')).decisionKind).toBe('team.hire')            // restating the parent: keep the playbook
    expect(mergeNotes(prior, notes('business')).decisionKind).toBe('business')         // a different family: the planner wins
    expect(mergeNotes(prior, notes('team.fire')).decisionKind).toBe('team.fire')       // another playbook: the planner wins
    expect(mergeNotes({ decisionKind: 'team' } as ChatDecisionState, notes('team')).decisionKind).toBe('team')   // no playbook yet: unchanged
  })
})

describe('3. Segment labels match the repeat-analysis kit', () => {
  it('the mapping is the same one the SQL uses', () => {
    expect(segmentOfKind('business.raise_funding')).toBe('founder_business')
    expect(segmentOfKind('team.hire')).toBe('founder_business')
    expect(segmentOfKind('product.pricing')).toBe('founder_business')
    expect(segmentOfKind('business')).toBe('founder_business')
    expect(segmentOfKind('career_exit.freelance')).toBe('feeder_leave_job')
    expect(segmentOfKind('money.lump_sum')).toBe('money_unclear')
    expect(segmentOfKind('relationship.breakup')).toBe('personal_other')
    expect(segmentOfKind('purchase.car')).toBe('personal_other')
    expect(segmentOfKind(null)).toBe('unclassified')
    expect(segmentOfKind('')).toBe('unclassified')
  })
  it('base kind labels are short fixed-shape strings, never a playbook id or free text', () => {
    expect(baseKindLabel('business.raise_funding')).toBe('business')
    expect(baseKindLabel('team')).toBe('team')
    expect(baseKindLabel(null)).toBeNull()
    expect(baseKindLabel('Some Free Text With Spaces!')).toBeNull()
  })
  it('the checkpoint event is labelled with them, and the privacy guard lets exactly those keys through', () => {
    expect(src('components/DecisionCheckpoint.tsx')).toContain('decision_kind: baseKindLabel(state.decisionKind), segment: segmentOfKind(state.decisionKind)')
    const kept = sanitizeIntakeProps('intake_summary_shown', { decision_kind: 'business', segment: 'founder_business', text: 'Should we sack our CTO' })
    expect(kept).toMatchObject({ decision_kind: 'business', segment: 'founder_business' })
    expect(kept).not.toHaveProperty('text')
  })
})

describe('4. The first-visit screen leads with business decisions; the product is not narrowed', () => {
  const ci = src('components/ChatIntake.tsx')
  const hero = ci.slice(ci.indexOf('Hero \u2014 "Quorum is ready to think with me,'))
  it('the headline and sub-line sell a review, say anything works, and keep the earlier copy behind the flag', () => {
    expect(ci).toContain('Review a hard business decision before you commit.')
    expect(ci).toContain('Quorum structures the decision, exposes the assumptions you are relying on, has independent perspectives challenge it, and gives you a documented brief. Then it tracks what happened. Anything you are weighing works too.')
    expect(ci).toContain('Bring a hard decision. Have it challenged, and remembered.')   // v15, restored by the flag
    expect(ci).toContain("What's the decision you're circling?")                           // v10, still restorable
    expect(ci).toContain('const founderFrontDoor = isFounderFrontDoorEnabled()')
  })
  it('the sub-line sells a repeatable review, not six advisors', () => {
    const sub = ci.slice(ci.indexOf('Quorum structures the decision'), ci.indexOf('Anything you are weighing works too.') + 40)
    expect(sub).not.toMatch(/\bsix\b|advisors?\b/i)
    expect(sub).not.toMatch(UNVERIFIED_CLAIM)
  })
  it('the six sit under the box and above the pills, only for a first visit, and lock while a request is in flight', () => {
    const box = hero.indexOf('{inputForm}')
    const starters = hero.indexOf('<FounderStarters')
    const pills = hero.indexOf("{!gated && QUICK_START_POSITION === 'below' && (")
    expect(starters).toBeGreaterThan(box)
    expect(starters).toBeLessThan(pills)
    expect(hero).toContain('{!gated && founderFrontDoor && !deskActive && !deskPending && (')
    expect(hero).toContain('<FounderStarters onPick={handleFounderStarter} disabled={sending} />')
  })
  it('every existing category remains, Business leads, and "Smaller calls" is "Something smaller" with the same text', () => {
    expect(INTAKE_QUICK_STARTS.map(q => q.id).sort()).toEqual(['qs_business', 'qs_career', 'qs_money', 'qs_personal', 'qs_relationships', 'qs_small'])
    expect(INTAKE_QUICK_STARTS[0].label).toBe('Business')
    expect(INTAKE_QUICK_STARTS.find(q => q.id === 'qs_small')).toMatchObject({ label: 'Something smaller', text: 'It\u2019s a smaller, everyday decision.' })
    expect(INTAKE_EXAMPLES).toHaveLength(4)   // the personal examples are untouched
    expect(hero).toContain("heading={founderFrontDoor && !deskActive ? 'Something else? Pick the kind of decision:' : undefined}")
  })
  it('the box is still the first thing: nothing sign-in-ish is added above it', () => {
    const before = hero.slice(0, hero.indexOf('{inputForm}'))
    expect(before).not.toContain('<AuthPanel')
    expect(before.match(/<ConnectCard/g) ?? []).toHaveLength(1)
  })
  it('the component is plain buttons with a comfortable touch height and no free text of its own', () => {
    const c = src('components/FounderStarters.tsx')
    expect(c).toContain('minHeight: 48')
    expect(c).toContain('<button key={s.id} type="button" disabled={disabled}')
    expect(stripAllComments(c)).not.toMatch(UNVERIFIED_CLAIM)
  })
})

describe('5. The sample reflects the target customer', () => {
  const fd = src('components/FrontDoorExplainer.tsx')
  it('the founder variant shows a structured, challenged, documented, tracked review', () => {
    for (const lead of ['Structured.', 'Challenged.', 'Documented.', 'Tracked.']) expect(fd).toContain(`lead: '${lead}'`)
    expect(fd).toContain("{founder ? 'How a review works' : 'When you bring a decision'}")
  })
  it('the sample is a founder\'s own decision and is still labelled as invented', () => {
    expect(fd).toContain('Should I hire a senior leader or continue managing this function myself?')
    expect(fd).toContain('If this function ran without you for a quarter, what would break first?')
    expect(fd).toContain('An invented example, to show the shape of a result.')
    expect(fd).toContain('content={founder ? SAMPLE_FOUNDER : SAMPLE_LEGACY}')
  })
  it('the earlier copy is still there for the flag-off case', () => {
    expect(fd).toContain("lead: 'Examined.'")
    expect(fd).toContain('Hire a senior engineer now, or wait until the next round closes?')
  })
  it('claims nothing about price, sign-up or time, and never that Quorum knows or predicts the person', () => {
    const copy = stripAllComments(fd).replace(/\s+/g, ' ')
    expect(copy).not.toMatch(UNVERIFIED_CLAIM)
    const rest = copy.replace('does not claim to know you from one or two decisions', '')
    expect(rest).not.toMatch(/\bknows? you\b|\bunderstands? you\b|\bpredicts? (you|your)\b/i)
  })
})

describe('6. Campaign links for the six', () => {
  it('lead the list, are link-safe, and are specific enough that the chat asks fewer follow-ups', () => {
    const founder = POST_SCENARIOS.slice(0, 6)
    expect(founder.map(s => s.slug)).toEqual(['raise_or_bootstrap', 'hire_senior_leader', 'new_market', 'add_cofounder', 'change_pricing', 'sell_or_scale'])
    for (const s of founder) {
      expect(scoreRichness(s.text).tier, s.slug).not.toBe('sparse')
      expect(`${s.title} ${s.text}`).not.toMatch(UNVERIFIED_CLAIM)
    }
  })
  it('the personal scenarios are unchanged and still present', () => {
    const slugs = POST_SCENARIOS.map(s => s.slug)
    for (const s of ['job_offers', 'leave_job', 'hard_conversation', 'loan_or_invest']) expect(slugs).toContain(s)
  })
})

describe('7. The off switch', () => {
  const saved = process.env.NEXT_PUBLIC_FOUNDER_FRONT_DOOR
  afterEach(() => { if (saved === undefined) delete process.env.NEXT_PUBLIC_FOUNDER_FRONT_DOOR; else process.env.NEXT_PUBLIC_FOUNDER_FRONT_DOOR = saved })
  it('is on by default and off only when set to off or false', () => {
    delete process.env.NEXT_PUBLIC_FOUNDER_FRONT_DOOR
    expect(isFounderFrontDoorEnabled()).toBe(true)
    process.env.NEXT_PUBLIC_FOUNDER_FRONT_DOOR = 'off'
    expect(isFounderFrontDoorEnabled()).toBe(false)
    process.env.NEXT_PUBLIC_FOUNDER_FRONT_DOOR = 'false'
    expect(isFounderFrontDoorEnabled()).toBe(false)
  })
})

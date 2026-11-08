import { describe, it, expect } from 'vitest'
import {
  PLAYBOOKS, getPlaybook, isPlaybookId, baseKindOf, classifyPlaybook, tokens, stem, totalAliasCount,
} from '../lib/decision-playbooks'
import { DECISION_KINDS, isDecisionKind, slotsFor, slotSpec, slotCatalogForPrompt, kindLabel } from '../lib/chat-intake-brief'
import { buildCardGroup, presetFor } from '../lib/chat-intake-cards'
import { mergeNotes } from '../lib/chat-intake-turn'
import { classifyDecision } from '../lib/decision-taxonomy'
import { validatePlaybookDef } from '../lib/playbook-validate'
import type { PlaybookDef } from '../lib/decision-playbooks'
import type { ChatDecisionState, DecisionKind } from '../lib/types'

const FEELINGS = /\b(feel|feeling|success)\b/i
const LOOKALIKE_CHIP = /not sure|don'?t know|do not know|prefer not|unknown|i guess|none of the above/i

describe('library size', () => {
  it('has the breadth promised: dozens of situations, 500+ everyday phrasings, across every area', () => {
    expect(PLAYBOOKS.length).toBeGreaterThanOrEqual(75)
    expect(totalAliasCount()).toBeGreaterThanOrEqual(500)
    const bases = new Set(PLAYBOOKS.map(p => p.base))
    for (const b of ['career_exit', 'job_offer', 'career_move', 'relocation', 'money', 'business', 'relationship', 'education', 'purchase',
      'housing', 'health', 'family', 'team', 'product', 'lifestyle'] as const) expect(bases.has(b), b).toBe(true)
  })
})

describe('every playbook is well formed (a bad entry must fail here, not in front of a user)', () => {
  it('ids are unique, namespaced under a real type, and snake_case', () => {
    const seen = new Set<string>()
    for (const p of PLAYBOOKS) {
      expect(p.id, p.id).toMatch(/^[a-z_]+\.[a-z_]+$/)
      expect(seen.has(p.id), `duplicate ${p.id}`).toBe(false)
      seen.add(p.id)
      expect((DECISION_KINDS as readonly string[]).includes(p.base) && (p.base as string) !== 'other', `${p.id} base`).toBe(true)
      expect(p.label.length, `${p.id} label`).toBeLessThanOrEqual(48)
    }
  })

  it('questions are plain, specific and never about feelings or "what would success look like"', () => {
    for (const p of PLAYBOOKS) for (const s of p.slots) {
      expect(s.ask, `${p.id}.${s.key}`).toMatch(/\?$/)
      expect(s.ask, `${p.id}.${s.key}`).not.toMatch(FEELINGS)
      expect(s.ask.length, `${p.id}.${s.key}`).toBeLessThanOrEqual(170)
      expect(s.label.length, `${p.id}.${s.key} label`).toBeLessThanOrEqual(36)
      expect(s.key, `${p.id}.${s.key}`).toMatch(/^[a-z_]+$/)
    }
  })

  it('slot keys are unique within a playbook and never collide with the reserved "change my mind" slot', () => {
    for (const p of PLAYBOOKS) {
      const keys = p.slots.map(s => s.key)
      expect(new Set(keys).size, p.id).toBe(keys.length)
      expect(keys, p.id).not.toContain('change_mind')
    }
  })

  it('tap-answers: 2-5 per question, short, no lookalikes of the UI\'s own "Not sure" / "Prefer not to say"', () => {
    for (const p of PLAYBOOKS) for (const s of p.slots) {
      if (!s.chips) continue
      expect(s.chips.length, `${p.id}.${s.key}`).toBeGreaterThanOrEqual(2)
      expect(s.chips.length, `${p.id}.${s.key}`).toBeLessThanOrEqual(5)
      expect(new Set(s.chips.map(c => c.toLowerCase())).size, `${p.id}.${s.key} duplicate chip`).toBe(s.chips.length)
      for (const c of s.chips) {
        expect(c.length, `${p.id}.${s.key} "${c}"`).toBeLessThanOrEqual(36)
        expect(c, `${p.id}.${s.key}`).not.toMatch(LOOKALIKE_CHIP)
      }
    }
  })

  it('each situation asks enough to be useful but not an interrogation: 2-5 required of its own, 2-6 required in total', () => {
    for (const p of PLAYBOOKS) {
      const ownRequired = p.slots.filter(s => s.required).length
      expect(ownRequired, `${p.id} own required`).toBeGreaterThanOrEqual(2)
      expect(ownRequired, `${p.id} own required`).toBeLessThanOrEqual(5)
      const total = slotsFor(p.id).filter(s => s.required).length
      expect(total, `${p.id} total required`).toBeGreaterThanOrEqual(2)
      expect(total, `${p.id} total required`).toBeLessThanOrEqual(6)
    }
  })

  it('inheritance: "other routes" is required for a serious decision (except offers), optional for a light one', () => {
    for (const p of PLAYBOOKS) {
      const alt = slotsFor(p.id).find(s => s.key === 'alternatives')
      if (p.base === 'job_offer') { expect(alt, p.id).toBeUndefined(); continue }
      expect(alt, p.id).toBeDefined()
      expect(alt!.required, p.id).toBe(!p.light)
    }
  })

  it('light playbooks only live under everyday types, and everyday types are all light', () => {
    for (const p of PLAYBOOKS) expect(p.light, p.id).toBe(p.base === 'lifestyle')
  })

  it('slot flags are honoured: sensitive questions are flagged, and free-text questions have no cards', () => {
    const g = PLAYBOOKS.find(p => p.id === 'housing.buy')!
    expect(g.slots.find(s => s.key === 'affordability')!.sensitive).toBe(true)
    expect(presetFor('housing.buy', 'affordability')?.sensitive).toBe(true)
    expect(presetFor('housing.buy', 'price')).toBeNull()      // free text: asked in words
  })
})

describe('aliases (the phrasings that identify a situation)', () => {
  it('every playbook has at least 6, and every single-word alias is explicitly marked as distinctive', () => {
    for (const p of PLAYBOOKS) {
      expect(p.aliases.length, p.id).toBeGreaterThanOrEqual(6)
      for (const a of p.aliases) {
        const bare = a.startsWith('=') ? a.slice(1) : a
        if (tokens(bare).length < 2) expect(a.startsWith('='), `${p.id}: "${a}" is a single word, mark it "=${a}" if it is distinctive`).toBe(true)
        if (a.includes('=') && !a.startsWith('=')) throw new Error(`${p.id}: "${a}" has a misplaced "="`)
      }
    }
  })

  it('no phrase is claimed by two situations', () => {
    const owner = new Map<string, string>()
    for (const p of PLAYBOOKS) for (const a of p.aliases) {
      const key = tokens(a.replace(/^=/, '')).join(' ')
      const prev = owner.get(key)
      expect(prev === undefined || prev === p.id, `"${a}" (${p.id}) duplicates an alias of ${prev}`).toBe(true)
      owner.set(key, p.id)
    }
  })

  it('SELF-CONSISTENCY: every alias, typed on its own, resolves to the situation it belongs to', () => {
    const wrong: string[] = []
    for (const p of PLAYBOOKS) for (const a of p.aliases) {
      const text = a.replace(/^=/, '')
      const got = classifyPlaybook(text)
      if (got?.playbook.id !== p.id) wrong.push(`"${text}" (${p.id}) -> ${got?.playbook.id ?? 'silent'}`)
    }
    expect(wrong, wrong.join('\n')).toEqual([])
  })

  it('matching is forgiving about wording: tense, plurals, filler words, punctuation, word order slack', () => {
    expect(classifyPlaybook('Should I be buying a house right now?')?.playbook.id).toBe('housing.buy')
    expect(classifyPlaybook('buy houses?!')?.playbook.id).toBe('housing.buy')
    expect(classifyPlaybook('We are thinking of selling our flat')?.playbook.id).toBe('housing.sell')
    expect(stem('buying')).toBe(stem('buy'))
    expect(stem('houses')).toBe(stem('house'))
    expect(stem('quitting')).toBe(stem('quit'))
    expect(stem('moving')).toBe(stem('move'))
  })

  it('restricts to a type when told to, and stays silent on ambiguity or nonsense', () => {
    expect(classifyPlaybook('should I buy a house', { within: 'housing' })?.playbook.id).toBe('housing.buy')
    expect(classifyPlaybook('should I buy a house', { within: 'money' })).toBeNull()
    expect(classifyPlaybook('')).toBeNull()
    expect(classifyPlaybook(null)).toBeNull()
    expect(classifyPlaybook('xyzzy plugh')).toBeNull()
  })
})

describe('questions and cards work end to end for every playbook', () => {
  it('every question with tap-answers builds a valid card; every free-text one correctly builds none', () => {
    for (const p of PLAYBOOKS) for (const s of p.slots) {
      const spec = slotSpec(p.id, s.key)!
      expect(spec, `${p.id}.${s.key}`).toBeTruthy()
      const g = buildCardGroup({ kind: p.id as DecisionKind, slot: spec, question: 'Q?' })
      if (!s.chips) { expect(g, `${p.id}.${s.key}`).toBeNull(); continue }
      expect(g, `${p.id}.${s.key}`).not.toBeNull()
      expect(g!.questionId).toBe(`${p.id}.${s.key}`)
      expect(g!.decisionCategory).toBe(p.id)
      expect(g!.options.length).toBeGreaterThanOrEqual(2)
      expect(new Set(g!.options.map(o => o.id)).size).toBe(g!.options.length)
      expect(g!.maxSelections === null ? 'multi' : 'single').toBe(s.multi ? 'multi' : 'single')
      expect(g!.allowPreferNotToSay).toBe(s.sensitive)
    }
  })

  it('analytics ids are stable and safe: same id every build, identifier-shaped (event-props SAFE_STRING)', () => {
    const SAFE = /^[A-Za-z0-9._:,|\-]{1,120}$/
    for (const p of PLAYBOOKS) for (const s of p.slots.filter(x => x.chips)) {
      const a = buildCardGroup({ kind: p.id as DecisionKind, slot: slotSpec(p.id, s.key)!, question: 'Q?' })!
      const b = buildCardGroup({ kind: p.id as DecisionKind, slot: slotSpec(p.id, s.key)!, question: 'Q?' })!
      expect(a.options.map(o => o.id)).toEqual(b.options.map(o => o.id))
      expect(p.id).toMatch(SAFE)
      for (const o of a.options) expect(o.id).toMatch(SAFE)
    }
  })

  it('a situation inherits its type\'s card templates for the generic questions it does not redefine', () => {
    const g = buildCardGroup({ kind: 'housing.buy', slot: slotSpec('housing.buy', 'alternatives')!, question: 'Q?' })!
    expect(g.questionId).toBe('housing.buy.alternatives')
    expect(g.options.map(o => o.label)).toContain('Rent a while longer')   // the housing type's own alternatives
  })

  it('the brief shows the situation\'s own label', () => {
    expect(kindLabel('housing.buy')).toBe('Buying a home')
    expect(kindLabel('housing')).toBe('A home')
    expect(kindLabel(null)).toBeNull()
  })
})

describe('plumbing: a playbook id is a valid decision kind everywhere', () => {
  it('isDecisionKind / isPlaybookId / baseKindOf', () => {
    expect(isDecisionKind('housing.buy')).toBe(true)
    expect(isDecisionKind('housing')).toBe(true)
    expect(isDecisionKind('housing.bogus')).toBe(false)
    expect(isDecisionKind('nonsense.thing')).toBe(false)
    expect(isPlaybookId('housing.buy')).toBe(true)
    expect(isPlaybookId('housing')).toBe(false)
    expect(baseKindOf('housing.buy')).toBe('housing')
    expect(baseKindOf('housing')).toBe('housing')
    expect(baseKindOf('housing.bogus')).toBeNull()
    expect(baseKindOf(null)).toBeNull()
    expect(getPlaybook('lifestyle.pet')?.light).toBe(true)
  })

  it('an unknown playbook id degrades to the generic questions instead of crashing', () => {
    expect(slotsFor('housing.bogus' as DecisionKind)).toEqual(slotsFor('other'))
  })

  it('career rules that key off the type still apply to a career playbook (runway matters when income is at risk)', () => {
    expect(slotsFor('career_exit.freelance').length).toBeGreaterThan(2)
    expect(baseKindOf('career_exit.freelance')).toBe('career_exit')
  })
})

describe('planner prompt stays small however large the library grows', () => {
  it('opening turn lists every situation; later turns list only the chosen one', () => {
    const first = slotCatalogForPrompt(null)
    for (const p of PLAYBOOKS) expect(first, p.id).toContain(p.id)
    const later = slotCatalogForPrompt('housing.buy')
    expect(later).toContain('housing.buy')
    expect(later).not.toContain('lifestyle.pet')
    expect(later.length).toBeLessThan(first.length / 2)
    const withBaseOnly = slotCatalogForPrompt('housing')
    expect(withBaseOnly).not.toContain('lifestyle.pet')
  })
  it('the opening-turn catalogue is a bounded size', () => {
    expect(slotCatalogForPrompt(null).length).toBeLessThan(14_000)
  })
})

describe('mergeNotes: recognising the situation', () => {
  const none = { decisionStatement: '' } as never

  it('REGRESSION (the reported case): "Buy the house now" lands on housing.buy, not the generic purchase questions', () => {
    const s = mergeNotes({} as ChatDecisionState, none, { userText: 'Should I buy the house now or keep looking for other houses?' })
    expect(s.decisionKind).toBe('housing.buy')
  })
  it('sharpens a broad type the planner chose into the specific situation, when nothing has been answered yet', () => {
    const s = mergeNotes({} as ChatDecisionState, { decisionKind: 'housing' } as never, { userText: 'Should I sell my flat?' })
    expect(s.decisionKind).toBe('housing.sell')
  })
  it('does NOT swap the question set once an answer exists (answers already given must not be orphaned)', () => {
    const prior = { decisionKind: 'housing', facts: { what: 'selling' } } as unknown as ChatDecisionState
    expect(mergeNotes(prior, none, { userText: 'Should I sell my flat?' }).decisionKind).toBe('housing')
  })
  it('does NOT swap it when the planner already extracted facts this turn', () => {
    const s = mergeNotes({} as ChatDecisionState, { decisionKind: 'housing', facts: { what: 'selling' } } as never, { userText: 'Should I sell my flat?' })
    expect(s.decisionKind).toBe('housing')
  })
  it('never overrides a situation the planner chose, nor a different type it chose', () => {
    expect(mergeNotes({} as ChatDecisionState, { decisionKind: 'housing.rent_vs_buy' } as never, { userText: 'Should I sell my flat?' }).decisionKind).toBe('housing.rent_vs_buy')
    expect(mergeNotes({} as ChatDecisionState, { decisionKind: 'money' } as never, { userText: 'Should I sell my flat?' }).decisionKind).toBe('money')
  })
  it('stays on the broad type when no situation clearly fits', () => {
    expect(mergeNotes({} as ChatDecisionState, { decisionKind: 'housing' } as never, { userText: 'Something about my home situation' }).decisionKind).toBe('housing')
  })
})

describe('recognition quality on phrasings written independently of the aliases', () => {
  // [text, expected playbook | null].  null = must stay silent.
  const HELD_OUT: Array<[string, string | null]> = [
    ['Should I buy a flat in Pune this year?', 'housing.buy'],
    ["We're torn between renting and buying", 'housing.rent_vs_buy'],
    ['Thinking about selling my flat and moving to a cheaper city', 'housing.sell'],
    ['Should I ask my boss for a raise this quarter?', 'career_move.ask_raise'],
    ["I got offered a promotion but I'm not sure I want it", 'career_move.accept_promotion'],
    ['Should we have another baby?', 'family.have_child'],
    ['Which school should we pick for our six year old?', 'family.school'],
    ['Do I put my mom in a nursing home?', 'family.elder_care'],
    ['I want to lose weight but hate gyms', 'health.habit_change'],
    ['Should I start therapy?', 'health.therapy'],
    ['Is it worth doing an MBA at 32?', 'education.mba'],
    ['Should I go for a PhD in machine learning?', 'education.phd'],
    ["I'm thinking of dropping out of college to build my startup", 'education.leave_study'],
    ['Should I take a sabbatical next year?', 'career_exit.sabbatical'],
    ['Should I switch careers into data science?', 'career_move.switch_field'],
    ['Should I get a puppy or a kitten?', 'lifestyle.pet'],
    ['What should I cook tonight?', 'lifestyle.everyday'],
    ['Should I go vegan?', 'lifestyle.diet'],
    ['Should I buy a Tesla?', 'purchase.car'],
    ['Should I fire my underperforming developer?', 'team.fire'],
    ['We might need to do layoffs next quarter', 'team.restructure'],
    ['Should we raise our prices next month?', 'product.pricing'],
    ['Should we rewrite our app in Rust?', 'product.tech_migration'],
    ['Build or buy a payments system?', 'product.build_vs_buy'],
    ['Should I raise a seed round or stay bootstrapped?', 'business.raise_funding'],
    ['Should I shut down my company?', 'business.shut_down'],
    ['Do I propose to her this year?', 'relationship.propose'],
    ['Should I get a divorce?', 'relationship.divorce'],
    ['Should we move in together?', 'relationship.move_in'],
    ['Should I end my friendship with Sam?', 'relationship.friendship'],
    ['Should I move to Canada?', 'relocation.abroad'],
    ['Should I invest my bonus in mutual funds?', 'money.lump_sum'],
    ['Should I prepay my home loan?', 'money.debt_vs_invest'],
    ['Do I need term insurance?', 'money.insurance'],
    // must stay silent
    ['Should I learn to juggle?', null],
    ['Should I tell my friend the truth?', null],
    ['Should I take the job?', null],
    ['Should I go to the gym today?', null],
    ['Should I repaint the living room?', null],
  ]
  // Real situations a person would name that the phrase library does not catch yet. The backlog: add aliases for these
  // (data only). The test insists they are never answered with the WRONG situation.
  const BACKLOG: Array<[string, string]> = [
    ['My co-founder and I disagree about equity', 'business.cofounder'],
    ['Where should we go for our honeymoon?', 'lifestyle.trip'],
    ['Should I attend my cousin\'s wedding?', 'lifestyle.social'],
    ['Should I upgrade my iPhone this year?', 'purchase.gadget'],
    ['Should I forgive my sister?', 'relationship.forgive'],
    ['Should I move to Pune for work?', 'relocation.domestic'],
    ['Should I retire at 50?', 'money.retire_early'],
  ]

  it('never answers with the wrong situation (silence is fine; a wrong guess asks the wrong questions)', () => {
    const wrong = HELD_OUT.map(([t, e]) => ({ t, e, g: classifyPlaybook(t)?.playbook.id ?? null })).filter(r => r.g !== null && r.g !== r.e)
    expect(wrong, wrong.map(w => `"${w.t}" expected ${w.e} got ${w.g}`).join('\n')).toEqual([])
  })
  it('recognises the large majority of independently written phrasings', () => {
    const expected = HELD_OUT.filter(r => r[1] !== null)
    const hit = expected.filter(([t, e]) => classifyPlaybook(t)?.playbook.id === e).length
    expect(hit / expected.length).toBeGreaterThanOrEqual(0.85)
  })
  it('stays silent where it should', () => {
    for (const [t] of HELD_OUT.filter(r => r[1] === null)) expect(classifyPlaybook(t), t).toBeNull()
  })
  it('backlog items are never answered with the wrong situation', () => {
    for (const [t, e] of BACKLOG) {
      const g = classifyPlaybook(t)?.playbook.id ?? null
      expect(g === null || g === e, `"${t}" expected ${e} or silence, got ${g}`).toBe(true)
    }
  })
  it('classifyDecision combines both signals: a situation when one fits, the broad type otherwise', () => {
    expect(classifyDecision('Should I buy the house now?')).toBe('housing.buy')
    expect(classifyDecision('Should I move to Pune for work?')).toBe('relocation')   // type rules still answer what the phrase library misses
    expect(classifyDecision('Should I take the stairs or the lift?')).toBeNull()
  })
})

describe('the shared validator (also used by scripts/draft-playbooks.ts)', () => {
  const good: PlaybookDef = {
    id: 'lifestyle.test_thing', label: 'A test situation', light: true,
    slots: [['a_one', 'First', 'Is this the first question?', ['Yes', 'No'], 'r'], ['b_two', 'Second', 'Is this the second question?', null, 'r']],
    aliases: ['alpha beta gamma', 'delta epsilon', 'zeta eta theta', 'iota kappa lambda', 'mu nu xi', 'omicron pi rho'],
  }
  it('every shipped situation passes it (checked against the library without itself)', () => {
    for (const p of PLAYBOOKS) {
      const others = PLAYBOOKS.filter(x => x.id !== p.id)
      const def = { id: p.id, label: p.label, aliases: p.aliases, light: p.light, slots: p.slots.map(s => [s.key, s.label, s.ask, s.chips, `${s.required ? 'r' : ''}${s.multi ? 'm' : ''}${s.sensitive ? 's' : ''}`]) } as PlaybookDef
      expect(validatePlaybookDef(def, { against: others }), p.id).toEqual([])
    }
  })
  it('accepts a well-formed new entry', () => {
    expect(validatePlaybookDef(good)).toEqual([])
  })
  it('rejects the mistakes that matter, with a readable reason', () => {
    const problems = (patch: Partial<PlaybookDef>) => validatePlaybookDef({ ...good, ...patch }).join(' | ')
    expect(problems({ id: 'housing.buy' })).toMatch(/already exists/)
    expect(problems({ id: 'madeup.thing' as PlaybookDef['id'] })).toMatch(/not a real decision type/)
    expect(problems({ slots: [['a_one', 'First', 'How do you feel about it?', ['Yes', 'No'], 'r'], good.slots[1]] })).toMatch(/feelings/)
    expect(problems({ slots: [['a_one', 'First', 'Is this ok?', ['Yes', 'Not sure yet'], 'r'], good.slots[1]] })).toMatch(/imitates a button/)
    expect(problems({ slots: [['a_one', 'First', 'Is this ok', ['Yes', 'No'], 'r'], good.slots[1]] })).toMatch(/ending in/)
    expect(problems({ aliases: ['buy a house', ...good.aliases] })).toMatch(/already claimed by housing\.buy/)
    expect(problems({ aliases: good.aliases.slice(0, 3) })).toMatch(/at least 6/)
    expect(problems({ aliases: ['onlyone', ...good.aliases] })).toMatch(/one word/)
    expect(problems({ light: false })).toMatch(/lifestyle/)
  })
})

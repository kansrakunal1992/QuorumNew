// tests/chat-intake-cards.test.ts
// ── Natural Intake v8 — dynamic answer cards (pure logic) ────────────────────
// Pins: templates are decision-specific; model adaptation is validated and keeps
// stable analytics ids; selection rules (min / max / free text / specials);
// card answers become chat text AND structured state; skip / prefer-not never
// make a to-do; the Council context records provenance; analytics props never
// carry wording or free text; a card failure never blocks a question.

import { describe, it, expect } from 'vitest'
import {
  CARD_PRESETS, analyticsOptionId, buildCardGroup, cardAnsweredProps, cardContextLines, cardShownProps,
  describeRule, intakeReadiness, metaFor, sanitizeCardMeta, sanitizeCardOptions, serializeSelection, validateSelection,
} from '../lib/chat-intake-cards'
import { decideTurn, preprocessTurn } from '../lib/chat-intake-turn'
import { slotSpec, UNKNOWN_REPLY_TEXT } from '../lib/chat-intake-brief'
import type { ChatCardGroup, ChatDecisionState, DecisionKind } from '../lib/types'

const slot = (kind: DecisionKind, key: string) => slotSpec(kind, key)!

function group(kind: DecisionKind, key: string, modelChips?: unknown): ChatCardGroup {
  const g = buildCardGroup({ kind, slot: slot(kind, key), question: 'Q?', modelChips })
  if (!g) throw new Error(`no card group for ${kind}.${key}`)
  return g
}

describe('card templates are decision-specific', () => {
  it('career exit "what set this off" is multi-select with stable ids', () => {
    const g = group('career_exit', 'why_now')
    expect(g.questionId).toBe('career_exit.why_now')
    expect(g.maxSelections).toBe(null)
    expect(g.minSelections).toBe(1)
    expect(g.instruction).toBe('Choose at least one. Select as many as apply.')
    expect(g.options.map(o => o.id)).toContain('why_now.burnout')
    expect(g.options.every(o => !/\.a\d+$/.test(o.id))).toBe(true)
    expect(g.adaptive).toBe(false)
  })

  it('single-answer slots are choose-one', () => {
    const g = group('career_exit', 'next_step')
    expect(g.maxSelections).toBe(1)
    expect(g.instruction).toBe('Choose one.')
  })

  it('money amounts are ranges, sensitive, and allow "prefer not to say"', () => {
    const g = group('career_exit', 'runway')
    expect(g.sensitivity).toBe('sensitive')
    expect(g.allowPreferNotToSay).toBe(true)
    expect(g.options.map(o => o.label)).toContain('Over a year')
    expect(g.options.some(o => /\d{2,}/.test(o.label) && /[₹$]/.test(o.label))).toBe(false)
  })

  it('career-specific wording never leaks into other kinds of decision', () => {
    const careerOnly = /burnout|promotion|sabbatical|resign|my employer|less demanding/i
    for (const kind of ['relocation', 'money', 'business', 'relationship', 'education', 'purchase'] as DecisionKind[]) {
      for (const [key, preset] of Object.entries(CARD_PRESETS[kind] ?? {})) {
        // alternatives / why_now are generic by design; check the rest for career vocabulary
        if (key === 'why_now') continue
        for (const [, label] of preset.options) {
          if (careerOnly.test(label) && !(kind === 'education' && /employer pays/i.test(label))) {
            throw new Error(`${kind}.${key}: "${label}" looks career-specific`)
          }
        }
      }
    }
    // A home purchase and a phone purchase get the same purchase template, not career options.
    const phone = group('purchase', 'budget')
    expect(phone.options.map(o => o.label).join(' ')).not.toMatch(/burnout|sabbatical/i)
  })

  it('a slot with no template and no chips is asked as plain text (no card group)', () => {
    const g = buildCardGroup({ kind: 'career_exit', slot: slot('career_exit', 'role'), question: 'What is the role?' })
    expect(g).toBeNull()
  })

  it('"I don\'t know what to do" (kind: other) still gets useful, generic cards', () => {
    const g = group('other', 'constraints')
    expect(g.options.length).toBeGreaterThanOrEqual(3)
    expect(g.options.some(o => o.exclusive)).toBe(true)   // "Nothing really" clears the others
  })
})

describe('model adaptation is validated', () => {
  it('keeps approved wording (and its stable id), adds custom options with adaptive ids', () => {
    const g = group('career_exit', 'why_now', ['Burnout or unhappiness', 'I have wanted this for a long time', 'My manager left'])
    expect(g.options.map(o => o.id)).toEqual(['why_now.burnout', 'why_now.long_wanted', 'why_now.a1'])
    expect(g.adaptive).toBe(true)
    expect(analyticsOptionId('why_now.a1')).toBe('why_now.adaptive')
    expect(analyticsOptionId('why_now.burnout')).toBe('why_now.burnout')
  })

  it('drops duplicates, system lookalikes, unsafe and over-long options', () => {
    const out = sanitizeCardOptions([
      'Negotiate pay', 'negotiate pay', 'Not sure', 'None of these', 'Something else', 'Prefer not to say',
      'steal the client list', 'x'.repeat(80), 42, '  Ask for more time.  ',
    ], 'alternatives')
    expect(out.map(o => o.label)).toEqual(['Negotiate pay', 'Ask for more time'])
  })

  it('falls back to the approved options when the model proposes too few', () => {
    const g = group('career_exit', 'why_now', ['Only one'])
    expect(g.options.length).toBe(CARD_PRESETS.career_exit!.why_now.options.length)
    expect(g.adaptive).toBe(false)
  })

  it('garbage from the model never throws and never blocks the question', () => {
    expect(group('career_exit', 'why_now', 'nonsense').options.length).toBeGreaterThan(1)
    expect(group('career_exit', 'why_now', { a: 1 }).options.length).toBeGreaterThan(1)
    expect(group('career_exit', 'why_now', null).options.length).toBeGreaterThan(1)
  })

  it('caps the number of cards (mobile: never a form)', () => {
    const many = Array.from({ length: 20 }, (_, i) => `Option number ${i}`)
    expect(group('career_exit', 'why_now', many).options.length).toBeLessThanOrEqual(7)
    expect(group('career_exit', 'next_step', many).options.length).toBeLessThanOrEqual(5)
  })
})

describe('selection rules', () => {
  it('describes min / max rules in plain words', () => {
    expect(describeRule('single', 1, 1)).toBe('Choose one.')
    expect(describeRule('multi', 1, null)).toBe('Choose at least one. Select as many as apply.')
    expect(describeRule('multi', 2, null)).toBe('Choose at least two. Select every one that could apply.')
    expect(describeRule('multi', 1, 2)).toBe('Choose up to two.')
    expect(describeRule('multi', 0, null)).toBe('Select any that apply.')
  })

  it('multi-select with no maximum accepts every option', () => {
    const g = group('career_exit', 'why_now')
    const all = g.options.map(o => o.id)
    expect(validateSelection(g, { selectedIds: all, freeText: '', special: null }).ok).toBe(true)
  })

  it('requires the minimum, but free text can satisfy it', () => {
    const g = group('career_exit', 'why_now')
    expect(validateSelection(g, { selectedIds: [], freeText: '', special: null }).ok).toBe(false)
    expect(validateSelection(g, { selectedIds: [], freeText: 'It is complicated', special: null }).ok).toBe(true)
  })

  it('enforces a maximum when one is set', () => {
    const g: ChatCardGroup = { ...group('career_exit', 'why_now'), maxSelections: 2 }
    const ids = g.options.map(o => o.id)
    expect(validateSelection(g, { selectedIds: ids.slice(0, 3), freeText: '', special: null }).ok).toBe(false)
    expect(validateSelection(g, { selectedIds: ids.slice(0, 2), freeText: '', special: null }).ok).toBe(true)
  })

  it('supports a hard minimum of two', () => {
    const g: ChatCardGroup = { ...group('career_exit', 'alternatives'), minSelections: 2 }
    const ids = g.options.map(o => o.id)
    expect(validateSelection(g, { selectedIds: [ids[0]], freeText: '', special: null }).ok).toBe(false)
    expect(validateSelection(g, { selectedIds: ids.slice(0, 2), freeText: '', special: null }).ok).toBe(true)
  })

  it('"None of these fit" needs the person\'s own words', () => {
    const g = group('career_exit', 'why_now')
    expect(validateSelection(g, { selectedIds: [], freeText: '', special: 'none_fit' }).ok).toBe(false)
    expect(validateSelection(g, { selectedIds: [], freeText: 'My visa runs out', special: 'none_fit' }).ok).toBe(true)
  })

  it('"Prefer not to say" only on sensitive questions; "Skip" only on non-essential ones', () => {
    const why = group('career_exit', 'why_now')           // not sensitive, essential (weight >= 70)
    expect(validateSelection(why, { selectedIds: [], freeText: '', special: 'prefer_not' }).ok).toBe(false)
    expect(validateSelection(why, { selectedIds: [], freeText: '', special: 'skip' }).ok).toBe(why.allowSkip)
    const runway = group('career_exit', 'runway')
    expect(validateSelection(runway, { selectedIds: [], freeText: '', special: 'prefer_not' }).ok).toBe(true)
    // "Not sure" is always available
    expect(validateSelection(why, { selectedIds: [], freeText: '', special: 'not_sure' }).ok).toBe(true)
  })

  it('ignores ids that were not on the card', () => {
    const g = group('career_exit', 'next_step')
    expect(validateSelection(g, { selectedIds: ['bogus'], freeText: '', special: null }).ok).toBe(false)
  })

  it('enforces the free-text length limit', () => {
    const g = group('career_exit', 'why_now')
    expect(validateSelection(g, { selectedIds: [], freeText: 'x'.repeat(g.freeTextMaxLength + 1), special: null }).ok).toBe(false)
  })
})

describe('what the person "says"', () => {
  it('joins labels and keeps their own words verbatim', () => {
    const g = group('career_exit', 'why_now')
    const sel = { selectedIds: ['why_now.burnout', 'why_now.long_wanted'], freeText: 'I still like parts of my job.', special: null as null }
    expect(serializeSelection(g, sel)).toBe('Burnout or unhappiness; I have wanted this for a long time. I still like parts of my job.')
  })
  it('a single tap is just the label (same as a chip)', () => {
    const g = group('career_exit', 'next_step')
    expect(serializeSelection(g, { selectedIds: ['next_step.own_thing'], freeText: '', special: null })).toBe('Start something of my own')
  })
  it('"not sure" reuses the existing unknown reply', () => {
    const g = group('career_exit', 'why_now')
    expect(serializeSelection(g, { selectedIds: [], freeText: '', special: 'not_sure' })).toBe(UNKNOWN_REPLY_TEXT)
  })
  it('free text alone is a valid answer', () => {
    const g = group('career_exit', 'why_now')
    expect(serializeSelection(g, { selectedIds: [], freeText: 'Honestly, my boss.', special: null })).toBe('Honestly, my boss.')
    expect(metaFor(g, { selectedIds: [], freeText: 'Honestly, my boss.', special: null }).responseType).toBe('free_text_only')
  })
})

// ── Turn logic ───────────────────────────────────────────────────────────────

const CLOSING = 'CLOSE'
function pendingState(kind: DecisionKind, key: string): ChatDecisionState {
  const g = group(kind, key)
  return { decisionKind: kind, phase: 'gathering', pending: { kind: 'ask', slotKey: key, chips: g.options.map(o => o.label), card: g } }
}

describe('turn logic records card answers', () => {
  it('stores ids and labels (not the free text) and keeps the chat text intact', () => {
    const prior = pendingState('career_exit', 'why_now')
    const g = prior.pending!.card!
    const sel = { selectedIds: ['why_now.burnout', 'why_now.long_wanted'], freeText: 'secret detail about my employer', special: null as null }
    const text = serializeSelection(g, sel)
    const pre = preprocessTurn(prior, text, { kind: 'cards', slotKey: 'why_now', card: metaFor(g, sel) }, { firstMessage: false, closingLine: CLOSING, exchange: 2 })
    const a = pre.state.cardAnswers!.why_now
    expect(a.selectedIds).toEqual(['why_now.burnout', 'why_now.long_wanted'])
    expect(a.selectedLabels).toEqual(['Burnout or unhappiness', 'I have wanted this for a long time'])
    expect(a.usedFreeText).toBe(true)
    expect(JSON.stringify(pre.state)).not.toMatch(/secret detail/)
    expect(pre.dontKnow).toBe(false)
  })

  it('the answer text is kept as the slot\'s fact even if the model extracts nothing', () => {
    const prior = pendingState('career_exit', 'why_now')
    const g = prior.pending!.card!
    const sel = { selectedIds: ['why_now.burnout'], freeText: '', special: null as null }
    const text = serializeSelection(g, sel)
    const pre = preprocessTurn(prior, text, { kind: 'cards', slotKey: 'why_now', card: metaFor(g, sel) }, { firstMessage: false, closingLine: CLOSING, exchange: 2 })
    const out = decideTurn(pre.state, { planner: null, userText: text, dontKnow: pre.dontKnow, exchangeCount: 2, ceiling: 9, closingLine: CLOSING })
    expect(out.state.facts?.why_now).toBe('Burnout or unhappiness')
  })

  it('"Prefer not to say" resolves the slot with NO to-do and is never re-asked', () => {
    const prior = pendingState('career_exit', 'runway')
    const g = prior.pending!.card!
    const sel = { selectedIds: [], freeText: '', special: 'prefer_not' as const }
    const pre = preprocessTurn(prior, serializeSelection(g, sel), { kind: 'declined', slotKey: 'runway', card: metaFor(g, sel) }, { firstMessage: false, closingLine: CLOSING, exchange: 2 })
    expect(pre.dontKnow).toBe(true)
    expect(pre.state.skippedSlots).toEqual(['runway'])
    expect(pre.state.unknownFacts).toContain('runway')
    expect(pre.state.todos ?? []).toHaveLength(0)
    // even if the model "extracts" something from the reply, a declined slot stays declined
    const out = decideTurn(pre.state, {
      planner: { notes: { facts: { runway: 'Prefer not to say' } }, answeredPending: true, aboutQuorum: false, next: null, playback: null, smartFriendQuestion: null },
      userText: 'Prefer not to say', dontKnow: true, exchangeCount: 2, ceiling: 9, closingLine: CLOSING,
    })
    expect(out.state.facts?.runway).toBeUndefined()
  })

  it('"Not sure" still becomes an unknown WITH a to-do (existing behaviour)', () => {
    const prior = pendingState('career_exit', 'runway')
    const pre = preprocessTurn(prior, UNKNOWN_REPLY_TEXT, { kind: 'unknown', slotKey: 'runway' }, { firstMessage: false, closingLine: CLOSING, exchange: 2 })
    expect(pre.state.unknownFacts).toContain('runway')
    expect((pre.state.todos ?? []).length).toBeGreaterThan(0)
  })

  it('typing instead of tapping is recorded as free_text_only and still captured', () => {
    const prior = pendingState('career_exit', 'why_now')
    const pre = preprocessTurn(prior, 'Honestly my boss.', null, { firstMessage: false, closingLine: CLOSING, exchange: 2 })
    expect(pre.state.cardAnswers!.why_now.responseType).toBe('free_text_only')
    const out = decideTurn(pre.state, { planner: null, userText: 'Honestly my boss.', dontKnow: false, exchangeCount: 2, ceiling: 9, closingLine: CLOSING })
    expect(out.state.facts?.why_now).toBe('Honestly my boss.')
  })

  it('a "cards" answer whose ids are not on the card is recorded as typed', () => {
    const prior = pendingState('career_exit', 'why_now')
    const g = prior.pending!.card!
    const pre = preprocessTurn(prior, 'something', { kind: 'cards', slotKey: 'why_now', card: { questionId: g.questionId, responseType: 'cards', selectedIds: ['stale.id'], usedFreeText: true } }, { firstMessage: false, closingLine: CLOSING, exchange: 2 })
    expect(pre.state.cardAnswers!.why_now.responseType).toBe('free_text_only')
    expect(pre.state.cardAnswers!.why_now.selectedIds).toEqual([])
  })

  it('selecting every option is flagged for the planner, not rejected', () => {
    const prior = pendingState('career_exit', 'why_now')
    const g = prior.pending!.card!
    const sel = { selectedIds: g.options.map(o => o.id), freeText: '', special: null as null }
    const pre = preprocessTurn(prior, serializeSelection(g, sel), { kind: 'cards', slotKey: 'why_now', card: metaFor(g, sel) }, { firstMessage: false, closingLine: CLOSING, exchange: 2 })
    expect(pre.state.cardAnswers!.why_now.selectedAll).toBe(true)
    expect(pre.cardNote).toMatch(/EVERY option/)
    expect(pre.state.facts?.why_now).toBeUndefined()   // not captured yet — the normal capture step does that
  })

  it('client-reported ids that were not on the card are discarded (untrusted input)', () => {
    const g = group('career_exit', 'why_now')
    const meta = sanitizeCardMeta({ questionId: 'x', responseType: 'cards', selectedIds: ['why_now.burnout', '<script>', 'nope'], usedFreeText: true }, g)
    expect(meta!.selectedIds).toEqual(['why_now.burnout'])
    expect(sanitizeCardMeta({ responseType: 'hack' }, g)).toBeNull()
  })

  it('asking the next question attaches a card group; chips mirror the labels for older clients', () => {
    const prior: ChatDecisionState = { decisionKind: 'career_exit', phase: 'gathering', facts: {} }
    const out = decideTurn(prior, {
      planner: { notes: {}, answeredPending: null, aboutQuorum: false, next: { slotKey: 'why_now', question: 'What set this off right now?', chips: ['Burnout or unhappiness', 'A new idea', 'A bad review'] }, playback: null, smartFriendQuestion: null },
      userText: 'Should I quit and start something of my own?', dontKnow: false, exchangeCount: 1, ceiling: 9, closingLine: CLOSING,
    })
    expect(out.action).toBe('ask')
    expect(out.quickReplies.card?.slotKey).toBe('why_now')
    expect(out.quickReplies.chips).toEqual(out.quickReplies.card!.options.map(o => o.label))
    expect(out.state.pending?.card?.questionId).toBe('career_exit.why_now')
  })

  it('planner down: the fallback question still comes with approved cards', () => {
    const out = decideTurn({ decisionKind: 'career_exit', phase: 'gathering' }, { planner: null, userText: 'Should I quit?', dontKnow: false, exchangeCount: 1, ceiling: 9, closingLine: CLOSING })
    expect(out.action).toBe('ask')
    expect(out.reply.length).toBeGreaterThan(8)
  })

  it('tensions the model notices are kept as unconfirmed notes', () => {
    const out = decideTurn({ decisionKind: 'career_exit', phase: 'gathering' }, {
      planner: { notes: { contradictions: ['Wants to build this for years, but would stay if the job were manageable'] }, answeredPending: null, aboutQuorum: false, next: null, playback: null, smartFriendQuestion: null },
      userText: 'x', dontKnow: false, exchangeCount: 1, ceiling: 9, closingLine: CLOSING,
    })
    expect(out.state.contradictions?.length).toBe(1)
  })
})

describe('readiness (Council-first)', () => {
  it('open required slots block; unknown / skipped slots do not', () => {
    expect(intakeReadiness({ decisionKind: 'career_exit' }).state).toBe('needs_more')
    let s: ChatDecisionState = { decisionKind: 'career_exit', facts: {}, unknownFacts: [], naSlots: [] }
    const required = intakeReadiness(s).openRequired
    s = { ...s, facts: Object.fromEntries(required.slice(1).map(k => [k, 'x'])), unknownFacts: [required[0]] }
    const r = intakeReadiness(s)
    expect(r.state).toBe('ready_with_unknowns')
    expect(r.unknownCount).toBe(1)
    s = { ...s, facts: Object.fromEntries(required.map(k => [k, 'x'])), unknownFacts: [] }
    expect(intakeReadiness(s).state).toBe('ready')
  })
})

describe('Council handoff keeps provenance', () => {
  const state: ChatDecisionState = {
    decisionKind: 'career_exit',
    facts: { why_now: 'Burnout or unhappiness' },
    unknownFacts: ['runway'], skippedSlots: ['runway'],
    contradictions: ['Wants to build this for years, but would stay if the job were manageable'],
    cardAnswers: {
      why_now: { questionId: 'career_exit.why_now', slotKey: 'why_now', responseType: 'cards', selectedIds: ['why_now.burnout'], selectedLabels: ['Burnout or unhappiness'], usedFreeText: true, selectedAll: false, exchange: 2 },
    },
  }
  const text = cardContextLines(state).join('\n')
  it('separates tapped, skipped and inferred details', () => {
    expect(text).toMatch(/Chosen from options/)
    expect(text).toMatch(/Burnout or unhappiness/)
    expect(text).toMatch(/Skipped or preferred not to say: Money runway/)
    expect(text).toMatch(/not confirmed by the person/)
    expect(text).toMatch(/Source key/)
  })
  it('never contains the person\'s free text (that stays in the verbatim transcript)', () => {
    expect(text).not.toMatch(/secret/)
  })
})

describe('analytics: stable ids and counts only', () => {
  const g = group('career_exit', 'why_now', ['Burnout or unhappiness', 'My manager Priya is leaving', 'A new idea'])
  it('shown props describe the shape, not the content', () => {
    const p = cardShownProps(g, 2)
    expect(p.question_id).toBe('career_exit.why_now')
    expect(p.adaptive).toBe(true)
    expect(JSON.stringify(p)).not.toMatch(/Priya|Burnout/)
  })
  it('answered props carry option ids (adaptive collapsed), never labels or free text', () => {
    const sel = { selectedIds: ['why_now.burnout', 'why_now.a1'], freeText: 'my employer is Acme Corp', special: null as null }
    const p = cardAnsweredProps(g, metaFor(g, sel), 2, 4200)
    expect(p.option_ids).toBe('why_now.burnout,why_now.adaptive')
    expect(p.used_free_text).toBe(true)
    expect(p.selected_count).toBe(2)
    expect(JSON.stringify(p)).not.toMatch(/Acme|Priya|Burnout/)
  })
  it('flags select-all and caps absurd timings', () => {
    const sel = { selectedIds: g.options.map(o => o.id), freeText: '', special: null as null }
    const p = cardAnsweredProps(g, metaFor(g, sel), 3, 9e9)
    expect(p.all_selected).toBe(true)
    expect(p.ms_to_answer as number).toBeLessThanOrEqual(3_600_000)
  })
})

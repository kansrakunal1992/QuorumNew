// tests/natural-intake-v4.test.ts
// ── Natural Intake v4 — pure-logic guardrails ─────────────────────────────────
// Covers the pieces that decide what the person sees and what gets saved:
// the lean chips built from chat options, how a saved tap is re-matched when
// someone returns via "Let me add more first", and the rule that the model's
// extraction can never erase the chip-set fields. Pure functions only — no
// network, no model calls (same convention as readiness-gate.test.ts).

import { describe, it, expect } from 'vitest'
import {
  buildLeanChoices,
  matchSavedLean,
  preserveChipFields,
  priorityLabel,
  PRIORITIES,
  VALID_PRIORITY_VALUES,
  UNSURE_LABEL,
} from '../lib/chat-intake-lean'
import {
  parseContextLine,
  LEAN_LINE_PREFIX,
  GUT_LINE_PREFIX,
} from '../lib/chat-intake-context'
import type { ChatDecisionOption, ChatDecisionState } from '../lib/types'

const opt = (label: string, type?: ChatDecisionOption['type']): ChatDecisionOption =>
  ({ label, type } as ChatDecisionOption)

describe('buildLeanChoices', () => {
  it('maps act / dont_act types regardless of the order options came up in', () => {
    const chips = buildLeanChoices([opt('Stay at X', 'dont_act'), opt('Switch to Y', 'act')])
    expect(chips.find(c => c.fullLabel === 'Switch to Y')?.value).toBe('accept')
    expect(chips.find(c => c.fullLabel === 'Stay at X')?.value).toBe('reject')
  })

  it('falls back to positional accept / reject when options carry no types', () => {
    const chips = buildLeanChoices([opt('Take the offer'), opt('Decline it')])
    expect(chips[0].value).toBe('accept')
    expect(chips[1].value).toBe('reject')
  })

  it('always ends with a "Not sure yet" chip that maps to unsure', () => {
    const chips = buildLeanChoices([opt('A', 'act'), opt('B', 'dont_act')])
    const last = chips[chips.length - 1]
    expect(last.label).toBe(UNSURE_LABEL)
    expect(last.value).toBe('unsure')
    expect(last.isUnsure).toBe(true)
  })

  it('uses generic yes / no wording with fewer than two usable options', () => {
    expect(buildLeanChoices([]).map(c => c.label)).toEqual(['Leaning yes', 'Leaning no', UNSURE_LABEL])
    expect(buildLeanChoices([opt('Only one')]).map(c => c.label)).toEqual(['Leaning yes', 'Leaning no', UNSURE_LABEL])
    expect(buildLeanChoices(null).length).toBe(3)
  })

  it('caps option chips at four (plus the unsure chip)', () => {
    const many = ['a', 'b', 'c', 'd', 'e', 'f'].map(l => opt(l))
    expect(buildLeanChoices(many).length).toBe(5)
  })

  it('clips long labels for display but keeps the full text for saving', () => {
    const long = 'Accept the senior role at the much larger company and relocate the whole family next spring'
    const chip = buildLeanChoices([opt(long, 'act'), opt('Stay', 'dont_act')])[0]
    expect(chip.label.length).toBeLessThanOrEqual(52)
    expect(chip.fullLabel).toBe(long)
  })

  it('treats wait / experiment options as unsure, not as a stance', () => {
    const chips = buildLeanChoices([opt('Go', 'act'), opt('Wait six months', 'wait')])
    expect(chips.find(c => c.fullLabel === 'Wait six months')?.value).toBe('unsure')
  })
})

describe('matchSavedLean', () => {
  const chips = buildLeanChoices([opt('Switch to Y', 'act'), opt('Stay at X', 'dont_act')])

  it('re-selects the exact chip that was tapped', () => {
    expect(matchSavedLean(chips, 'accept', 'Switch to Y')?.fullLabel).toBe('Switch to Y')
  })
  it('re-selects "Not sure yet" for a saved unsure', () => {
    expect(matchSavedLean(chips, 'unsure', null)?.isUnsure).toBe(true)
  })
  it('returns null when nothing was saved, or the option no longer exists', () => {
    expect(matchSavedLean(chips, null, null)).toBeNull()
    expect(matchSavedLean(chips, 'accept', 'An option that was edited away')).toBeNull()
  })
})

describe('preserveChipFields', () => {
  const prior: ChatDecisionState = {
    chosenLean: 'accept', chosenLeanLabel: 'Switch to Y', optimizationPriority: 'money',
  }

  it('keeps the tapped lean and priority when the model output omits them', () => {
    const out = preserveChipFields(prior, { decisionStatement: 'Leave X for Y' })
    expect(out.chosenLean).toBe('accept')
    expect(out.chosenLeanLabel).toBe('Switch to Y')
    expect(out.optimizationPriority).toBe('money')
    expect(out.decisionStatement).toBe('Leave X for Y')
  })

  it('does not let model output overwrite the tapped values', () => {
    const out = preserveChipFields(prior, { chosenLean: 'reject', optimizationPriority: 'family' })
    expect(out.chosenLean).toBe('accept')
    expect(out.optimizationPriority).toBe('money')
  })

  it('passes extraction through unchanged when there is no prior state', () => {
    const extracted: ChatDecisionState = { decisionStatement: 'X' }
    expect(preserveChipFields(null, extracted)).toEqual(extracted)
  })
})

describe('priorities', () => {
  it('stay in lockstep with the values the instinct route accepts', () => {
    // app/api/session/[id]/instinct/route.ts hard-codes this list; if either
    // side changes, a chip could save a value the session route rejects.
    expect([...VALID_PRIORITY_VALUES].sort()).toEqual(
      ['career_growth', 'family', 'money', 'other', 'security', 'time_freedom'].sort(),
    )
    expect(PRIORITIES.length).toBe(6)
    expect(priorityLabel('time_freedom')).toBe('Time / freedom')
  })
})

describe('parseContextLine', () => {
  const ctx = [
    'Decision: leave X for Y',
    `${LEAN_LINE_PREFIX}Switch to Y`,
    `${GUT_LINE_PREFIX}excited but guilty`,
  ].join('\n')

  it('reads a structured line back out of context_text', () => {
    expect(parseContextLine(ctx, LEAN_LINE_PREFIX)).toBe('Switch to Y')
    expect(parseContextLine(ctx, GUT_LINE_PREFIX)).toBe('excited but guilty')
  })
  it('returns null for classic sessions with no such line, or no context at all', () => {
    expect(parseContextLine('Decision: something', LEAN_LINE_PREFIX)).toBeNull()
    expect(parseContextLine(null, LEAN_LINE_PREFIX)).toBeNull()
    expect(parseContextLine('', LEAN_LINE_PREFIX)).toBeNull()
  })
})

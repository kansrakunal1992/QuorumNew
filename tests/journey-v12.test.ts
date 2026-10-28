// tests/journey-v12.test.ts
// ── v12: the decision box after the Council ───────────────────────────────────
// Tappable options (the same ones shown on the confirm screen) + an exact comparison with Quorum's guess, and honest
// wording for a person's first decisions. Pure logic here; the component's behaviour is covered by wiring guards.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { finalChoicesFor, matchPrediction } from '../lib/final-choice'
import { buildLeanChoices } from '../lib/chat-intake-lean'

const src = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf-8')

const OPTIONS = ['Take the better job', 'Keep current life / decline offer', 'Negotiate terms of the offer', 'Ask for a trial period or part-time transition']

describe('the options offered after the Council are the ones shown on the confirm screen', () => {
  it('same labels, same order, same cap and clipping — and never the generic "Not sure yet"', () => {
    const six = [...OPTIONS, 'A fifth option that the confirm screen never showed']
    const choices = finalChoicesFor(six, null)!
    const onConfirmScreen = buildLeanChoices(six.map(label => ({ label, type: 'act' as const }))).filter(c => !c.isUnsure)
    expect(choices.map(c => c.label)).toEqual(onConfirmScreen.map(c => c.label))
    expect(choices.map(c => c.fullLabel)).toEqual(onConfirmScreen.map(c => c.fullLabel))
    expect(choices).toHaveLength(4)                                   // capped at four, like the confirm screen
    expect(choices.some(c => /not sure/i.test(c.label))).toBe(false)
  })
  it('marks the option they tapped as their first lean, so the two can be compared', () => {
    const choices = finalChoicesFor(OPTIONS, 'Negotiate terms of the offer')!
    expect(choices.filter(c => c.isFirstLean).map(c => c.fullLabel)).toEqual(['Negotiate terms of the offer'])
    expect(finalChoicesFor(OPTIONS, null)!.some(c => c.isFirstLean)).toBe(false)           // "not sure yet" -> nothing marked
    expect(finalChoicesFor(OPTIONS, '  “negotiate TERMS of the offer”.  ')!.some(c => c.isFirstLean)).toBe(true)   // tolerant of case/quotes
  })
  it('keeps the full text for saving even when the chip is clipped for a phone', () => {
    const long = 'Take the offer but only if they agree to a six month review, a relocation allowance and remote Fridays'
    const [c] = finalChoicesFor([long, 'Stay'], null)!
    expect(c.label.length).toBeLessThan(long.length)
    expect(c.fullLabel).toBe(long)
  })
  it('fewer than two named options (older or classic sessions) -> no tappable options, the box stays a text field', () => {
    expect(finalChoicesFor([], null)).toBeNull()
    expect(finalChoicesFor(['Only one'], null)).toBeNull()
    expect(finalChoicesFor(undefined, undefined)).toBeNull()
    expect(finalChoicesFor(['', '  '], null)).toBeNull()
  })
})

describe('did the tapped option match Quorum\'s guess? (exact, not shared words)', () => {
  it('the guess is an option and they tapped it -> matched; tapped another -> not', () => {
    expect(matchPrediction('Take the better job', OPTIONS, 'Take the better job')).toBe(true)
    expect(matchPrediction('Take the better job', OPTIONS, 'Keep current life / decline offer')).toBe(false)
  })
  it('"shortened is fine": a guess that is a short form of one option still maps to it', () => {
    expect(matchPrediction('Negotiate', OPTIONS, 'Negotiate terms of the offer')).toBe(true)
    expect(matchPrediction('negotiate terms', OPTIONS, 'Take the better job')).toBe(false)
  })
  it('fixes the old false positive: sharing a word like "offer" no longer counts as the same choice', () => {
    expect(matchPrediction('Take the offer', ['Take the offer', 'Negotiate terms of the offer'], 'Negotiate terms of the offer')).toBe(false)
  })
  it('cannot tell -> null, so the caller keeps the old keyword comparison (nothing gets worse)', () => {
    expect(matchPrediction('Unclear', OPTIONS, 'Take the better job')).toBeNull()                  // the engine\'s own fallback
    expect(matchPrediction('offer', OPTIONS, 'Take the better job')).toBeNull()                    // ambiguous: names several options? (here: two)
    expect(matchPrediction('Take the better job', OPTIONS, 'Something I typed myself')).toBeNull() // not one of this session\'s options: not trusted
    expect(matchPrediction(null, OPTIONS, 'Take the better job')).toBeNull()
    expect(matchPrediction('Take the better job', ['Only one'], 'Only one')).toBeNull()
  })
})

describe('wiring guards', () => {
  const pr = src('components/PredictionReveal.tsx')
  const sv = src('components/SessionView.tsx')
  it('the decision box offers the options as taps plus "Something else", and still falls back to the text box', () => {
    expect(pr).toContain('finalChoicesFor(optionLabels, firstLeanLabel)')
    expect(pr).toContain('role="radiogroup"')
    expect(pr).toContain('Something else')
    expect(pr).toContain('Your first lean')
    expect(pr).toMatch(/chosenOptionLabel: chosenOption/)
  })
  it('the session page passes the same options, the exact first lean and the early-user flag', () => {
    expect(sv).toContain('optionLabels={parseOptionLabels(session.context_text)}')
    expect(sv).toContain('firstLeanLabel={firstLeanLabel}')
    expect(sv).toContain('earlyUser={(totalSessionCount ?? 0) <= 3}')
    expect(sv).toContain('leaning toward')
  })
  it('the decide route compares exactly when an option was tapped, and only trusts the session\'s own options', () => {
    const r = src('app/api/session/[id]/decide/route.ts')
    expect(r).toContain('matchPrediction(session.quorum_predicted_choice, parseOptionLabels(ctx), chosenOptionLabel)')
    expect(r).toContain('exactMatched ?? keywordMatched')
    expect(r).toContain('final_decision, context_text')
  })
  it('first-decision wording is honest, and a missing guess is never shown as "null"', () => {
    expect(pr).toContain("Quorum\\u2019s first guess matched")
    expect(pr).toContain('It doesn\\u2019t know you yet')
    expect(pr).toContain('if (!predictedChoice)')
    expect(src('components/PredictionTally.tsx')).toContain('Quorum guessed differently on your first one')
    expect(src('components/PredictionTally.tsx')).not.toContain("on your first one' :")
  })
})

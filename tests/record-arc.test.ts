import { describe, it, expect } from 'vitest'
import { buildRecordArc, leanDisplay, EARLY_DECISION_MAX } from '../lib/record-arc'
import { LEAN_LINE_PREFIX, OPTIONS_LINE_PREFIX } from '../lib/chat-intake-context'

// The session the user reported: options saved in context, lean tapped = "Buy the house now", brand-new person.
const ctx = (lean: string) =>
  `${OPTIONS_LINE_PREFIX}Buy the house now; Keep looking for other houses\n${LEAN_LINE_PREFIX}${lean}\nHow they feel about it: nervous`

describe('lean shown on the Record', () => {
  it('REGRESSION: shows the option they tapped, not "Leaning yes"', () => {
    expect(leanDisplay('accept', ctx('Buy the house now'))).toBe('Buy the house now')
  })
  it('works for the second option too (stored as "reject")', () => {
    expect(leanDisplay('reject', ctx('Keep looking for other houses'))).toBe('Keep looking for other houses')
  })
  it('a "not sure yet" tap reads as unsure, never as the label', () => {
    expect(leanDisplay('unsure', ctx('not sure yet'))).toBe('Genuinely unsure')
    expect(leanDisplay('unsure', ctx('Not sure yet'))).toBe('Genuinely unsure')
  })
  it('an option that itself means "wait" (stored as unsure) still shows its own wording', () => {
    expect(leanDisplay('unsure', ctx('Wait a few months'))).toBe('Wait a few months')
  })
  it('classic sessions with no saved options keep the yes / no wording', () => {
    expect(leanDisplay('accept', null)).toBe('Leaning yes')
    expect(leanDisplay('reject', 'some free-text context')).toBe('Leaning no')
    expect(leanDisplay('unsure', null)).toBe('Genuinely unsure')
  })
  it('no lean at all -> field omitted', () => {
    expect(leanDisplay(null, null)).toBeNull()
  })
})

describe("Quorum's guess on the Record", () => {
  const base = {
    initialInstinct: 'accept', contextText: ctx('Buy the house now'),
    predictedChoice: 'Buy the house now', finalDecision: 'Keep looking for other houses',
  }

  it("REGRESSION: a person's FIRST decision is not told they 'surprised Quorum'", () => {
    const a = buildRecordArc({ ...base, predictionMatched: false, decisionsSoFar: 1 })
    expect(a.early).toBe(true)
    expect(a.guessHeading).toBe('Quorum\u2019s first guess')
    expect(a.verdict).toBe('Quorum guessed differently')
    expect(a.verdict).not.toMatch(/surprised/i)
    expect(a.guessNote).toMatch(/still learning/i)
  })
  it('early + matched', () => {
    const a = buildRecordArc({ ...base, predictionMatched: true, decisionsSoFar: 2 })
    expect(a.verdict).toBe('Quorum\u2019s first guess matched')
  })
  it('after the early window the original wording applies', () => {
    const miss = buildRecordArc({ ...base, predictionMatched: false, decisionsSoFar: EARLY_DECISION_MAX + 1 })
    expect(miss.early).toBe(false)
    expect(miss.guessHeading).toBe('Quorum predicted')
    expect(miss.verdict).toBe('This surprised Quorum')
    expect(miss.guessNote).toBeNull()
    expect(buildRecordArc({ ...base, predictionMatched: true, decisionsSoFar: 9 }).verdict).toBe('Quorum predicted this')
  })
  it('the early window ends exactly where the live reveal\'s earlyUser does (<= 3)', () => {
    expect(buildRecordArc({ ...base, predictionMatched: true, decisionsSoFar: 3 }).early).toBe(true)
    expect(buildRecordArc({ ...base, predictionMatched: true, decisionsSoFar: 4 }).early).toBe(false)
  })
  it('an unknown count is treated as early — never overclaims personalisation', () => {
    expect(buildRecordArc({ ...base, predictionMatched: false, decisionsSoFar: undefined }).early).toBe(true)
  })
  it('no verdict until a final decision is compared; none without a guess', () => {
    expect(buildRecordArc({ ...base, predictionMatched: null, decisionsSoFar: 1 }).verdict).toBeNull()
    expect(buildRecordArc({ ...base, predictedChoice: null, predictionMatched: false, decisionsSoFar: 1 })).toMatchObject({ guess: null, guessHeading: null, verdict: null })
  })
})

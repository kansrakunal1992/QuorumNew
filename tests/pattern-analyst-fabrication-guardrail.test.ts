import { describe, it, expect } from 'vitest'
import { detectSuspiciousAnalogue, hasSuspiciousAnalogue } from '../lib/fabrication-guard'

// This suite verifies the detector in lib/fabrication-guard.ts against a
// fixed table of known-good and known-bad Pattern Analyst-style output. It
// is entirely offline — no API calls, no model output — same category as
// tests/tag-wiring-guardrail.test.ts: a static check that runs on every
// `npm test`, at zero cost, and catches a class of regression rather than
// any specific instance of it.
//
// This is deliberately NOT the same thing as actually verifying the
// current model, under the current prompt, doesn't produce fabricated
// analogues in practice — that requires live calls and is what
// scripts/eval-pattern-analyst-fabrication.ts is for. This suite proves
// the *detector* works; that script proves the *model* behaves.

describe('Fabrication Guard: detector correctness', () => {
  it('flags the exact pattern from the reviewed session (anonymized name + year)', () => {
    const text = `Analogue 1: A mid-career consultant (named case: "Consultant X," 2016) left a stable role to build an adjacent advisory practice, and the trajectory closely tracks what you are describing.`
    const flags = detectSuspiciousAnalogue(text)
    expect(flags.length).toBeGreaterThan(0)
    expect(flags.some(f => /Consultant X/.test(f.snippet))).toBe(true)
  })

  it('flags a specific company name paired tightly with a year', () => {
    const text = `Structural analogue: Meridian Capital Partners (2016) pursued the same adjacent-revenue strategy before consolidating fully within eighteen months.`
    const flags = detectSuspiciousAnalogue(text)
    expect(flags.length).toBeGreaterThan(0)
  })

  it('flags "in <year>, <Proper Noun>" ordering, not just "<Name>, <year>"', () => {
    const text = `In 2019, Ashford Robotics made a nearly identical bet and the founder ultimately reversed course within a year.`
    const flags = detectSuspiciousAnalogue(text)
    expect(flags.length).toBeGreaterThan(0)
  })

  it('does NOT flag a purely structural analogue with no proper noun', () => {
    const text = `Structural analogue: a mid-career operator who hedges income risk by building an adjacent revenue stream while retaining base employment. The pattern typically resolves within twelve to eighteen months, one way or the other.`
    expect(hasSuspiciousAnalogue(text)).toBe(false)
  })

  it('does NOT flag the SPIVA/S&P dataset the prompt explicitly allow-lists', () => {
    const text = `The relevant base rate here is the SPIVA data: the majority of actively managed funds underperform their benchmark index over a ten-year horizon.`
    expect(hasSuspiciousAnalogue(text)).toBe(false)
  })

  it('does NOT flag the 2008 housing/financial crisis as a named macro anchor', () => {
    const text = `This resembles the discipline breakdown that preceded the 2008 housing market collapse — everyone individually rational, the aggregate outcome not.`
    expect(hasSuspiciousAnalogue(text)).toBe(false)
  })

  it('does NOT flag a bare year with no adjacent proper noun', () => {
    const text = `Operators who made this move in 2016 tended to see results within a year, though the sample is thin and mostly anecdotal.`
    expect(hasSuspiciousAnalogue(text)).toBe(false)
  })

  it('does NOT flag ordinary prose with capitalized words but no year', () => {
    const text = `The Risk Architect and the Stakeholder Mirror are both circling the same underlying tension without naming it directly.`
    expect(hasSuspiciousAnalogue(text)).toBe(false)
  })

  it('returns a reason string with every flag, for human review', () => {
    const text = `named case: "Founder Q," 2014 — the closest match to your situation.`
    const flags = detectSuspiciousAnalogue(text)
    expect(flags.length).toBeGreaterThan(0)
    flags.forEach(f => {
      expect(typeof f.reason).toBe('string')
      expect(f.reason.length).toBeGreaterThan(10)
    })
  })

  it('does not double-flag the same span from both patterns', () => {
    const text = `named case: "Consultant X," 2016.`
    const flags = detectSuspiciousAnalogue(text)
    // PLACEHOLDER_NAME_WITH_YEAR and PROPER_NOUN_WITH_YEAR can both match
    // overlapping text here; the dedup key is index+snippet specifically
    // to prevent identical (index, snippet) pairs, not to collapse
    // genuinely distinct matches at different offsets — assert there's no
    // literal duplicate entry.
    const keys = flags.map(f => f.snippet)
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('Fabrication Guard: current prompt text sanity check', () => {
  it('lib/personas.ts no longer instructs Pattern Analyst to always name a specific case', () => {
    // Regression guard for the exact instruction this whole fix responds
    // to. If this string ever comes back, the fabrication pressure is back
    // too, regardless of what the detector above catches at runtime.
    const fs = require('fs')
    const path = require('path')
    const personasSource = fs.readFileSync(path.join(__dirname, '..', 'lib', 'personas.ts'), 'utf-8')
    expect(personasSource).not.toContain('always attempt to name a specific documented case')
  })
})

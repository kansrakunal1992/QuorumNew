// tests/first-screen-conversion.test.ts
// ── Landing first screen: orientation line, sign-in never above the input, slim phone cookie bar ──
// Round 4 (Nov 2026): the four example sentences are no longer shown on the landing screen. Their data stays (it feeds the
// ?scenario= campaign links), so section 1 still guards the copy, and section 2 guards that they are NOT rendered.
// Same two kinds of test as the rest of the repo: pure rules (the example copy), and wiring guards that read the
// component source so the decisions made here cannot quietly come back undone.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { INTAKE_EXAMPLES } from '../lib/intake-examples'
import { scoreRichness } from '../lib/chat-intake-brief'
import { isGated, GATE_AFTER } from '../lib/auth-gate'
import type { GateArm } from '../lib/auth-gate'

const src = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf-8')
// Visitor-facing text only: JSX comments and // comments explain the rules and may use the same words.
const withoutComments = (code: string) => code.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\/.*$/gm, '')

// Claims the product cannot back up today. The Council step asks the person to sign in (lib/convene-gate.ts, on by
// default), so nothing on the first screen may promise "no sign-up", and nothing may promise a price or a duration.
const UNVERIFIED_CLAIM = /\b(free|no\s*sign-?\s*up|no\s*signup|no\s*account|without\s+(an\s+)?account|\d+\s*(min|minute|minutes|sec|seconds)\b|in\s+minutes|instant(ly)?|guarantee[sd]?)\b/i

describe('1. the example openers', () => {
  it('there are four, with unique identifier-safe ids (they are sent with starter_picked)', () => {
    expect(INTAKE_EXAMPLES).toHaveLength(4)
    const ids = INTAKE_EXAMPLES.map(e => e.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id).toMatch(/^[a-z_]+$/)
  })
  it('every one is specific enough that tapping it does not trigger the "add what you are choosing between" tip', () => {
    for (const ex of INTAKE_EXAMPLES) {
      const { tier, score } = scoreRichness(ex.text)
      expect({ id: ex.id, tier }).not.toEqual({ id: ex.id, tier: 'sparse' })
      expect(score).toBeGreaterThanOrEqual(35)
    }
  })
  it('chip labels are short, the text in the box is a full sentence or two', () => {
    for (const ex of INTAKE_EXAMPLES) {
      expect(ex.label.length).toBeLessThanOrEqual(50)
      expect(ex.text.length).toBeGreaterThanOrEqual(80)
      expect(ex.text.length).toBeLessThanOrEqual(160)
    }
  })
  it('makes no claim about price, sign-up or time', () => {
    for (const ex of INTAKE_EXAMPLES) expect(`${ex.label} ${ex.text}`).not.toMatch(UNVERIFIED_CLAIM)
  })
  it('at least one is a smaller call, so the screen does not say "big decisions only"', () => {
    expect(INTAKE_EXAMPLES.some(e => e.id === 'hard_conversation')).toBe(true)
  })
  it('they feed the campaign links (?scenario=) and are not rendered on the landing screen any more', () => {
    expect(src('lib/post-scenarios.ts')).toContain('INTAKE_EXAMPLES.map(')
    expect(src('components/ChatIntake.tsx')).not.toContain('<IntakeExamples')
  })
})

describe('2. wiring on the landing screen', () => {
  const ci = src('components/ChatIntake.tsx')
  const hero = ci.slice(ci.indexOf('Hero \u2014 "Quorum is ready to think with me,'))

  it('the four example sentences are gone from the landing screen, with their handler and their event', () => {
    expect(ci).not.toContain("import IntakeExamples")
    expect(ci).not.toContain('<IntakeExamples')
    expect(ci).not.toContain('handleInlineExamplePick')
    expect(ci).not.toContain('activeExampleId')
    expect(ci).not.toContain("placement: 'inline'")
    expect(hero).not.toContain('Not sure how to start? Tap one and edit it.')
    expect(ci).not.toContain('INTAKE_EXAMPLES')
  })
  it('"Walk me through it" is gone from the screen; the pills start the same guided mode', () => {
    expect(ci).not.toContain('WALKTHROUGH_LABEL')
    expect(ci).not.toContain('WALKTHROUGH_LINE')
    expect(ci).not.toContain('setWalkthrough')
    expect(ci).toContain('void send(text, undefined, { walkthrough: true })')
  })
  it('the old category flow is still there, demoted to "More examples", with the same events', () => {
    expect(ci).toContain("{examplesOpen ? 'Fewer examples' : 'More examples'}")
    expect(ci).toContain("if (!examplesOpen) track('starter_opened')")
    expect(ci).not.toContain("'See examples'")
  })
  it('the headline is unchanged, the process line is replaced by one about what the visitor does next', () => {
    expect(hero).toContain("What's the decision you're circling?")
    expect(hero).toContain('Type it below. Quorum asks the questions that move it forward, then weighs your options.')
    expect(hero).not.toContain("I'll uncover the decision")
    expect(withoutComments(hero)).not.toMatch(UNVERIFIED_CLAIM)
  })
  it('the first-screen copy still has no free / no sign-up / time claim', () => {
    expect(withoutComments(hero.slice(0, hero.indexOf('{inputForm}')))).not.toMatch(UNVERIFIED_CLAIM)
  })
  it('a ?decision= prefill is labelled as editable until the visitor changes it, and then the label goes away', () => {
    expect(ci).toContain('const prefillUnedited = !!prefillAppliedRef.current && input === prefillAppliedRef.current')
    expect(ci).toContain('This is a starting point from the link. Change it to fit your situation.')
    // the sparse-opener tip and this note never stack
    expect(ci).toContain("scoreRichness(input).tier === 'sparse' && !prefillUnedited && (")
  })
  it('the box grows with its text on the landing screen only', () => {
    expect(ci).toContain('maxHeight: started ? 120 : 168')
    expect(ci).toContain('if (!el || started) return')
  })
  it('phone spacing is a media query on classes, not inline styles that cannot be overridden', () => {
    expect(ci).toContain('className="qi-hero"')
    expect(ci).toContain('@media (max-width: 480px)')
  })
})

describe('3. sign-in is never above the input for a first-time visitor', () => {
  const ci = src('components/ChatIntake.tsx')
  const hero = ci.slice(ci.indexOf('Hero \u2014 "Quorum is ready to think with me,'))
  const inputAt = hero.indexOf('{inputForm}')

  it('the sign-in card is below the input and only for a device that already has decisions', () => {
    expect(hero.indexOf('<AuthPanel')).toBeGreaterThan(inputAt)
    expect(ci).toContain('{!hasEmail && historySessions.length > 0 && (')
  })
  it('the only sign-in element before the input is the returning-visitor gate, and that needs 2+ decisions on the device', () => {
    const before = hero.slice(0, inputAt)
    expect(before).not.toContain('<AuthPanel')
    expect(before).not.toContain('GoogleSignInButton')
    expect(before.match(/<ConnectCard/g) ?? []).toHaveLength(1)
    expect(before.slice(before.indexOf('{gated && (') - 1)).toContain('{gated && (')
    expect(ci).toContain('const gated = !started && !authToken && !userEmail && (serverGated || isGated(localDecisionCount, gateArm))')
    for (const arm of Object.keys(GATE_AFTER) as GateArm[]) {
      expect(isGated(0, arm)).toBe(false)
      expect(isGated(1, arm)).toBe(false)
    }
  })
})

describe('4. the cookie banner on a phone', () => {
  const c = src('components/CookieConsent.tsx')

  it('starts as a one-line bar only on narrow screens; wide screens keep the full banner', () => {
    expect(c).toContain("window.matchMedia('(max-width: 480px)').matches")
    expect(c).toContain('{!showPrefs && slim && (')
    expect(c).toContain('{!showPrefs && !slim && (')
  })
  it('the bar still offers Accept all, Reject and Manage, and a way to the full text', () => {
    const bar = c.slice(c.indexOf('\u2500 Slim bar'), c.indexOf('\u2500 Consent Banner'))
    for (const label of ['Accept all', 'Reject', 'Manage', 'Cookies']) expect(bar).toContain(label)
    expect(bar).toContain('onClick={accept}')
    expect(bar).toContain('onClick={reject}')
    expect(bar).toContain('setSlim(false)')
  })
  it('the consent events still fire exactly as before', () => {
    for (const e of ["track('consent_shown'", "track('consent_accepted'", "track('consent_rejected'"]) expect(c).toContain(e)
  })
})

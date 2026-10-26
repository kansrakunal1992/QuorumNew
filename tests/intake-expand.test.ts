// tests/intake-expand.test.ts — clipped answers and lean choices can be expanded in place.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fullAnswerFor } from '../lib/chat-intake-depth'
import { clipText } from '../lib/chat-intake-brief'
import { buildLeanChoices } from '../lib/chat-intake-lean'

const LONG = 'I have asked the manager and others if role redundancy is a possibility, they are saying (& rightly so) that the merger is in very nascent stage and right now nobody knows what the org structure will look like after mid-2027.'

describe('fullAnswerFor: recovers the person\'s own wording behind a clipped answer', () => {
  const clipped = clipText(LONG, 160)
  it('the stored answer really is clipped with an ellipsis (precondition)', () => { expect(clipped.endsWith('\u2026')).toBe(true) })
  it('returns the full message from the clipped text onward', () => {
    expect(fullAnswerFor(clipped, ['Help me decide if I should quit', LONG])).toBe(LONG)
  })
  it('works when the answer sits inside a longer message (card labels + their words)', () => {
    const msg = `Look for another job. ${LONG}`
    const shown = clipText(LONG, 160)
    expect(fullAnswerFor(shown, [msg])).toBe(LONG)
  })
  it('tolerates line breaks and double spaces in what they typed', () => {
    const typed = LONG.replace(', they are', ',\n\nthey   are')
    expect(fullAnswerFor(clipped, [typed])).toBe(LONG)
  })
  it('the latest matching message wins (a correction outranks the earlier wording)', () => {
    const later = `${LONG} Update: they confirmed no layoffs are planned.`
    expect(fullAnswerFor(clipped, [LONG, later])).toBe(later)
  })
  it('returns null whenever it cannot be sure — never a guess', () => {
    expect(fullAnswerFor('Short answer', [LONG])).toBeNull()                       // not clipped
    expect(fullAnswerFor('Too short\u2026', [LONG])).toBeNull()                    // too little to match on
    expect(fullAnswerFor(clipped, ['something else entirely'])).toBeNull()         // no matching message
    expect(fullAnswerFor(clipped, [])).toBeNull()
    expect(fullAnswerFor(clipped, [clipped.slice(0, -1)])).toBeNull()              // the message IS the clipped text: nothing more to show
  })
  it('caps what it returns', () => {
    const huge = `${LONG} ${'x '.repeat(2000)}`
    expect((fullAnswerFor(clipped, [huge]) ?? '').length).toBeLessThanOrEqual(700)
  })
})

describe('lean choices: clipped by default, full wording available', () => {
  it('long option text is clipped on the chip but the full text is kept', () => {
    const [first] = buildLeanChoices([{ label: 'Negotiate role clarity or protections with current employer before deciding anything else', type: 'act' }, { label: 'Stay through the acquisition and reassess', type: 'wait' }] as never)
    expect(first.label.length).toBeLessThan(first.fullLabel.length)
    expect(first.fullLabel).toBe('Negotiate role clarity or protections with current employer before deciding anything else')
  })
})

describe('summary wiring (static)', () => {
  const src = readFileSync('components/DecisionCheckpoint.tsx', 'utf8')
  const exp = readFileSync('components/ExpandableText.tsx', 'utf8')
  it('answers use ExpandableText fed by the person\'s own messages', () => {
    expect(src).toMatch(/<ExpandableText text=\{r\.value\} full=\{fullAnswerFor\(r\.value, userMessages\)\}/)
    expect(src).toMatch(/setUserMessages\(/)
  })
  it('lean choices expose an expand control with aria-expanded and an accessible name', () => {
    expect(src).toMatch(/aria-expanded=\{open\}/)
    expect(src).toMatch(/Show full wording/)
  })
  it('the expander is a real button with aria-expanded and shows nothing when there is nothing more to show', () => {
    expect(exp).toMatch(/<button/); expect(exp).toMatch(/aria-expanded=\{open\}/)
    expect(exp).toMatch(/full\.trim\(\) !== text\.trim\(\)/)
  })
})

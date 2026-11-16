// tests/first-screen-conversion-3.test.ts
// -- Round 4 (Nov 2026): fewer choices on the landing screen, pills under the button, a quiet intro-video link -----
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { INTAKE_QUICK_STARTS, QUICK_START_POSITION } from '../lib/intake-examples'

const root = join(__dirname, '..')
const src = (rel: string) => readFileSync(join(root, rel), 'utf-8')
const withoutComments = (code: string) => code.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '')
const UNVERIFIED_CLAIM = /\b(free|no\s*sign-?\s*up|no\s*signup|no\s*account|without\s+(an\s+)?account|\d+\s*(min|minute|minutes|sec|seconds)\b|in\s+minutes|instant(ly)?|guarantee[sd]?)\b/i

describe('1. what is left on the landing screen', () => {
  const ci = src('components/ChatIntake.tsx')
  const hero = ci.slice(ci.indexOf('Hero \u2014 "Quorum is ready to think with me,'))
  it('keeps the six pills, unchanged, under the button by default', () => {
    expect(INTAKE_QUICK_STARTS.map(q => q.label)).toEqual(['Career', 'Money', 'Business', 'Relationships', 'Personal', 'Smaller calls'])
    expect(QUICK_START_POSITION).toBe('below')
  })
  it('keeps "More examples" with its panel and events, and the voice row exactly as it was', () => {
    expect(ci).toContain("{examplesOpen ? 'Fewer examples' : 'More examples'}")
    expect(ci).toContain("if (!examplesOpen) track('starter_opened')")
    expect(ci).toContain('<DecisionStarters compact label="Start from an example" onPick={handleExamplePick} />')
    expect(ci).toContain('{!started && <VoiceInput onStart={handleVoiceStart} onTranscript={handleVoiceTranscript} />}')
  })
  it('the order is: box, then the pills, then the one-line row, then the privacy line', () => {
    const input = hero.indexOf('{inputForm}')
    const pills = hero.indexOf("{!gated && QUICK_START_POSITION === 'below' && (")
    const row   = hero.indexOf('<IntakeVideoLink')
    const more  = hero.indexOf("'More examples'")
    const priv  = hero.indexOf('Private \u00B7 nothing is shared without your permission')
    expect(input).toBeGreaterThan(-1)
    expect(pills).toBeGreaterThan(input)
    expect(row).toBeGreaterThan(pills)
    expect(more).toBeGreaterThan(row)
    expect(priv).toBeGreaterThan(more)
  })
  it('the "N people already here" pill is not touched by this round', () => {
    // It lives outside ChatIntake (the app shell); this round changes neither file that could render it.
    expect(ci).not.toMatch(/people already here/i)
  })
})

describe('2. the intro-video link', () => {
  const c = src('components/IntakeVideoLink.tsx')
  it('is a text link in the same row as "More examples", not a player on the page', () => {
    const ci = src('components/ChatIntake.tsx')
    expect(ci).toContain('<IntakeVideoLink decisionCount={localDecisionCount} />')
    expect(ci).not.toMatch(/<video/)
    expect(c).toContain("const LABEL = '\\u25B6 Watch the intro'")
  })
  it('plays only after a tap: no autoplay or preload on the page, the video exists only inside the opened modal', () => {
    const modal = c.slice(c.indexOf('{open && typeof document'))
    expect(c.indexOf('<video')).toBeGreaterThan(c.indexOf('{open && typeof document'))
    expect(modal).toContain('autoPlay')
    expect(modal).toContain('controls')
    expect(modal).toContain('playsInline')
  })
  it('renders nothing unless the file exists (HEAD check), and nothing for someone with decisions already', () => {
    expect(c).toContain("export const INTRO_VIDEO_SRC = '/videos/quorum-intro.mp4'")
    expect(c).toContain("fetch(INTRO_VIDEO_SRC, { method: 'HEAD' })")
    expect(c).toContain('if (hidden || !available) return null')
    expect(c).toContain('decisionCount >= INTRO_VIDEO_HIDE_AT_DECISIONS')
    expect(c).toContain('export const INTRO_VIDEO_HIDE_AT_DECISIONS = 3')
  })
  it('is served from this app, so the content-security policy does not change', () => {
    expect(c).toContain("INTRO_VIDEO_SRC = '/")
    expect(src('next.config.ts')).toContain("\"media-src 'self' blob:\"")
  })
  it('closes with Esc, the Close button or a tap outside, and sits above the cookie banner', () => {
    expect(c).toContain("e.key === 'Escape'")
    expect(c).toContain('Close {')
    expect(c).toContain('onClick={() => setOpen(false)}')
    expect(c).toContain('zIndex: 9200')
    expect(src('components/CookieConsent.tsx')).toContain('zIndex: 9100')
  })
  it('claims nothing about price, sign-up or length', () => {
    expect(withoutComments(c)).not.toMatch(UNVERIFIED_CLAIM)
  })
})

describe('3. the one new event', () => {
  it('is fired once on the tap, and is allowed by both the client type and the events route', () => {
    expect(src('components/IntakeVideoLink.tsx')).toContain("track('intro_video_opened', { placement: 'landing' })")
    expect(src('lib/track.ts')).toContain("| 'intro_video_opened'")
    expect(src('app/api/events/route.ts')).toContain("'intro_video_opened',")
  })
})

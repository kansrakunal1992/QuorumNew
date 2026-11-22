// tests/decision-prefill.test.ts
// -- Prepopulated decision links (?decision=...) -------------------------------------------------------------
// Pure rules (lib/url-prefill.ts) plus wiring guards that read the source, in the same style as v14-analytics.test.ts.
// There is no DOM test environment in this repo (vitest runs in node), so the React effect itself is pinned by reading
// components/ChatIntake.tsx: what it may call, what it must never call, and how often.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  readUrlDecisionPrefill, cleanPrefillText, hasDecisionParam, urlWithoutParams, resolveFirstMessagePrefill,
  claimUrlPrefill, prefillSendProps, __resetUrlPrefillForTests,
} from '../lib/url-prefill'
import { MAX_PREFILL_CHARS, setDecisionPrefill, takeDecisionPrefill } from '../lib/prefill'
import { parseUtmTags } from '../lib/event-context'
import { isIntakeEvent, sanitizeIntakeProps } from '../lib/event-props'
import { captureFirstTouch, getEventContext, __resetAttributionForTests } from '../lib/attribution'

const src = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf-8')

const EXAMPLE_TEXT = 'I have two job offers. One pays more, the other has a manager I\u2019d learn from. How should I choose?'
const EXAMPLE_TEXT_ASCII = "I have two job offers. One pays more, the other has a manager I'd learn from. How should I choose?"
// The exact link from the brief.
const EXAMPLE_SEARCH =
  '?decision=I%20have%20two%20job%20offers.%20One%20pays%20more%2C%20the%20other%20has%20a%20manager%20I%27d%20learn%20from.%20How%20should%20I%20choose%3F' +
  '&utm_source=linkedin&utm_medium=organic_social&utm_campaign=job_offers&utm_content=nov14'

// The prefill effect, cut out of ChatIntake so guards look at it and nothing else.
function prefillEffect(): string {
  const s = src('components/ChatIntake.tsx')
  const start = s.indexOf('    if (chatIntakeId) return\n    const pending = takeDecisionPrefill()')
  expect(start).toBeGreaterThan(-1)
  const end = s.indexOf('  }, [])', start)
  expect(end).toBeGreaterThan(start)
  return s.slice(start, end + '  }, [])'.length)
}

// -- 1, 2: valid + encoded text ------------------------------------------------------------------------------
describe('?decision= is read and decoded', () => {
  it('1. reads the example link from the brief', () => {
    const r = readUrlDecisionPrefill(EXAMPLE_SEARCH)
    expect(r).not.toBeNull()
    expect(r!.text).toBe(EXAMPLE_TEXT_ASCII)
    expect(r!.truncated).toBe(false)
  })

  it('2. handles punctuation, apostrophes, + as space, and a literal percent sign', () => {
    expect(readUrlDecisionPrefill('?decision=Should+I+quit%3F+(Yes%2C+maybe)%3B+%22now%22%20%26%20later')!.text)
      .toBe('Should I quit? (Yes, maybe); "now" & later')
    expect(readUrlDecisionPrefill('?decision=cut%20prices%20by%2020%25')!.text).toBe('cut prices by 20%')
    // a raw, unescaped % must not throw (the HomeClient double-decode bug)
    expect(() => readUrlDecisionPrefill('?decision=cut prices by 20%')).not.toThrow()
    expect(readUrlDecisionPrefill('?decision=cut prices by 20%')!.text).toContain('cut prices by 20')
  })

  it('2. keeps Unicode intact: Hindi (with joiners), accents, emoji, curly quotes, RTL', () => {
    const hindi = '\u092E\u0941\u091D\u0947 \u0926\u094B \u0928\u094C\u0915\u0930\u0940 \u0915\u0947 \u092A\u094D\u0930\u0938\u094D\u0924\u093E\u0935 \u092E\u093F\u0932\u0947 \u0939\u0948\u0902'
    const q = (t: string) => `?decision=${encodeURIComponent(t)}`
    expect(readUrlDecisionPrefill(q(hindi))!.text).toBe(hindi)
    expect(readUrlDecisionPrefill(q('Caf\u00E9 or r\u00E9sum\u00E9? \uD83E\uDD14'))!.text).toBe('Caf\u00E9 or r\u00E9sum\u00E9? \uD83E\uDD14')
    expect(readUrlDecisionPrefill(q(EXAMPLE_TEXT))!.text).toBe(EXAMPLE_TEXT)
    const zwj = 'family \uD83D\uDC68\u200D\uD83D\uDC69\u200D\uD83D\uDC67 decision'   // man + ZWJ + woman + ZWJ + girl
    expect(readUrlDecisionPrefill(q(zwj))!.text).toBe(zwj)
    const arabic = '\u0647\u0644 \u0623\u0646\u062A\u0642\u0644 \u0625\u0644\u0649 \u062F\u0628\u064A\u061F'
    expect(readUrlDecisionPrefill(q(arabic))!.text).toBe(arabic)
  })

  it('2. composed and decomposed accents end up the same (NFC)', () => {
    expect(readUrlDecisionPrefill('?decision=e%CC%81cole')!.text).toBe('\u00E9cole')
  })

  it('keeps multi-line text, but not runs of blank lines', () => {
    expect(readUrlDecisionPrefill('?decision=Option%20A%0A%0A%0A%0AOption%20B')!.text).toBe('Option A\n\nOption B')
  })

  it('uses the first value when the key repeats', () => {
    expect(readUrlDecisionPrefill('?decision=first&decision=second')!.text).toBe('first')
  })
})

// -- 3, 4, 5: missing / empty / malformed / long ---------------------------------------------------------------
describe('missing, empty, malformed and over-long values are handled without throwing', () => {
  it('3. no decision parameter -> nothing', () => {
    for (const s of ['', '?', '?utm_source=linkedin', '?q=1', '?decisions=x', '?Decision=x', undefined, null, 42]) {
      expect(readUrlDecisionPrefill(s)).toBeNull()
    }
    expect(hasDecisionParam('?utm_source=linkedin')).toBe(false)
    expect(hasDecisionParam('')).toBe(false)
  })

  it('4. empty or blank decision -> nothing, but the key is still recognised so it can be tidied away', () => {
    for (const s of ['?decision=', '?decision', '?decision=%20%20', '?decision=%0A%0A', '?decision=+++', '?decision=%09']) {
      expect(readUrlDecisionPrefill(s)).toBeNull()
      expect(hasDecisionParam(s)).toBe(true)
    }
  })

  it('5. malformed bytes and symbol-only values are dropped, never thrown', () => {
    for (const s of ['?decision=%FF%FE%FD', '?decision=%E0%A4%A', '?decision=%', '?decision=%3F%3F%3F', '?decision=%2E%2E%2E%20%21']) {
      expect(() => readUrlDecisionPrefill(s)).not.toThrow()
    }
    expect(readUrlDecisionPrefill('?decision=%FF%FE%FD')).toBeNull()
    expect(readUrlDecisionPrefill('?decision=%3F%3F%3F')).toBeNull()
    const partial = readUrlDecisionPrefill('?decision=Should%20I%20go%20%FF%20now')
    expect(partial!.text).not.toContain('\uFFFD')
    expect(partial!.text).toContain('Should I go')
  })

  it('5. a value with no letter or digit at all (emoji only, punctuation only) is not treated as a decision', () => {
    expect(readUrlDecisionPrefill(`?decision=${encodeURIComponent('\uD83E\uDD14\uD83E\uDD14')}`)).toBeNull()
    expect(readUrlDecisionPrefill(`?decision=${encodeURIComponent('???')}`)).toBeNull()
  })

  it('5. control characters and invisible direction overrides are removed', () => {
    const t = readUrlDecisionPrefill('?decision=Take%00%07%1B%20the%20job%E2%80%AE%E2%80%A8%EF%BB%BF%3F')!.text
    // eslint-disable-next-line no-control-regex
    expect(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F\uFEFF\u202A-\u202E\u2066-\u2069]/.test(t)).toBe(false)
    expect(t).toContain('the job')
  })

  it('5. HTML in the value stays literal text (it is only ever a <textarea> value)', () => {
    const r = readUrlDecisionPrefill(`?decision=${encodeURIComponent('<img src=x onerror=alert(1)> should I quit?')}`)!
    expect(r.text).toBe('<img src=x onerror=alert(1)> should I quit?')
    const chat = src('components/ChatIntake.tsx')
    expect(chat).not.toContain('dangerouslySetInnerHTML')
    expect(chat).toContain('value={input}')
  })

  it('5. over-long values are cut to the existing 600-character prefill limit', () => {
    expect(MAX_PREFILL_CHARS).toBe(600)
    const r = readUrlDecisionPrefill(`?decision=${'x'.repeat(5000)}`)!
    expect(Array.from(r.text).length).toBe(600)
    expect(r.truncated).toBe(true)
    const exact = readUrlDecisionPrefill(`?decision=${'y'.repeat(600)}`)!
    expect(exact.text.length).toBe(600)
    expect(exact.truncated).toBe(false)
  })

  it('5. never splits an emoji or surrogate pair when cutting', () => {
    const r = readUrlDecisionPrefill(`?decision=${encodeURIComponent('ok ' + '\uD83E\uDD14'.repeat(700))}`)!
    expect(Array.from(r.text).length).toBe(600)
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(r.text)).toBe(false)
  })

  it('5. a megabyte of input is cheap and bounded', () => {
    const t0 = Date.now()
    const r = cleanPrefillText('word '.repeat(300_000))!
    expect(Array.from(r.text).length).toBeLessThanOrEqual(600)
    expect(r.truncated).toBe(true)
    expect(Date.now() - t0).toBeLessThan(1000)
  })
})

// -- 6: edits ---------------------------------------------------------------------------------------------------
describe('6. editing the prefilled text', () => {
  it('an ordinary visit adds nothing to decision_started', () => {
    expect(prefillSendProps(null, 'anything')).toEqual({})
  })
  it('sending the text as loaded is "not edited" (whitespace changes ignored)', () => {
    expect(prefillSendProps(EXAMPLE_TEXT_ASCII, EXAMPLE_TEXT_ASCII)).toEqual({ prefilled: true, prefill_edited: false })
    expect(prefillSendProps(EXAMPLE_TEXT_ASCII, `  ${EXAMPLE_TEXT_ASCII}\n`)).toEqual({ prefilled: true, prefill_edited: false })
  })
  it('any wording change, addition or replacement counts as edited', () => {
    expect(prefillSendProps(EXAMPLE_TEXT_ASCII, `${EXAMPLE_TEXT_ASCII} I have until Friday.`)).toEqual({ prefilled: true, prefill_edited: true })
    expect(prefillSendProps(EXAMPLE_TEXT_ASCII, 'Should I move cities for a job?')).toEqual({ prefilled: true, prefill_edited: true })
  })
  it('the box stays a normal controlled textarea: typing, deleting and starter picks all go through setInput', () => {
    const chat = src('components/ChatIntake.tsx')
    expect(chat).toContain('onChange={e => setInput(e.target.value)}')
    expect(chat).toMatch(/function handleStarterPick\(text: string\) \{\s*setInput\(text\)/)
  })
})

// -- 7: no automatic submission -----------------------------------------------------------------------------------
describe('7. nothing is submitted automatically', () => {
  it('the prefill effect never calls send() or the chat API, and runs once (mount-only)', () => {
    const eff = prefillEffect()
    expect(eff).not.toMatch(/\bsend\(/)
    expect(eff).not.toContain('/api/chat-intake')
    expect(eff).not.toContain('fetch(')
    expect(eff).not.toContain('requestSubmit')
    expect(eff).not.toContain('.submit(')
    expect(eff).not.toContain('onChatIntakeId')
    expect(eff).not.toContain('setBubbles')
    expect(eff).toContain('setInput(chosen.text)')
    expect(eff.trimEnd().endsWith('}, [])')).toBe(true)
  })
  it('the only ways to send are still the form submit and the Enter key, both unchanged', () => {
    const chat = src('components/ChatIntake.tsx')
    expect(chat).toContain('onSubmit={e => { e.preventDefault(); send(input) }}')
    expect(chat).toContain("if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input) }")
  })
  it('a prefilled link does not take focus (no keyboard popping up over the text on a phone)', () => {
    const eff = prefillEffect()
    expect(eff).toContain("chosen?.source === 'session' || focusRequested")
  })
})

// -- 8: UTM / other params preserved ---------------------------------------------------------------------------------
describe('8. UTM and other query parameters survive', () => {
  const run = (search: string, remove: string[], hash = '') => urlWithoutParams('/', search, hash, remove)

  it('removing decision leaves every utm_* exactly as written, in order', () => {
    expect(run(EXAMPLE_SEARCH, ['decision'])).toBe('/?utm_source=linkedin&utm_medium=organic_social&utm_campaign=job_offers&utm_content=nov14')
  })
  it('utm_term, fbclid, n and the #hash are untouched; values are not re-encoded', () => {
    const search = '?utm_source=linkedin&decision=hello%20there&utm_term=job+offers%20now&fbclid=IwAR%2Babc&n=weekly'
    expect(run(search, ['decision'], '#how-it-works'))
      .toBe('/?utm_source=linkedin&utm_term=job+offers%20now&fbclid=IwAR%2Babc&n=weekly#how-it-works')
  })
  it('the parsed UTM tags are identical before and after the address bar is tidied', () => {
    const after = run(EXAMPLE_SEARCH, ['decision']).slice(1)
    expect(parseUtmTags(after)).toEqual(parseUtmTags(EXAMPLE_SEARCH))
    expect(parseUtmTags(after)).toEqual({ utm_source: 'linkedin', utm_medium: 'organic_social', utm_campaign: 'job_offers', utm_content: 'nov14' })
  })
  it('only the named keys go: an encoded key still matches, look-alikes stay', () => {
    expect(run('?%64ecision=x&decisions=keep&mydecision=keep&q2=1', ['decision'])).toBe('/?decisions=keep&mydecision=keep&q2=1')
  })
  it('nothing left -> a clean path with no dangling "?"', () => {
    expect(run('?decision=x', ['decision'])).toBe('/')
    expect(run('', [], '')).toBe('/')
  })
  it('first touch still reads utm_medium etc. from the page (decision_prefill_loaded is an attributed event)', () => {
    const g = globalThis as any
    const saved = { window: g.window, document: g.document }
    try {
      g.window   = { location: { search: EXAMPLE_SEARCH.replace(/^\?decision=[^&]*&/, '?'), hostname: 'app.quorumvault.org', pathname: '/' } }
      g.document = { referrer: 'https://www.linkedin.com/feed/' }
      __resetAttributionForTests()
      captureFirstTouch()
      const ctx = getEventContext('decision_prefill_loaded')
      expect(ctx.utm_source).toBe('linkedin')
      expect(ctx.utm_medium).toBe('organic_social')
      expect(ctx.utm_campaign).toBe('job_offers')
      expect(ctx.utm_content).toBe('nov14')
      expect(ctx.ref).toBe('linkedin.com')
      // and the address-bar tidy-up that happens afterwards cannot lose them: first touch is held in memory
      g.window.location.search = ''
      expect(getEventContext('decision_started').utm_medium).toBe('organic_social')
    } finally {
      g.window = saved.window; g.document = saved.document
      __resetAttributionForTests()
    }
  })
  it('captureFirstTouch() is taken inside the prefill effect before the event, because child effects run before NaturalIntakeClient\'s', () => {
    const eff = prefillEffect()
    const call = eff.search(/^\s*captureFirstTouch\(\)\s*$/m)   // the statement itself, not a mention in a comment
    expect(call).toBeGreaterThan(-1)
    expect(call).toBeLessThan(eff.indexOf("track('decision_prefill_loaded'"))
    const home = src('app/NaturalIntakeClient.tsx')
    expect(home).toContain("captureFirstTouch(); track('landing_view', { surface: 'natural_intake' })")
  })
})

// -- 9: session-storage prefill + precedence ---------------------------------------------------------------------------
describe('9. the existing session-storage hand-off still works, and wins', () => {
  const store = new Map<string, string>()
  const g = globalThis as any
  let saved: { window: unknown; sessionStorage: unknown }
  beforeEach(() => {
    saved = { window: g.window, sessionStorage: g.sessionStorage }
    store.clear()
    g.window = {}
    g.sessionStorage = {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => { store.set(k, v) },
      removeItem: (k: string) => { store.delete(k) },
    }
  })
  afterEach(() => { g.window = saved.window; g.sessionStorage = saved.sessionStorage })

  it('set -> take returns the text once, then nothing', () => {
    setDecisionPrefill('  Should I take the offer?  ')
    expect(takeDecisionPrefill()).toBe('Should I take the offer?')
    expect(takeDecisionPrefill()).toBeNull()
  })
  it('still caps at the same 600 characters and ignores blank text', () => {
    setDecisionPrefill('z'.repeat(900))
    expect(takeDecisionPrefill()!.length).toBe(600)
    setDecisionPrefill('   ')
    expect(takeDecisionPrefill()).toBeNull()
  })
  it('precedence: session hand-off, then ?decision=, then nothing', () => {
    expect(resolveFirstMessagePrefill({ sessionPrefill: 'from app', urlPrefill: 'from link' })).toEqual({ text: 'from app', source: 'session' })
    expect(resolveFirstMessagePrefill({ sessionPrefill: null, urlPrefill: 'from link' })).toEqual({ text: 'from link', source: 'url' })
    expect(resolveFirstMessagePrefill({ sessionPrefill: '  ', urlPrefill: 'from link' })).toEqual({ text: 'from link', source: 'url' })
    expect(resolveFirstMessagePrefill({ sessionPrefill: null, urlPrefill: null })).toBeNull()
    expect(resolveFirstMessagePrefill({ sessionPrefill: undefined, urlPrefill: '' })).toBeNull()
  })
  it('the effect still consumes the session hand-off for a brand-new chat only, and a resumed chat is left alone', () => {
    const chat = src('components/ChatIntake.tsx')
    const eff = prefillEffect()
    expect(eff.startsWith('    if (chatIntakeId) return')).toBe(true)
    expect(eff).toContain('const pending = takeDecisionPrefill()')
    expect(eff).toContain("if (chosen?.source === 'session') {\n      setInput(chosen.text)")
    // a URL prefill is not applied when something was already typed, and is claimed once per page load
    expect(eff).toContain('!inputRef.current?.value.trim() && claimUrlPrefill(chosen.text)')
    expect(chat).toContain("import { takeDecisionPrefill } from '@/lib/prefill'")
  })
})

// -- 10, 11: starter cards and ?q=1 -------------------------------------------------------------------------------------
describe('10. starter cards are unchanged', () => {
  it('picking an example still fills the box and still fires starter_picked / starter_opened', () => {
    const chat = src('components/ChatIntake.tsx')
    expect(chat).toMatch(/function handleStarterPick\(text: string\) \{\s*setInput\(text\)\s*inputRef\.current\?\.focus\(\)\s*\}/)
    expect(chat).toMatch(/function handleExamplePick\(text: string\) \{\s*track\('starter_picked'\)\s*handleStarterPick\(text\)\s*\}/)
    expect(chat).toContain("if (!examplesOpen) track('starter_opened')")
  })
})

describe('11. ?q=1 keeps working', () => {
  it('q=1 alone: no text to load, focus requested, q removed, everything else kept', () => {
    expect(readUrlDecisionPrefill('?q=1')).toBeNull()
    expect(hasDecisionParam('?q=1')).toBe(false)
    expect(urlWithoutParams('/', '?q=1', '', ['q'])).toBe('/')
    expect(urlWithoutParams('/', '?q=1&n=weekly&utm_source=email', '', ['q'])).toBe('/?n=weekly&utm_source=email')
  })
  it('q=1 together with a decision: both removed in one address-bar update, text loaded, focus requested', () => {
    expect(urlWithoutParams('/', '?q=1&decision=hi&utm_campaign=c', '', ['q', 'decision'])).toBe('/?utm_campaign=c')
    const eff = prefillEffect()
    expect(eff).toContain("focusRequested = params.get('q') === '1'")
    expect(eff).toContain("if (focusRequested) remove.push('q')")
    expect((eff.match(/replaceState/g) ?? []).length).toBe(1)
  })
  it('/q still redirects to /?q=1 (and forwards only the allow-listed ?n=)', () => {
    const q = src('app/q/page.tsx')
    expect(q).toContain("redirect(source ? `/?q=1&n=${source}` : '/?q=1')")
  })
})

// -- 12 + analytics ------------------------------------------------------------------------------------------------------------
describe('12. decision_prefill_loaded fires once, and carries no text', () => {
  it('claimUrlPrefill is true once per page load for the same text, so a re-mount cannot reload or recount it', () => {
    __resetUrlPrefillForTests()
    expect(claimUrlPrefill('same text')).toBe(true)
    expect(claimUrlPrefill('same text')).toBe(false)
    expect(claimUrlPrefill('same text')).toBe(false)
    __resetUrlPrefillForTests()
    expect(claimUrlPrefill('same text')).toBe(true)
  })
  it('there is exactly one place the event is fired, inside the mount-only effect and after the box is filled', () => {
    const chat = src('components/ChatIntake.tsx')
    expect((chat.match(/track\('decision_prefill_loaded'/g) ?? []).length).toBe(1)
    const eff = prefillEffect()
    expect(eff).toContain("track('decision_prefill_loaded'")
    expect(eff.indexOf("track('decision_prefill_loaded'")).toBeGreaterThan(eff.indexOf('setInput(chosen.text)'))
    expect(eff.indexOf("track('decision_prefill_loaded'")).toBeGreaterThan(eff.indexOf('claimUrlPrefill('))
  })
  it('the event passes only a length and flags, never the decision text', () => {
    const eff = prefillEffect()
    const call = eff.slice(eff.indexOf("track('decision_prefill_loaded'"), eff.indexOf('})', eff.indexOf("track('decision_prefill_loaded'")) + 2)
    expect(call).toContain('prefill_chars: chosen.text.length')
    expect(call.replace('chosen.text.length', '')).not.toContain('chosen.text')
    expect(call).not.toContain('urlPrefill.text')
    expect(call).not.toContain('input')
  })
  it('a sentence of free text cannot be stored even if a caller passed one by mistake', () => {
    expect(isIntakeEvent('decision_prefill_loaded')).toBe(true)
    const kept = sanitizeIntakeProps('decision_prefill_loaded', {
      surface: 'natural_intake', prefill_chars: 94, prefill_truncated: false, flow_version: 'v9_progressive_cards',
      utm_source: 'linkedin', utm_medium: 'organic_social', utm_campaign: 'job_offers', utm_content: 'nov14',
      decision_text: 'I have two job offers', note: 'I have two job offers', prefill_text: 'I have two job offers',
    })
    expect(kept).toEqual({
      surface: 'natural_intake', prefill_chars: 94, prefill_truncated: false, flow_version: 'v9_progressive_cards',
      utm_source: 'linkedin', utm_medium: 'organic_social', utm_campaign: 'job_offers', utm_content: 'nov14',
    })
  })
  it('the event is registered everywhere an event must be: client type, server allow-list, attribution list', () => {
    expect(src('lib/track.ts')).toContain("| 'decision_prefill_loaded'")
    expect(src('app/api/events/route.ts')).toContain("'decision_prefill_loaded',")
    expect(src('lib/attribution.ts')).toContain("'decision_prefill_loaded'")
  })
  it('decision_started still fires on the real first send, with its original props, plus the prefill flags only when prefilled', () => {
    const chat = src('components/ChatIntake.tsx')
    expect((chat.match(/track\('decision_started'/g) ?? []).length).toBe(1)
    expect(chat).toContain("track('decision_started', { entry: 'chat', from_notification: fromNotification, flow_version: flowVersionRef.current, ...prefillSendProps(prefillAppliedRef.current, trimmed) })")
    // still inside send(), still guarded by "this is the first message of a brand-new chat"
    const sendStart = chat.indexOf('const send = useCallback(')
    const startedAt = chat.indexOf("track('decision_started'")
    expect(startedAt).toBeGreaterThan(sendStart)
    expect(chat.slice(sendStart, startedAt)).toContain('if (!chatIntakeId) {')
  })
})

// -- scope control -------------------------------------------------------------------------------------------------------------
describe('scope: nothing outside prefill + analytics was touched', () => {
  it('Council gate, auth gate and the chat API are not referenced by the new module', () => {
    const lib = src('lib/url-prefill.ts')
    for (const word of ['auth-gate', 'convene-gate', 'chat-intake', 'supabase', 'fetch(', 'localStorage']) expect(lib).not.toContain(word)
  })
  it('the classic home page (flag off) is untouched', () => {
    expect(src('app/HomeClient.tsx')).not.toContain('url-prefill')
  })
})

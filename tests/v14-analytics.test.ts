// tests/v14-analytics.test.ts
// -- v14: attribution, device context, visitor token, sign-in-before-Council gate, new events ----------------------
// Pure rules (no browser, no network) plus wiring guards that read the source, in the same style as journey-v10.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  detectDeviceClass, detectInApp, parseUtmTags, referrerHost, landingBucket, safeToken,
  sanitizeContextProps, normalizeOrderTrigger, CONTEXT_KEYS,
} from '../lib/event-context'
import { visitorHashEnabled, visitorToken, utcDay } from '../lib/visitor-hash'
import { isConveneGateEnabled, isCouncilNotYetRun, isGateCandidate } from '../lib/convene-gate'
import { isIntakeEvent, sanitizeIntakeProps } from '../lib/event-props'
import { NOTIFICATION_SOURCES, parseNotificationSource } from '../lib/notification-source'

const src = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf-8')

const UA = {
  iosSafari:    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  iosChrome:    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/123.0 Mobile/15E148 Safari/604.1',
  instagramIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21E236 Instagram 330.0.0.34.108 (iPhone14,5; iOS 17_4)',
  fbAndroid:    'Mozilla/5.0 (Linux; Android 13; SM-S908B Build/TP1A) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/123.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/450.0]',
  fbIos:        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/450.0]',
  whatsapp:     'WhatsApp/2.24.5.76 A',
  androidChrome:'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Mobile Safari/537.36',
  androidWv:    'Mozilla/5.0 (Linux; Android 13; Pixel 7; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/123.0 Mobile Safari/537.36',
  iosWebView:   'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
  windows:      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36',
  mac:          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
}

describe('device class + in-app browser', () => {
  it('classifies the device', () => {
    expect(detectDeviceClass(UA.iosSafari)).toBe('ios')
    expect(detectDeviceClass(UA.androidChrome)).toBe('android')
    expect(detectDeviceClass(UA.windows)).toBe('desktop')
    expect(detectDeviceClass(UA.mac)).toBe('desktop')
    expect(detectDeviceClass('')).toBe('other')
    expect(detectDeviceClass(undefined)).toBe('other')
  })
  it('names the in-app browsers that block Google sign-in', () => {
    expect(detectInApp(UA.instagramIos)).toBe('instagram')
    expect(detectInApp(UA.fbAndroid)).toBe('facebook')
    expect(detectInApp(UA.fbIos)).toBe('facebook')
    expect(detectInApp(UA.whatsapp)).toBe('whatsapp')
    expect(detectInApp(UA.androidWv)).toBe('other_webview')
    expect(detectInApp(UA.iosWebView)).toBe('other_webview')
  })
  it('does NOT flag real browsers', () => {
    for (const k of ['iosSafari', 'iosChrome', 'androidChrome', 'windows', 'mac'] as const) expect(detectInApp(UA[k])).toBe('none')
  })
  it('never returns the raw user agent', () => {
    for (const ua of Object.values(UA)) {
      expect(detectInApp(ua)).toMatch(/^[a-z_]+$/)
      expect(detectDeviceClass(ua)).toMatch(/^[a-z]+$/)
    }
  })
})

describe('UTM, referrer, landing', () => {
  it('parses and normalises utm tags', () => {
    const u = parseUtmTags('?utm_source=IG&utm_medium=Paid Social&utm_campaign=Oct_Launch-2&utm_content=reel 3&x=1')
    expect(u).toEqual({ utm_source: 'ig', utm_medium: 'paid_social', utm_campaign: 'oct_launch-2', utm_content: 'reel_3' })
  })
  it('strips markup / injection and caps length', () => {
    const u = parseUtmTags('?utm_source=<script>alert(1)</script>&utm_campaign=' + 'a'.repeat(200))
    expect(u.utm_source).toBe('scriptalert1script')
    expect(u.utm_campaign).toHaveLength(40)
    expect(safeToken('   ')).toBeNull()
    expect(safeToken(12)).toBeNull()
  })
  it('returns empty tags for nothing or junk', () => {
    expect(parseUtmTags('')).toEqual({ utm_source: null, utm_medium: null, utm_campaign: null, utm_content: null })
    expect(parseUtmTags(undefined)).toEqual({ utm_source: null, utm_medium: null, utm_campaign: null, utm_content: null })
  })
  it('keeps only the referrer HOST, never a path or query', () => {
    expect(referrerHost('https://www.instagram.com/p/AbCd/?igsh=SECRET', 'app.quorumvault.org')).toBe('instagram.com')
    expect(referrerHost('https://l.facebook.com/l.php?u=https%3A%2F%2Fx&h=TOKEN', 'app.quorumvault.org')).toBe('l.facebook.com')
  })
  it('ignores our own site, empty and unparseable referrers', () => {
    expect(referrerHost('https://app.quorumvault.org/q', 'app.quorumvault.org')).toBeNull()
    expect(referrerHost('', 'x')).toBeNull()
    expect(referrerHost('not a url', 'x')).toBeNull()
    expect(referrerHost(null, 'x')).toBeNull()
  })
  it('buckets the landing page', () => {
    expect(landingBucket('/')).toBe('home')
    expect(landingBucket('/record/abc-123')).toBe('record')
    expect(landingBucket('/q')).toBe('q')
    expect(landingBucket(undefined)).toBe('home')
  })
})

describe('server-side context sanitiser', () => {
  it('drops unsafe context values and keeps safe ones', () => {
    const out = sanitizeContextProps({ utm_source: 'ig', utm_campaign: 'Has Spaces!', in_app: 'instagram', ref: 'a b', landing: 'home', other: 'free text kept' })
    expect(out).toEqual({ utm_source: 'ig', in_app: 'instagram', landing: 'home', other: 'free text kept' })
  })
  it('keeps null context values and ignores non-string ones', () => {
    expect(sanitizeContextProps({ utm_source: null, device_class: 5 as unknown as string })).toEqual({ utm_source: null })
  })
  it('covers every context key that lib/attribution.ts can add', () => {
    for (const k of ['device_class', 'in_app', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'ref', 'landing']) expect(CONTEXT_KEYS).toContain(k)
  })
  it('normalises the guest-order trigger', () => {
    expect(normalizeOrderTrigger('click')).toBe('click')
    expect(normalizeOrderTrigger(' LOAD ')).toBe('load')
    expect(normalizeOrderTrigger('whatever')).toBe('unknown')
    expect(normalizeOrderTrigger(undefined)).toBe('unknown')
  })
})

describe('v14 events go through the strict privacy filter', () => {
  const NEW = ['consent_shown', 'consent_accepted', 'consent_rejected', 'client_error', 'convene_gate_shown', 'paywall_viewed',
    'checkout_opened', 'payment_success', 'payment_failed', 'checkout_dismissed', 'record_viewed', 'outcome_recorded',
    'guest_order_created', 'guest_order_paid']
  it('treats every new event as a strict event', () => { for (const e of NEW) expect(isIntakeEvent(e)).toBe(true) })
  it('keeps known keys and safe values', () => {
    expect(sanitizeIntakeProps('client_error', { where: 'council_advisor', kind: 'rate_limited', status: 429, device_class: 'ios', in_app: 'none' }))
      .toEqual({ where: 'council_advisor', kind: 'rate_limited', status: 429, device_class: 'ios', in_app: 'none' })
    expect(sanitizeIntakeProps('payment_failed', { plan: 'monthly', surface: 'mirror', reason: 'BAD_REQUEST_ERROR' }))
      .toEqual({ plan: 'monthly', surface: 'mirror', reason: 'BAD_REQUEST_ERROR' })
  })
  it('drops unknown keys and anything that looks like free text', () => {
    const out = sanitizeIntakeProps('client_error', { where: 'chat_turn', message: 'my boss is called Rahul', note: 'x', kind: 'I cannot afford this' })
    expect(out).toEqual({ where: 'chat_turn' })
  })
  it('does not widen the filter for old, non-strict events', () => {
    expect(isIntakeEvent('landing_view')).toBe(false)
    expect(sanitizeIntakeProps('landing_view', { surface: 'natural_intake', anything: 'free text ok here' })).toEqual({ surface: 'natural_intake', anything: 'free text ok here' })
  })
})

describe('visitor token (aggregate-only, day-rotating)', () => {
  const secret = 'a-long-secret-value-0123456789'
  const d1 = new Date('2026-11-03T10:00:00Z'), d1b = new Date('2026-11-03T23:59:00Z'), d2 = new Date('2026-11-04T00:01:00Z')
  it('is off unless a long enough secret is set', () => {
    expect(visitorHashEnabled(undefined)).toBe(false)
    expect(visitorHashEnabled('short')).toBe(false)
    expect(visitorHashEnabled(secret)).toBe(true)
  })
  it('is stable within a UTC day and different the next day', () => {
    expect(visitorToken(secret, '1.2.3.4', 'UA', d1)).toBe(visitorToken(secret, '1.2.3.4', 'UA', d1b))
    expect(visitorToken(secret, '1.2.3.4', 'UA', d1)).not.toBe(visitorToken(secret, '1.2.3.4', 'UA', d2))
  })
  it('differs per visitor and per secret', () => {
    expect(visitorToken(secret, '1.2.3.4', 'UA', d1)).not.toBe(visitorToken(secret, '1.2.3.5', 'UA', d1))
    expect(visitorToken(secret, '1.2.3.4', 'UA', d1)).not.toBe(visitorToken(secret, '1.2.3.4', 'UB', d1))
    expect(visitorToken(secret, '1.2.3.4', 'UA', d1)).not.toBe(visitorToken(secret + 'x', '1.2.3.4', 'UA', d1))
  })
  it('is a short hex token that does not contain the IP or user agent', () => {
    const t = visitorToken(secret, '203.0.113.9', 'Mozilla/5.0 Special', d1)
    expect(t).toMatch(/^[0-9a-f]{16}$/)
    expect(t).not.toContain('203'); expect(utcDay(d1)).toBe('2026-11-03')
  })
})

describe('sign-in-before-Council gate rules', () => {
  const fresh = { councilMessageCount: 0, status: 'active', finalDecisionLockedAt: null, examinerSubmitted: false }
  it('is ON by default, and only the documented off values switch it off', () => {
    expect(isConveneGateEnabled(undefined)).toBe(true)
    expect(isConveneGateEnabled('')).toBe(true)
    expect(isConveneGateEnabled('on')).toBe(true)
    for (const v of ['off', 'OFF', '0', 'false', 'disabled', 'no']) expect(isConveneGateEnabled(v)).toBe(false)
  })
  it('gates a brand-new session whose Council has not run', () => { expect(isGateCandidate(true, fresh)).toBe(true) })
  it('never gates when switched off', () => { expect(isGateCandidate(false, fresh)).toBe(false) })
  it('never gates a session that already ran, was locked, completed, or had its check submitted', () => {
    expect(isCouncilNotYetRun({ ...fresh, councilMessageCount: 1 })).toBe(false)
    expect(isCouncilNotYetRun({ ...fresh, status: 'completed' })).toBe(false)
    expect(isCouncilNotYetRun({ ...fresh, finalDecisionLockedAt: '2026-10-01T00:00:00Z' })).toBe(false)
    expect(isCouncilNotYetRun({ ...fresh, examinerSubmitted: true })).toBe(false)
  })
})

describe('notification sources: every email can be told apart', () => {
  it('accepts the v14 sources', () => {
    for (const s of ['daily_nudge', 'validation_nudge', 'council_nudge', 'mirror_insight', 'reanalyze_7d', 'reanalyze_14d', 'reanalyze_30d'])
      expect(parseNotificationSource(s)).toBe(s)
    expect(NOTIFICATION_SOURCES.length).toBeGreaterThanOrEqual(10)
  })
  it('every cron email link carries its tag', () => {
    const map: Record<string, string[]> = {
      'app/api/cron/daily-nudge/route.ts':        ['n=daily_nudge'],
      'app/api/cron/validation-nudge/route.ts':   ['n=validation_nudge'],
      'app/api/cron/council-nudge/route.ts':      ['n=council_nudge'],
      'app/api/cron/mirror-insight-email/route.ts': ['n=mirror_insight'],
      'app/api/cron/reanalyze-email/route.ts':    ['n=reanalyze_${daysAgo}d', 'n=review_date'],
      'app/api/cron/weekly-brief/route.ts':       ['n=weekly_brief'],
      'app/api/cron/pattern-notice/route.ts':     ['n=pattern_notice'],
    }
    for (const [file, tags] of Object.entries(map)) for (const t of tags) expect(src(file), `${file} should contain ${t}`).toContain(t)
  })
})

describe('wiring guards', () => {
  it('the public events endpoint accepts the new browser events, and NOT the server-only ones', () => {
    const route = src('app/api/events/route.ts')
    for (const e of ['consent_shown', 'consent_accepted', 'consent_rejected', 'client_error', 'convene_gate_shown', 'paywall_viewed',
      'checkout_opened', 'payment_success', 'payment_failed', 'checkout_dismissed', 'record_viewed', 'outcome_recorded'])
      expect(route, e).toContain(`'${e}'`)
    expect(route).not.toContain("'guest_order_created'")   // server-only: the browser must not be able to forge it
    expect(route).not.toContain("'guest_order_paid'")
    expect(route).toContain('sanitizeContextProps')
    expect(route).toContain('visitorHashEnabled')
  })
  it('track.ts knows the new events and injects device/attribution context', () => {
    const t = src('lib/track.ts')
    for (const e of ['consent_shown', 'client_error', 'convene_gate_shown', 'paywall_viewed', 'outcome_recorded']) expect(t).toContain(`'${e}'`)
    expect(t).toContain('getEventContext')
    expect(t).toContain('export function trackError')
  })
  it('the landing page captures first touch BEFORE logging landing_view', () => {
    const f = src('app/NaturalIntakeClient.tsx')
    expect(f).toMatch(/captureFirstTouch\(\);\s*track\('landing_view'/)
  })
  it('the session page wraps SessionView in the gate and decides candidacy on the server', () => {
    const p = src('app/session/[id]/page.tsx')
    expect(p).toContain('<ConveneGate')
    expect(p).toContain('isConveneGateEnabled()')
    expect(p).toMatch(/<ConveneGate[\s\S]*<SessionView[\s\S]*<\/ConveneGate>/)
  })
  it('the gate fails open and never mounts SessionView while checking', () => {
    const g = src('components/ConveneGate.tsx')
    expect(g).toContain('fail open')
    expect(g).toMatch(/state === 'checking'[\s\S]*aria-busy/)
    expect(g).toContain("mode=\"convene_gate\"")
  })
  it('ConnectCard: the gate is not skippable, ignores a stale stored email, links the session, and handles in-app browsers', () => {
    const c = src('components/ConnectCard.tsx')
    expect(c).toContain("mode !== 'd3_gate' && mode !== 'convene_gate'")
    expect(c).toContain("mode !== 'convene_gate' && getStoredUserEmail()")
    expect(c).toContain('pushSessionIdForSignIn')
    expect(c).toContain('detectInApp')
  })
  it('cookie banner reports shown / accepted / rejected', () => {
    const c = src('components/CookieConsent.tsx')
    for (const e of ["track('consent_shown'", "track('consent_accepted'", "track('consent_rejected'"]) expect(c).toContain(e)
  })
  it('payment button reports the whole funnel', () => {
    const p = src('components/PaymentButton.tsx')
    for (const e of ['paywall_viewed', 'checkout_opened', 'payment_success', 'payment_failed', 'checkout_dismissed']) expect(p).toContain(`'${e}'`)
  })
  it('the Council reports advisor failures, the chat reports turn failures', () => {
    expect(src('components/PersonaPanel.tsx')).toContain("trackError('council_advisor'")
    expect(src('components/ChatIntake.tsx')).toContain("trackError('chat_turn'")
  })
  it('guest order routes record trigger and paid, using the server tracker', () => {
    expect(src('app/api/decision-session/create-order/route.ts')).toContain("'guest_order_created'")
    expect(src('app/api/decision-session/verify-order/route.ts')).toContain("'guest_order_paid'")
  })
  it('signup attribution works without cookie consent (memory only) and the gate links its session', () => {
    const s = src('lib/storage.ts')
    expect(s).toContain('rememberUtmInMemory')
    expect(s).toContain('export function pushSessionIdForSignIn')
  })
})

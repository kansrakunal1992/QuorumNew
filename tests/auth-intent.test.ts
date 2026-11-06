import { describe, it, expect } from 'vitest'
import {
  cleanSessionIds, sanitizeIntent, mergeIdentity, parseAuthHash, withQueryFlag,
  AUTH_HASH_RESCUE_SCRIPT, EMPTY_INTENT,
} from '../lib/auth-intent'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const C = '33333333-3333-4333-8333-333333333333'

describe('cleanSessionIds', () => {
  it('keeps real uuids, drops junk and duplicates', () => {
    expect(cleanSessionIds([A, 'dev_abc', A, '', 42, B])).toEqual([A, B])
  })
  it('accepts the comma-separated ?xs= form', () => {
    expect(cleanSessionIds(`${A},${B},not-a-uuid`)).toEqual([A, B])
  })
  it('caps the list', () => {
    const many = Array.from({ length: 80 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`)
    expect(cleanSessionIds(many)).toHaveLength(40)
  })
  it('never throws on garbage', () => {
    expect(cleanSessionIds(null)).toEqual([])
    expect(cleanSessionIds({})).toEqual([])
  })
})

describe('sanitizeIntent', () => {
  it('keeps a valid same-origin return path and drops open-redirect attempts', () => {
    expect(sanitizeIntent({ returnTo: `/session/${A}` }).returnTo).toBe(`/session/${A}`)
    expect(sanitizeIntent({ returnTo: 'https://evil.example/x' }).returnTo).toBeNull()
    expect(sanitizeIntent({ returnTo: '//evil.example' }).returnTo).toBeNull()
    expect(sanitizeIntent({ returnTo: '/auth/callback' }).returnTo).toBeNull()
  })
  it('survives null / non-object input', () => {
    expect(sanitizeIntent(null)).toEqual(EMPTY_INTENT)
    expect(sanitizeIntent('x')).toEqual(EMPTY_INTENT)
  })
  it('drops over-long text fields', () => {
    expect(sanitizeIntent({ utmSource: 'x'.repeat(500) }).utmSource).toBeNull()
  })
})

describe('mergeIdentity — the cross-browser case', () => {
  const emptyLocal = { sessionIds: [], deviceId: null, returnTo: null }
  const emptyUrl = { sessionIds: [], deviceId: null, returnTo: null, utmSource: null, utmCampaign: null, utmContent: null }

  it('REGRESSION: link opened in another browser AND Supabase dropped the query string -> intent still returns them to the Council gate', () => {
    const m = mergeIdentity({
      local: emptyLocal, url: emptyUrl,
      intent: { ...EMPTY_INTENT, returnTo: `/session/${A}`, sessionIds: [A], deviceId: 'dev_x' },
    })
    expect(m.returnTo).toBe(`/session/${A}`)
    expect(m.sessionIds).toEqual([A])
    expect(m.deviceIds).toEqual(['dev_x'])
  })
  it('return path priority: link ?rt= beats intent beats localStorage', () => {
    const base = { ...emptyUrl }
    expect(mergeIdentity({ local: { ...emptyLocal, returnTo: '/record/l' }, url: { ...base, returnTo: '/record/u' }, intent: { ...EMPTY_INTENT, returnTo: '/record/i' } }).returnTo).toBe('/record/u')
    expect(mergeIdentity({ local: { ...emptyLocal, returnTo: '/record/l' }, url: base, intent: { ...EMPTY_INTENT, returnTo: '/record/i' } }).returnTo).toBe('/record/i')
    expect(mergeIdentity({ local: { ...emptyLocal, returnTo: '/record/l' }, url: base, intent: null }).returnTo).toBe('/record/l')
  })
  it('no carrier has a path -> null (home is the default)', () => {
    expect(mergeIdentity({ local: emptyLocal, url: emptyUrl, intent: null }).returnTo).toBeNull()
  })
  it('session and device ids are a de-duplicated union of all three carriers', () => {
    const m = mergeIdentity({
      local:  { sessionIds: [C, A], deviceId: 'dev_l', returnTo: null },
      url:    { ...emptyUrl, sessionIds: [A, B], deviceId: 'dev_u' },
      intent: { ...EMPTY_INTENT, sessionIds: [B], deviceId: 'dev_u' },
    })
    expect(m.sessionIds.sort()).toEqual([A, B, C].sort())
    expect(m.deviceIds.sort()).toEqual(['dev_l', 'dev_u'])
  })
  it('utm: URL wins, intent fills the gaps', () => {
    const m = mergeIdentity({
      local: emptyLocal,
      url: { ...emptyUrl, utmSource: 'url_src' },
      intent: { ...EMPTY_INTENT, utmSource: 'intent_src', utmCampaign: 'intent_camp' },
    })
    expect(m.utm).toEqual({ source: 'url_src', campaign: 'intent_camp', content: null })
  })
  it('a tampered return path in any carrier is ignored, not trusted', () => {
    const m = mergeIdentity({ local: emptyLocal, url: { ...emptyUrl, returnTo: 'https://evil.example' }, intent: { ...EMPTY_INTENT, returnTo: `/session/${A}` } })
    expect(m.returnTo).toBe(`/session/${A}`)
  })
})

describe('parseAuthHash', () => {
  it('REGRESSION: reads an expired / already-used link from the URL HASH', () => {
    const p = parseAuthHash('#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired')
    expect(p.kind).toBe('expired')
    expect(p.errorCode).toBe('otp_expired')
  })
  it('recognises a successful implicit-flow return', () => {
    const p = parseAuthHash('#access_token=abc&refresh_token=def&expires_in=3600&type=magiclink')
    expect(p.hasTokens).toBe(true)
    expect(p.kind).toBe('ok')
  })
  it('other denials are not reported as expiry', () => {
    expect(parseAuthHash('#error=access_denied&error_description=User+denied').kind).toBe('denied')
  })
  it('empty / missing hash', () => {
    expect(parseAuthHash('').kind).toBe('none')
    expect(parseAuthHash(undefined).kind).toBe('none')
    expect(parseAuthHash('#section-2').kind).toBe('none')
  })
})

describe('withQueryFlag', () => {
  it('adds the first and later params correctly', () => {
    expect(withQueryFlag('/session/x', 'auth_error', 'link_expired')).toBe('/session/x?auth_error=link_expired')
    expect(withQueryFlag('/session/x?a=1', 'auth_error', 'link_expired')).toBe('/session/x?a=1&auth_error=link_expired')
  })
})

// The rescue script is inlined into <head> as a string, so it is executed here against fake locations.
describe('AUTH_HASH_RESCUE_SCRIPT (inlined in app/layout.tsx)', () => {
  function run(pathname: string, search: string, hash: string): string | null {
    let target: string | null = null
    const location = { pathname, search, hash, replace: (u: string) => { target = u } }
    new Function('window', AUTH_HASH_RESCUE_SCRIPT)({ location })
    return target
  }
  it('REGRESSION: tokens that land on Home are forwarded to /auth/callback with the hash intact', () => {
    expect(run('/', '', '#access_token=a&refresh_token=b&type=magiclink'))
      .toBe('/auth/callback#access_token=a&refresh_token=b&type=magiclink')
  })
  it('works from any page, preserving its query string', () => {
    expect(run('/record/x', '?linked=1', '#access_token=a&refresh_token=b'))
      .toBe('/auth/callback?linked=1#access_token=a&refresh_token=b')
  })
  it('forwards a failed link too, so the callback can explain it', () => {
    expect(run('/', '', '#error=access_denied&error_code=otp_expired'))
      .toBe('/auth/callback#error=access_denied&error_code=otp_expired')
  })
  it('does nothing on /auth/callback itself (no redirect loop) but stashes the original hash for the callback', () => {
    let target: string | null = null
    const win: Record<string, unknown> = { location: { pathname: '/auth/callback', search: '', hash: '#error=access_denied&error_code=otp_expired', replace: (u: string) => { target = u } } }
    new Function('window', AUTH_HASH_RESCUE_SCRIPT)(win)
    expect(target).toBeNull()
    expect(win.__QUORUM_AUTH_HASH__).toBe('#error=access_denied&error_code=otp_expired')
  })
  it('does nothing on ordinary pages / ordinary hashes', () => {
    expect(run('/', '', '')).toBeNull()
    expect(run('/methodology', '', '#faq')).toBeNull()
    expect(run('/', '', '#access_token=only-half-a-pair')).toBeNull()
  })
})

import { describe, expect, it } from 'vitest'
import {
  buildCtaUrl, cleanText, hashBucket, isHoldout, normalizeVariant, normalizeVariants,
  parseCap, pickVariantIndex, remainingDailyCap, safeCtaPath, safeSlug,
} from '@/lib/gtm-lifecycle'
import { generateUnsubToken, verifyUnsubToken } from '@/lib/nudge-token'

const PROG = '11111111-1111-1111-1111-111111111111'

describe('holdout assignment', () => {
  it('is deterministic for the same user and program', () => {
    expect(isHoldout('user-a', PROG, 20)).toBe(isHoldout('user-a', PROG, 20))
    expect(hashBucket('user-a', PROG, 'arm', 100)).toBe(hashBucket('user-a', PROG, 'arm', 100))
  })
  it('never holds out at 0% and ignores out-of-range values', () => {
    for (let i = 0; i < 200; i++) expect(isHoldout(`u${i}`, PROG, 0)).toBe(false)
    for (let i = 0; i < 200; i++) expect(isHoldout(`u${i}`, PROG, -5)).toBe(false)
  })
  it('caps the holdout share at 50% even if asked for more', () => {
    let held = 0
    for (let i = 0; i < 2000; i++) if (isHoldout(`u${i}`, PROG, 100)) held++
    expect(held / 2000).toBeGreaterThan(0.4)
    expect(held / 2000).toBeLessThan(0.6)
  })
  it('lands close to the requested percentage over many users', () => {
    let held = 0
    for (let i = 0; i < 5000; i++) if (isHoldout(`u${i}`, PROG, 10)) held++
    expect(held / 5000).toBeGreaterThan(0.08)
    expect(held / 5000).toBeLessThan(0.12)
  })
  it('different programs draw independently', () => {
    const other = '22222222-2222-2222-2222-222222222222'
    let same = 0
    for (let i = 0; i < 1000; i++) if (isHoldout(`u${i}`, PROG, 50) === isHoldout(`u${i}`, other, 50)) same++
    expect(same).toBeGreaterThan(400); expect(same).toBeLessThan(600)
  })
  it('variant index stays in range and is stable', () => {
    for (let i = 0; i < 100; i++) {
      const v = pickVariantIndex(`u${i}`, PROG, 3)
      expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(3)
      expect(pickVariantIndex(`u${i}`, PROG, 3)).toBe(v)
    }
    expect(pickVariantIndex('x', PROG, 1)).toBe(0)
    expect(pickVariantIndex('x', PROG, 0)).toBe(0)
  })
})

describe('link safety', () => {
  it('allows same-site paths', () => {
    expect(safeCtaPath('/')).toBe('/')
    expect(safeCtaPath('/start?from=email')).toBe('/start?from=email')
    expect(safeCtaPath(' /dashboard ')).toBe('/dashboard')
  })
  it.each([
    'https://evil.example/x', 'http://evil.example', '//evil.example', 'evil.example/path', 'javascript:alert(1)', '/\\evil.example',
    '/a b', '/a@b.com', '/<script>', '/x"y', "/x'y", '', '   ', 'mailto:a@b.co',
  ])('rejects %j', bad => { expect(safeCtaPath(bad)).toBe('/') })
  it('rejects non-strings and very long paths', () => {
    expect(safeCtaPath(undefined)).toBe('/'); expect(safeCtaPath(42)).toBe('/'); expect(safeCtaPath('/' + 'a'.repeat(300))).toBe('/')
  })
  it('builds a tracked same-site URL', () => {
    const u = buildCtaUrl('https://app.quorumvault.org/', '/start', 'second-decision')
    expect(u).toBe('https://app.quorumvault.org/start?n=gtm_second-decision&utm_source=quorum_lifecycle&utm_medium=email&utm_campaign=second-decision')
    expect(buildCtaUrl('https://a.b', '/x?y=1', 'p')).toContain('/x?y=1&n=gtm_p')
  })
  it('never lets a hostile path or slug change the host', () => {
    const u = buildCtaUrl('https://app.quorumvault.org', '//evil.example', 'bad slug!&x=1')
    expect(u.startsWith('https://app.quorumvault.org/?n=gtm_program')).toBe(true)
    expect(new URL(u).host).toBe('app.quorumvault.org')
  })
  it('safeSlug only accepts lowercase slugs', () => {
    expect(safeSlug('abc-1_x')).toBe('abc-1_x'); expect(safeSlug('Abc')).toBe('program'); expect(safeSlug('')).toBe('program'); expect(safeSlug(5)).toBe('program')
  })
})

describe('copy sanitising', () => {
  it('flattens control characters and caps length', () => {
    expect(cleanText('Hi\r\nBcc: x@y.z\tthere', 100)).toBe('Hi Bcc: x@y.z there')
    expect(cleanText('a'.repeat(50), 10).length).toBeLessThanOrEqual(10)
    expect(cleanText(null, 10)).toBe('')
  })
  it('requires subject, lead and button label', () => {
    expect(normalizeVariant({ subject: 's', lead: 'l' })).toBeNull()
    expect(normalizeVariant({ subject: '', lead: 'l', cta_label: 'c' })).toBeNull()
    expect(normalizeVariant('nope')).toBeNull()
    expect(normalizeVariant(null)).toBeNull()
  })
  it('normalises a good variant and forces a safe link', () => {
    const v = normalizeVariant({ subject: ' Hello\nworld ', lead: 'Lead', cta_label: 'Go', cta_path: 'https://evil.example', list_items: ['a', '', 'b'], list_label: 'L' })!
    expect(v.subject).toBe('Hello world'); expect(v.ctaPath).toBe('/'); expect(v.listItems).toEqual(['a', 'b']); expect(v.listLabel).toBe('L')
  })
  it('drops the list label when there are no items, caps items at 5, keeps at most 6 variants', () => {
    expect(normalizeVariant({ subject: 's', lead: 'l', cta_label: 'c', list_label: 'L' })!.listLabel).toBeNull()
    expect(normalizeVariant({ subject: 's', lead: 'l', cta_label: 'c', list_items: Array(9).fill('x') })!.listItems.length).toBe(5)
    const many = Array(9).fill({ subject: 's', lead: 'l', cta_label: 'c' })
    expect(normalizeVariants(many).length).toBe(6)
    expect(normalizeVariants('x')).toEqual([])
    expect(normalizeVariants([{ subject: 's' }, { subject: 's', lead: 'l', cta_label: 'c' }]).length).toBe(1)
  })
})

describe('daily cap', () => {
  it('computes the remaining allowance', () => {
    expect(remainingDailyCap(0, 100)).toBe(100); expect(remainingDailyCap(40, 100)).toBe(60); expect(remainingDailyCap(150, 100)).toBe(0); expect(remainingDailyCap(-5, 10)).toBe(10)
  })
  it('parses the env value safely', () => {
    expect(parseCap('50', 100)).toBe(50); expect(parseCap(undefined, 100)).toBe(100); expect(parseCap('abc', 100)).toBe(100); expect(parseCap('-3', 100)).toBe(100); expect(parseCap('0', 100)).toBe(0)
  })
})

describe('lifecycle unsubscribe token', () => {
  it('round-trips and is not valid for other types', () => {
    process.env.CRON_SECRET = process.env.CRON_SECRET ?? 'test-secret-for-vitest-only-0123456789'
    const t = generateUnsubToken('user-1', 'lifecycle')
    expect(verifyUnsubToken(t)).toMatchObject({ userId: 'user-1', type: 'lifecycle' })
    expect(verifyUnsubToken(t.replace('user-1', 'user-2'))).toBeNull()          // different user, same signature
    expect(verifyUnsubToken(t.replace('.lifecycle.', '.daily.'))).toBeNull()    // type swapped
    expect(verifyUnsubToken(t.slice(0, -4) + (t.endsWith('0000') ? '1111' : '0000'))).toBeNull()  // signature altered
  })
})

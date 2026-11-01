// lib/event-context.ts
// -- v14: where visitors come from, and on what -------------------------------
// Pure helpers (no storage, no network) that turn a user-agent string, a query string and a referrer into SMALL,
// SAFE tokens an analytics event may carry: a device class, an in-app-browser name, UTM tags, a referrer HOST.
//
// Privacy: only coarse categories and campaign tags the marketer chose. Never the raw user agent, never a full
// referrer URL (paths and queries can hold names or tokens), never an IP. Every output is a lowercase token of
// [a-z0-9._-] up to 40 characters, which is also what lib/event-props.ts accepts.

export type DeviceClass = 'ios' | 'android' | 'desktop' | 'other'
export type InAppBrowser =
  | 'instagram' | 'facebook' | 'whatsapp' | 'linkedin' | 'twitter' | 'other_webview' | 'none'

/** Lowercase, spaces to underscores, drop anything outside [a-z0-9._-], cap the length. Empty -> null. */
export function safeToken(raw: unknown, max = 40): string | null {
  if (typeof raw !== 'string') return null
  const t = raw.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9._-]/g, '').slice(0, max)
  return t.length > 0 ? t : null
}

export function detectDeviceClass(ua: unknown): DeviceClass {
  const s = typeof ua === 'string' ? ua : ''
  if (/iPhone|iPad|iPod/i.test(s)) return 'ios'
  if (/Android/i.test(s)) return 'android'
  if (/Windows NT|Macintosh|X11|CrOS|Linux x86_64/i.test(s)) return 'desktop'
  return 'other'
}

/**
 * Apps that open links in their own embedded browser. Google refuses OAuth sign-in inside embedded web views,
 * so knowing this tells us whether "Continue with Google" can work for a visitor.
 */
export function detectInApp(ua: unknown): InAppBrowser {
  const s = typeof ua === 'string' ? ua : ''
  if (/Instagram/i.test(s)) return 'instagram'
  if (/FBAN|FBAV|FB_IAB|FBIOS|FB4A/i.test(s)) return 'facebook'
  if (/WhatsApp/i.test(s)) return 'whatsapp'
  if (/LinkedInApp/i.test(s)) return 'linkedin'
  if (/Twitter|TwitterAndroid/i.test(s)) return 'twitter'
  if (/Android/i.test(s) && /;\s*wv\)/i.test(s)) return 'other_webview'                         // Android WebView
  if (/(iPhone|iPad|iPod)/i.test(s) && /AppleWebKit/i.test(s) && !/Safari\//i.test(s)) return 'other_webview'  // iOS WKWebView
  return 'none'
}

export interface UtmTags {
  utm_source:   string | null
  utm_medium:   string | null
  utm_campaign: string | null
  utm_content:  string | null
}

export const EMPTY_UTM_TAGS: UtmTags = { utm_source: null, utm_medium: null, utm_campaign: null, utm_content: null }

export function parseUtmTags(search: unknown): UtmTags {
  if (typeof search !== 'string' || !search) return EMPTY_UTM_TAGS
  let p: URLSearchParams
  try { p = new URLSearchParams(search) } catch { return EMPTY_UTM_TAGS }
  return {
    utm_source:   safeToken(p.get('utm_source')),
    utm_medium:   safeToken(p.get('utm_medium')),
    utm_campaign: safeToken(p.get('utm_campaign')),
    utm_content:  safeToken(p.get('utm_content')),
  }
}

export const hasAnyUtm = (u: UtmTags): boolean => !!(u.utm_source || u.utm_medium || u.utm_campaign || u.utm_content)

/** Referrer HOST only (no path, no query). Null for our own site, for nothing, and for anything unparseable. */
export function referrerHost(referrer: unknown, ownHost?: string | null): string | null {
  if (typeof referrer !== 'string' || !referrer) return null
  let host: string
  try { host = new URL(referrer).hostname.toLowerCase() } catch { return null }
  host = host.replace(/^www\./, '')
  const own = (ownHost ?? '').toLowerCase().replace(/^www\./, '')
  if (!host || (own && host === own)) return null
  return safeToken(host, 60)
}

/** Which kind of page a visit landed on: 'home' or the first path segment (record, session, mirror, ...). */
export function landingBucket(pathname: unknown): string {
  if (typeof pathname !== 'string' || pathname === '/' || pathname === '') return 'home'
  const first = pathname.split('/').filter(Boolean)[0]
  return safeToken(first, 24) ?? 'other'
}

/** Keys this module may add to an event. lib/event-props.ts uses the same list to validate them server-side. */
export const CONTEXT_KEYS = [
  'device_class', 'in_app', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'ref', 'landing',
] as const

const SAFE_CONTEXT_VALUE = /^[a-z0-9._-]{1,60}$/

/** Server-side: keep only the context keys whose value is a safe token. Everything else passes through untouched. */
export function sanitizeContextProps<T extends Record<string, string | number | boolean | null>>(props: T): T {
  const out: Record<string, string | number | boolean | null> = { ...props }
  for (const k of CONTEXT_KEYS) {
    if (!(k in out)) continue
    const v = out[k]
    if (v === null) continue
    if (typeof v !== 'string' || !SAFE_CONTEXT_VALUE.test(v)) delete out[k]
  }
  return out as T
}

/** How a guest order came to exist: the person pressed the pay button, or the page created it on load. Anything else is unknown. */
export type OrderTrigger = 'click' | 'load' | 'unknown'
export function normalizeOrderTrigger(raw: unknown): OrderTrigger {
  const t = safeToken(raw, 12)
  return t === 'click' || t === 'load' ? t : 'unknown'
}

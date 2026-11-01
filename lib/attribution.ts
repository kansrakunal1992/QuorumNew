'use client'
// lib/attribution.ts
// -- v14: first-touch attribution + device context for analytics events ---------------------------------------
// Fixes "every signup is (direct / none)": UTM tags were only read when the sign-in panel mounted, only with cookie
// consent, and by then the URL no longer had them. Now the landing page calls captureFirstTouch() on arrival.
//
//  - The first touch is held IN MEMORY for the life of the page (and in sessionStorage when cookie consent exists,
//    through the existing captureUtm). Visitors without consent get nothing written to their device.
//  - Events carry coarse tags only: device class, in-app browser name, utm_*, the referrer HOST, the landing bucket.

import { captureUtm, rememberUtmInMemory, getStoredUtm } from '@/lib/storage'
import {
  detectDeviceClass, detectInApp, parseUtmTags, referrerHost, landingBucket, hasAnyUtm,
  type DeviceClass, type InAppBrowser, type UtmTags,
} from '@/lib/event-context'

let firstTouchUtm: UtmTags | null = null
let firstTouchRef: string | null = null
let firstTouchLanding: string | null = null
let captured = false
let cachedUa: { device_class: DeviceClass; in_app: InAppBrowser } | null = null

/** Call once on arrival (the landing page). Safe to call repeatedly. Reads the URL and referrer; stores nothing by itself. */
export function captureFirstTouch(): void {
  if (typeof window === 'undefined' || captured) return
  captured = true
  try {
    const utm = parseUtmTags(window.location.search)
    if (hasAnyUtm(utm)) firstTouchUtm = utm
    firstTouchRef = referrerHost(document.referrer, window.location.hostname)
    firstTouchLanding = landingBucket(window.location.pathname)
  } catch { /* ignore */ }
  captureUtm()   // existing: persists to sessionStorage only when functional consent exists; also fills the in-memory copy
}

export function getDeviceContext(): { device_class: DeviceClass; in_app: InAppBrowser } {
  if (cachedUa) return cachedUa
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
  cachedUa = { device_class: detectDeviceClass(ua), in_app: detectInApp(ua) }
  return cachedUa
}

export function getFirstTouch(): UtmTags & { ref: string | null; landing: string | null } {
  if (firstTouchUtm) return { ...firstTouchUtm, ref: firstTouchRef, landing: firstTouchLanding }
  // fall back to whatever the existing storage helper knows (live URL, then this visit's sessionStorage snapshot)
  const s = getStoredUtm()
  return {
    utm_source: s.utm_source ? s.utm_source.toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 40) || null : null,
    utm_medium: null,
    utm_campaign: s.utm_campaign ? s.utm_campaign.toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 40) || null : null,
    utm_content: s.utm_content ? s.utm_content.toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 40) || null : null,
    ref: firstTouchRef, landing: firstTouchLanding,
  }
}

/** Events that should say which channel brought the person: the steps where "which source converts" matters. */
const ATTRIBUTED_EVENTS = new Set([
  'landing_view', 'decision_started', 'auth_prompt_seen', 'auth_started', 'magic_link_requested',
  'consent_shown', 'consent_accepted', 'consent_rejected', 'convene_gate_shown',
  'paywall_viewed', 'checkout_opened', 'payment_success',
])

export function getEventContext(event: string): Record<string, string> {
  const out: Record<string, string> = { ...getDeviceContext() }
  if (!ATTRIBUTED_EVENTS.has(event)) return out
  const t = getFirstTouch()
  for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'ref'] as const) {
    const v = t[k]
    if (v) out[k] = v
  }
  if (event === 'landing_view' && t.landing) out.landing = t.landing
  return out
}

/** Test hook: forget everything (module state is per page load in the browser). */
export function __resetAttributionForTests(): void {
  firstTouchUtm = null; firstTouchRef = null; firstTouchLanding = null; captured = false; cachedUa = null
}

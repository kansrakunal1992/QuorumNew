// lib/meta-pixel.ts
// ── Meta Pixel helper — FREE-TIER acquisition funnel only ────────────────────
//
// This pixel belongs to the free-tier signup funnel running in this Railway
// project. It is intentionally separate from the pixel used on the paid
// ₹299 founder-led session funnel (different Railway project/codebase) —
// do not merge the two.
//
// Pixel ID comes from NEXT_PUBLIC_META_PIXEL_ID (public by design — Meta
// Pixel IDs are not secrets, same reasoning as NEXT_PUBLIC_RAZORPAY_KEY_ID
// elsewhere in this codebase). Never hardcode an ID here.
//
// Every helper below is a defensive no-op when the env var is unset (e.g.
// local dev) or when window.fbq hasn't loaded yet (ad blockers, slow script
// load) — callers never need to guard calls themselves.
// ─────────────────────────────────────────────────────────────────────────────

declare global {
  interface Window {
    fbq?: ((...args: unknown[]) => void) & { queue?: unknown[] }
  }
}

export const META_PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID

export function isMetaPixelConfigured(): boolean {
  return typeof META_PIXEL_ID === 'string' && META_PIXEL_ID.length > 0
}

// Fires a Meta Pixel standard event (e.g. 'PageView', 'ViewContent',
// 'CompleteRegistration'). Only ever sends non-sensitive, non-PII params —
// callers must not pass emails, names, or free-text user content.
export function trackMetaEvent(
  eventName: string,
  params?: Record<string, string | number | boolean>
): void {
  if (typeof window === 'undefined') return
  if (!isMetaPixelConfigured()) return
  if (typeof window.fbq !== 'function') return

  try {
    if (params) {
      window.fbq('track', eventName, params)
    } else {
      window.fbq('track', eventName)
    }
  } catch (err) {
    console.warn('[MetaPixel] trackMetaEvent failed:', err)
  }
}

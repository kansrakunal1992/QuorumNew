// Client-side session ID persistence
// Stores up to 100 most recent session IDs in localStorage
// Used to show decision history on the home page without requiring auth
//
// Sprint 2 (S2-01): functional localStorage writes are gated behind cookie consent.
//   - getOrCreateDeviceId() and pushSessionId() check hasFunctionalConsent() first.
//   - Reads (getStoredSessionIds, getStoredDeviceId) are always permitted —
//     they return what's already stored, no new data is written.
//   - quorum_user_email is treated as strictly necessary (authentication flow).

const STORAGE_KEY  = 'quorum_session_ids'
const EMAIL_KEY    = 'quorum_user_email'   // Sprint 6: persisted user email post-auth
const DEVICE_KEY   = 'quorum_device_id'   // Sprint 4b: anonymous device identity
const CONSENT_KEY  = 'quorum_cookie_consent'

// ── S2-01: Consent gate ──────────────────────────────────────────────────────
// Returns true only when the user has explicitly accepted functional cookies.
// If quorum_cookie_consent doesn't exist yet, consent has not been given —
// return false so device ID and session history writes are deferred.
export function hasFunctionalConsent(): boolean {
  if (typeof window === 'undefined') return false
  try {
    const raw = localStorage.getItem(CONSENT_KEY)
    if (!raw) return false
    const consent = JSON.parse(raw) as { functional?: boolean }
    return consent?.functional === true
  } catch { return false }
}

export function getStoredSessionIds(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

// Sprint 2: only write if functional consent is given.
// If not, the session is still accessible by URL — it just won't appear in
// the local history list until the user grants consent.
export function pushSessionId(id: string): void {
  if (typeof window === 'undefined') return
  if (!hasFunctionalConsent()) return
  try {
    const ids = getStoredSessionIds()
    if (!ids.includes(id)) {
      const updated = [id, ...ids].slice(0, 100)
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
    }
  } catch {}
}

export function removeSessionId(id: string): void {
  if (typeof window === 'undefined') return
  try {
    const ids = getStoredSessionIds()
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids.filter(i => i !== id)))
  } catch {}
}

// Sprint 6: user email stored after magic link auth
export function getStoredUserEmail(): string | null {
  if (typeof window === 'undefined') return null
  try { return localStorage.getItem(EMAIL_KEY) } catch { return null }
}

// quorum_user_email is strictly necessary (authentication) — no consent gate.
export function storeUserEmail(email: string): void {
  if (typeof window === 'undefined') return
  try { localStorage.setItem(EMAIL_KEY, email) } catch {}
}

export function clearUserEmail(): void {
  if (typeof window === 'undefined') return
  try { localStorage.removeItem(EMAIL_KEY) } catch {}
}

// Item 6 plan, Phase 2 — Natural Intake hero card rotation. Returns the
// current index (starting at 0 for a brand-new device) and advances it for
// next time, so lib/hero-cards.ts's pickTopHeroCards shows a different pair
// of Mirror/status cards on each fresh visit instead of the same two every
// time. Deliberately a plain incrementing counter rather than a date-based
// seed — advances once per actual visit (this is called once on mount, not
// per render), which is what "each time they log back in" means, and
// doesn't skip a beat if someone visits twice in one day or not at all for
// a week.
const HERO_ROTATION_KEY = 'quorum_hero_rotation_index'

export function getAndAdvanceHeroRotationIndex(): number {
  if (typeof window === 'undefined') return 0
  try {
    const current = parseInt(localStorage.getItem(HERO_ROTATION_KEY) ?? '0', 10) || 0
    localStorage.setItem(HERO_ROTATION_KEY, String(current + 1))
    return current
  } catch {
    return 0
  }
}

// ── Sprint 4b: Anonymous device identity ────────────────────────────────────
// Generated on first visit. Persists until localStorage is cleared.
// Used as a third-tier accumulation key in bias_library:
//   user_id (post-auth) > user_email (pre-auth) > device_id (anonymous).
//
// Sprint 2: gated behind functional consent — if the user has not yet
// consented (or has rejected functional cookies), returns '' without writing
// to localStorage. Sessions are still created; they just have no device_id.
// Bias accumulation will resume once the user grants functional consent.

export function getOrCreateDeviceId(): string {
  if (typeof window === 'undefined') return ''
  // S2-01 gate: do not write a new device ID without functional consent
  if (!hasFunctionalConsent()) return ''
  try {
    const existing = localStorage.getItem(DEVICE_KEY)
    if (existing) return existing
    // crypto.randomUUID() is available in all modern browsers and Next.js edge/node
    const newId = 'dev_' + (typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36))
    localStorage.setItem(DEVICE_KEY, newId)
    return newId
  } catch { return '' }
}

export function getStoredDeviceId(): string | null {
  if (typeof window === 'undefined') return null
  try { return localStorage.getItem(DEVICE_KEY) } catch { return null }
}

// ── GTM attribution: first-touch UTM capture ────────────────────────────────
// Added to answer "what actually drove this signup?" — captured once per
// browser session (sessionStorage, not localStorage — deliberately doesn't
// outlive the tab/session, this is first-touch-this-visit, not permanent
// tracking) and sent to /api/auth at signup time, which embeds it in the
// magic link's emailRedirectTo the same way xd/xs already are. Persisted
// write is gated behind functional consent like the rest of this file;
// reading the CURRENT url's params is not a write and is always permitted
// (same visit, same page — nothing new is stored).
const UTM_KEY = 'quorum_utm_first_touch'

export interface StoredUtm {
  utm_source:   string | null
  utm_campaign: string | null
  utm_content:  string | null
}

const EMPTY_UTM: StoredUtm = { utm_source: null, utm_campaign: null, utm_content: null }

// v14: in-memory copy of this page-load's first-touch UTM. Memory only, nothing is written to the device, so it
// needs no consent; it is lost on a full page reload. It lets signup attribution work for visitors who have not
// accepted cookies (and after in-app navigation, where the URL no longer carries the tags).
let memoryUtm: StoredUtm | null = null
export function rememberUtmInMemory(u: StoredUtm): void {
  if (!memoryUtm && (u.utm_source || u.utm_campaign || u.utm_content)) memoryUtm = u
}

/** Call once on a page that might be a first landing (e.g. AuthPanel mount). */
export function captureUtm(): void {
  if (typeof window === 'undefined') return
  try {
    const q = new URLSearchParams(window.location.search)
    rememberUtmInMemory({ utm_source: q.get('utm_source'), utm_campaign: q.get('utm_campaign'), utm_content: q.get('utm_content') })   // v14
  } catch { /* ignore */ }
  if (!hasFunctionalConsent()) return // S2-01 gate — same rule as device ID
  try {
    if (sessionStorage.getItem(UTM_KEY)) return // first touch already captured this session
    const params = new URLSearchParams(window.location.search)
    const utm: StoredUtm = {
      utm_source:   params.get('utm_source'),
      utm_campaign: params.get('utm_campaign'),
      utm_content:  params.get('utm_content'),
    }
    if (utm.utm_source || utm.utm_campaign || utm.utm_content) {
      sessionStorage.setItem(UTM_KEY, JSON.stringify(utm))
    }
  } catch { /* ignore */ }
}

/**
 * Prefers whatever's live in the CURRENT url right now (covers the
 * no-consent case, and a same-visit click straight through to signup),
 * falling back to the first-touch snapshot captured earlier this session.
 */
export function getStoredUtm(): StoredUtm {
  if (typeof window === 'undefined') return EMPTY_UTM
  try {
    const params = new URLSearchParams(window.location.search)
    const liveSource = params.get('utm_source')
    if (liveSource) {
      return {
        utm_source:   liveSource,
        utm_campaign: params.get('utm_campaign'),
        utm_content:  params.get('utm_content'),
      }
    }
    if (memoryUtm) return memoryUtm   // v14: this page-load's first touch (works without consent)
    const raw = sessionStorage.getItem(UTM_KEY)
    if (raw) return JSON.parse(raw) as StoredUtm
  } catch { /* ignore */ }
  return memoryUtm ?? EMPTY_UTM
}


// v14: the sign-in-before-Council gate. When the person taps "Continue with Google", the Google round trip leaves the
// page, and /auth/callback links their anonymous sessions from this list. Without functional consent pushSessionId()
// (correctly) writes nothing, so the session they are about to be signed in for would not be linked to their account.
// This writes that ONE id, only at the moment the person starts signing in. It is part of the sign-in they asked for,
// the same reasoning that makes quorum_user_email and quorum_return_to strictly necessary.
export function pushSessionIdForSignIn(id: string): void {
  if (typeof window === 'undefined') return
  try {
    const ids = getStoredSessionIds()
    if (!ids.includes(id)) localStorage.setItem(STORAGE_KEY, JSON.stringify([id, ...ids].slice(0, 100)))
  } catch { /* storage unavailable: magic link still carries the id via ?xs= */ }
}

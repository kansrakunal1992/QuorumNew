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

// Client-side session ID persistence
// Stores up to 100 most recent session IDs in localStorage
// Used to show decision history on the home page without requiring auth

const STORAGE_KEY = 'quorum_session_ids'
const EMAIL_KEY   = 'quorum_user_email'   // Sprint 6: persisted user email post-auth
const DEVICE_KEY  = 'quorum_device_id'   // Sprint 4b: anonymous device identity

export function getStoredSessionIds(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

export function pushSessionId(id: string): void {
  if (typeof window === 'undefined') return
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
// Important: device_id is device-local and ephemeral — intentionally not
// surfaced to users as "memory" until they add an email (see MemoryEngineStatus).

export function getOrCreateDeviceId(): string {
  if (typeof window === 'undefined') return ''
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

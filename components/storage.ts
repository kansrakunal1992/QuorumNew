// Client-side session ID persistence
// Stores up to 20 most recent session IDs in localStorage
// Used to show decision history on the home page without requiring auth

const STORAGE_KEY = 'quorum_session_ids'
const EMAIL_KEY   = 'quorum_user_email'   // Sprint 6: persisted user email post-auth

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
      const updated = [id, ...ids].slice(0, 20)
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
    }
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

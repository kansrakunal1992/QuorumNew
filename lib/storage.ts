// Client-side session ID persistence
// Stores up to 20 most recent session IDs in localStorage
// Used to show decision history on the home page without requiring auth

const STORAGE_KEY = 'quorum_session_ids'

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

// lib/return-to.ts
// -- Phase 0 (retention work) -------------------------------------------------
// "Send me back to where I was" after sign-in. /auth/callback used to always
// redirect to '/', which dropped people who signed in from a record page or a
// session page onto the home screen.
//
// Two carriers, same value:
//   - localStorage ('quorum_return_to'): same-browser flows (Google OAuth, and
//     a magic link opened in the browser that requested it).
//   - ?rt= on the magic link's emailRedirectTo (set by /api/auth): survives a
//     link opened in a different browser, like xd/xs already do.
//
// Only same-origin paths are accepted -- never a full URL -- so this cannot be
// used as an open redirect.

const KEY = 'quorum_return_to'

export function sanitizeReturnTo(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const p = raw.trim()
  if (!p || p.length > 200) return null
  if (!p.startsWith('/') || p.startsWith('//')) return null
  if (p.includes('\\') || p.includes('\n') || p.includes('\r')) return null
  if (p.startsWith('/auth/') || p.startsWith('/api/')) return null
  if (p === '/') return null // home is already the default
  return p
}

export function setReturnTo(path: string): void {
  if (typeof window === 'undefined') return
  const safe = sanitizeReturnTo(path)
  try {
    if (safe) localStorage.setItem(KEY, safe)
    else localStorage.removeItem(KEY)
  } catch { /* storage unavailable -- fall back to home */ }
}

/** Current page as a return path, or null when on home. */
export function currentPathAsReturnTo(): string | null {
  if (typeof window === 'undefined') return null
  return sanitizeReturnTo(window.location.pathname + window.location.search)
}

export function readReturnTo(): string | null {
  if (typeof window === 'undefined') return null
  try { return sanitizeReturnTo(localStorage.getItem(KEY)) } catch { return null }
}

export function clearReturnTo(): void {
  if (typeof window === 'undefined') return
  try { localStorage.removeItem(KEY) } catch {}
}

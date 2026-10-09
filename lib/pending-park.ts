// lib/pending-park.ts
// -- Phase 1 (retention work) -------------------------------------------------
// "Park it for later" needs an account (the Watchlist API is bearer-only, see
// app/api/watchlist/route.ts). When an anonymous visitor parks something, we
// hold the text here and /auth/callback flushes it to /api/watchlist as soon as
// they link an email. localStorage on purpose: it must survive the magic-link
// round trip in the same browser. Capped small -- this is a parking lot, not a
// draft store.

const KEY = 'quorum_pending_park'
const MAX = 5

export function readPendingParks(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(KEY)
    const arr = raw ? JSON.parse(raw) : []
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string' && !!x.trim()).slice(0, MAX) : []
  } catch { return [] }
}

export function setPendingParks(list: string[]): void {
  if (typeof window === 'undefined') return
  try {
    if (list.length) localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)))
    else localStorage.removeItem(KEY)
  } catch {}
}

export function addPendingPark(text: string): void {
  const t = text.trim().slice(0, 500)
  if (!t) return
  const current = readPendingParks()
  if (current.includes(t)) return
  setPendingParks([...current, t].slice(-MAX))
}

export function clearPendingParks(): void {
  setPendingParks([])
}

// lib/dates.ts
// All user-facing dates in Quorum display in IST (Asia/Kolkata, UTC+5:30).
// Import these helpers instead of calling toLocaleDateString() directly.

const IST = 'Asia/Kolkata'

/** "28 May 2026" */
export function formatDate(iso: string | Date): string {
  return new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: IST,
  })
}

/** "28 May 2026, 11:14 AM" */
export function formatDateTime(iso: string | Date): string {
  return new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: IST,
  })
}

/** "28 May" */
export function formatShortDate(iso: string | Date): string {
  return new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', timeZone: IST,
  })
}

/** "28 May 2026" (long month) — for PDFs/exports */
export function formatLongDate(iso: string | Date): string {
  return new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: IST,
  })
}

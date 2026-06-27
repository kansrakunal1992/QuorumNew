// lib/nudge-token.ts
// ─────────────────────────────────────────────────────────────────────────────
// Signed unsubscribe tokens, type-aware.
//
// 'daily' keeps the legacy 2-segment format (`{userId}.{hmac}`, hmac over
// userId alone) so unsubscribe links already sent in daily-nudge emails
// keep working after this change — no migration, no broken links.
//
// 'validation' (and any future type) uses a 3-segment format
// (`{userId}.{type}.{hmac}`, hmac over `{userId}.{type}`) — the type is
// bound into the signature so a leaked link can't be replayed against a
// different preference column than the one it was issued for.
//
// The real serving path for the unsubscribe link is /api/cron/unsubscribe
// (see that route) — NOT /api/nudge/unsubscribe, which never existed.
//
// Reuses CRON_SECRET — no new env var required.
// Note: if CRON_SECRET rotates, any unsubscribe links in already-sent emails
// will become invalid. Acceptable for this scale; revisit if CRON_SECRET rotates.
// ─────────────────────────────────────────────────────────────────────────────

import { createHmac, timingSafeEqual } from 'crypto'

export type NudgeUnsubType = 'daily' | 'validation'

function getSecret(): string {
  const s = process.env.CRON_SECRET ?? ''
  if (!s) throw new Error('[NudgeToken] CRON_SECRET not set — cannot sign unsub tokens')
  return s
}

function safeCompare(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, 'hex')
  const b = Buffer.from(expected, 'hex')
  // Length mismatch or zero-length = invalid (also prevents timingSafeEqual crash)
  if (a.length === 0 || a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/**
 * Generate a signed unsubscribe token for a user.
 * Embed in email as: `${appUrl}/api/cron/unsubscribe?token=${generateUnsubToken(userId, type)}`
 */
export function generateUnsubToken(userId: string, type: NudgeUnsubType = 'daily'): string {
  if (type === 'daily') {
    // Legacy format — unchanged, so old links keep verifying.
    const hmac = createHmac('sha256', getSecret()).update(userId).digest('hex')
    return `${userId}.${hmac}`
  }
  const hmac = createHmac('sha256', getSecret()).update(`${userId}.${type}`).digest('hex')
  return `${userId}.${type}.${hmac}`
}

/**
 * Verify a token from an unsubscribe request.
 * Returns { userId, type } if the signature is valid; null if tampered,
 * malformed, or missing. Uses timing-safe comparison throughout.
 *
 * 2-segment tokens (`userId.hmac`) are always treated as the legacy 'daily'
 * type. 3-segment tokens (`userId.type.hmac`) carry an explicit type that
 * was bound into the signature at generation time.
 */
export function verifyUnsubToken(token: string): { userId: string; type: NudgeUnsubType } | null {
  try {
    const parts = token.split('.')

    if (parts.length === 2) {
      const [userId, provided] = parts
      if (!userId || !provided) return null
      const expected = createHmac('sha256', getSecret()).update(userId).digest('hex')
      return safeCompare(provided, expected) ? { userId, type: 'daily' } : null
    }

    if (parts.length === 3) {
      const [userId, type, provided] = parts
      if (!userId || !provided) return null
      if (type !== 'daily' && type !== 'validation') return null
      const expected = createHmac('sha256', getSecret()).update(`${userId}.${type}`).digest('hex')
      return safeCompare(provided, expected) ? { userId, type } : null
    }

    return null
  } catch {
    return null
  }
}

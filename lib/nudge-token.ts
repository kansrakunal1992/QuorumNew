// lib/nudge-token.ts
// ─────────────────────────────────────────────────────────────────────────────
// Signed unsubscribe tokens for daily nudge emails.
//
// Token format: `{userId}.{hmac}`
//   hmac = HMAC-SHA256(userId, CRON_SECRET) as hex
//
// Reuses CRON_SECRET — no new env var required.
// Note: if CRON_SECRET rotates, any unsubscribe links in already-sent emails
// will become invalid. Acceptable for this scale; revisit if CRON_SECRET rotates.
// ─────────────────────────────────────────────────────────────────────────────

import { createHmac, timingSafeEqual } from 'crypto'

function getSecret(): string {
  const s = process.env.CRON_SECRET ?? ''
  if (!s) throw new Error('[NudgeToken] CRON_SECRET not set — cannot sign unsub tokens')
  return s
}

/**
 * Generate a signed unsubscribe token for a user.
 * Embed in email as: `${appUrl}/api/nudge/unsubscribe?token=${generateUnsubToken(userId)}`
 */
export function generateUnsubToken(userId: string): string {
  const hmac = createHmac('sha256', getSecret()).update(userId).digest('hex')
  return `${userId}.${hmac}`
}

/**
 * Verify a token from an unsubscribe request.
 * Returns the userId if the signature is valid; null if tampered, malformed, or missing.
 * Uses timing-safe comparison to prevent timing oracle attacks.
 */
export function verifyUnsubToken(token: string): string | null {
  try {
    const dot      = token.lastIndexOf('.')
    if (dot < 0)   return null

    const userId   = token.slice(0, dot)
    const provided = token.slice(dot + 1)
    if (!userId || !provided) return null

    const expected = createHmac('sha256', getSecret()).update(userId).digest('hex')

    const a = Buffer.from(provided, 'hex')
    const b = Buffer.from(expected, 'hex')

    // Length mismatch or zero-length = invalid (also prevents timingSafeEqual crash)
    if (a.length === 0 || a.length !== b.length) return null
    if (!timingSafeEqual(a, b)) return null

    return userId
  } catch {
    return null
  }
}

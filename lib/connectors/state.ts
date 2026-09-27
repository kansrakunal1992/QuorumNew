import 'server-only'

// lib/connectors/state.ts
// ── Signed OAuth state (Phase 3, v2) ──────────────────────────────────────────
//
// The /connect routes are called by fetch() with the user's normal Bearer
// token, like every other route in this app — but the /callback routes are
// hit by a plain browser GET redirect from Slack/Microsoft, with no
// Authorization header at all. The OAuth `state` parameter is the one piece
// of data that survives that round trip untouched, so it carries a signed,
// short-lived token identifying which Quorum user is connecting — signed so
// a forged state can't make Slack/Teams data land in the wrong account.
//
// Node's built-in crypto — no new dependency.

import { createHmac, timingSafeEqual } from 'crypto'

const SECRET   = process.env.CONNECTOR_OAUTH_STATE_SECRET ?? ''
const TTL_MS   = 10 * 60_000   // 10 minutes — plenty for an OAuth consent screen, short enough that a leaked/logged state token isn't a standing risk

function sign(payload: string): string {
  return createHmac('sha256', SECRET).update(payload).digest('base64url')
}

export interface OAuthStatePayload {
  userId:     string
  returnPath: string   // where to send the browser back to after the callback — e.g. "/session/{id}"
}

export function createOAuthState(userId: string, returnPath: string): string {
  const returnPathB64 = Buffer.from(returnPath).toString('base64url')
  const payload = `${userId}.${Date.now() + TTL_MS}.${returnPathB64}`
  const sig     = sign(payload)
  return Buffer.from(`${payload}.${sig}`).toString('base64url')
}

/** Returns the decoded payload if the state is validly signed and not expired, else null. */
export function verifyOAuthState(state: string): OAuthStatePayload | null {
  try {
    const decoded = Buffer.from(state, 'base64url').toString('utf8')
    const [userId, expiresAtStr, returnPathB64, sig] = decoded.split('.')
    if (!userId || !expiresAtStr || !returnPathB64 || !sig) return null

    const expected = sign(`${userId}.${expiresAtStr}.${returnPathB64}`)
    const sigBuf      = Buffer.from(sig)
    const expectedBuf = Buffer.from(expected)
    if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) return null

    if (Date.now() > Number(expiresAtStr)) return null
    return { userId, returnPath: Buffer.from(returnPathB64, 'base64url').toString('utf8') }
  } catch {
    return null
  }
}

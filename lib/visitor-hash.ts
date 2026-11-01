// lib/visitor-hash.ts
// -- v14: counting visitors who have no device id, without identifying them -----------------------------------
// A first-time visitor has no device id until they accept functional cookies, so ~94% of landing views carried no
// identifier at all. This produces an AGGREGATE-ONLY visitor token for those events:
//
//   token = first 16 hex chars of HMAC-SHA256( HMAC(secret, UTC-date), ip + "|" + user-agent )
//
//  - The key changes every UTC day, so the same person produces a different token tomorrow. Tokens cannot be
//    linked across days, and cannot be reversed to an IP or a user agent.
//  - Nothing is stored on the visitor's device. The IP and user agent are used in memory and never saved.
//  - Off unless VISITOR_HASH_SECRET is set (>= 16 chars). Only added to events that have no device id.
//
// Used for one thing: "roughly how many distinct people visited today", which landing_view counts alone cannot say.

import { createHmac } from 'node:crypto'

export function visitorHashEnabled(secret: string | undefined | null): secret is string {
  return typeof secret === 'string' && secret.trim().length >= 16
}

export function utcDay(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10)
}

export function visitorToken(secret: string, ip: string, userAgent: string, now: Date = new Date()): string {
  const dayKey = createHmac('sha256', secret).update(utcDay(now)).digest()
  return createHmac('sha256', dayKey).update(`${ip}|${userAgent}`).digest('hex').slice(0, 16)
}

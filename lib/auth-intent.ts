// lib/auth-intent.ts
// ── Cross-browser sign-in: "where was this person, and what were they doing?" ─────────────────────────────────────
//
// THE PROBLEM THIS SOLVES
// A magic link is opened in a different browser context than the one that asked for it (incognito -> normal browser,
// a mail app's in-app browser, a phone -> a laptop). That browser has empty localStorage, so everything the callback
// needs to put the person back where they were has to travel some other way.
//
// Until now it travelled in the link's query string (?xd= ?xs= ?rt= ?us= ?uc= ?ct=). That is fragile in two ways:
//   1. Supabase only honours emailRedirectTo when it matches the project's Redirect URL allow-list (or has the same
//      host as the Site URL). If it does not match, Supabase silently redirects to the Site URL instead and the whole
//      query string is dropped -> the person lands on Home with no way back to their Council. Google sign-in does not
//      hit this because its redirectTo has no query string, which is why Google worked and the email link did not.
//   2. Nothing recovered from a link that failed (expired / already opened by a mail scanner): the callback sent
//      everyone to Home.
//
// THE FIX: a second, server-side carrier keyed by the one thing that survives every browser switch — the EMAIL ADDRESS.
// POST /api/auth stores a short-lived "pending intent" row (auth_pending_intents) when the link is requested; the
// callback, once Supabase has verified the person, asks POST /api/auth/resume for it (Bearer-authenticated, so only
// the owner of that inbox can read it) and merges it with whatever the URL and localStorage still hold.
//
// Pure + dependency-light so the client callback, the API routes and the tests all share one definition.

import { sanitizeReturnTo } from '@/lib/return-to'

/** How long a pending intent is honoured. Matches Supabase's default magic-link lifetime (1 hour). */
export const INTENT_TTL_MS = 60 * 60 * 1000
export const MAX_INTENT_SESSIONS = 40

export interface AuthIntent {
  returnTo:    string | null
  sessionIds:  string[]
  deviceId:    string | null
  utmSource:   string | null
  utmCampaign: string | null
  utmContent:  string | null
}

export const EMPTY_INTENT: AuthIntent = {
  returnTo: null, sessionIds: [], deviceId: null, utmSource: null, utmCampaign: null, utmContent: null,
}

// sessions.id is a uuid and link_sessions_to_user takes uuid[] — one malformed entry makes the whole RPC fail, so
// anything that is not a real uuid is dropped here rather than discovered at the database.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function cleanSessionIds(raw: unknown, max = MAX_INTENT_SESSIONS): string[] {
  const list: unknown[] = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : []
  const out: string[] = []
  for (const v of list) {
    if (typeof v !== 'string') continue
    const id = v.trim()
    if (UUID_RE.test(id) && !out.includes(id)) out.push(id)
    if (out.length >= max) break
  }
  return out
}

function cleanText(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t && t.length <= max ? t : null
}

/** Normalises anything (a request body, a database row, a URL param bag) into a safe AuthIntent. Never throws. */
export function sanitizeIntent(raw: unknown): AuthIntent {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    returnTo:    sanitizeReturnTo(r.returnTo),
    sessionIds:  cleanSessionIds(r.sessionIds),
    deviceId:    cleanText(r.deviceId, 100),
    utmSource:   cleanText(r.utmSource, 120),
    utmCampaign: cleanText(r.utmCampaign, 120),
    utmContent:  cleanText(r.utmContent, 120),
  }
}

export interface IdentitySources {
  /** localStorage in THIS browser — empty when the link was opened somewhere else. */
  local:  { sessionIds: string[]; deviceId: string | null; returnTo: string | null }
  /** The magic link's own query string (?xs ?xd ?rt ?us ?uc ?ct) — gone if Supabase fell back to the Site URL. */
  url:    { sessionIds: string[]; deviceId: string | null; returnTo: string | null; utmSource: string | null; utmCampaign: string | null; utmContent: string | null }
  /** The server-side pending intent for this email, or null. */
  intent: AuthIntent | null
}

export interface MergedIdentity {
  sessionIds: string[]
  deviceIds:  string[]
  returnTo:   string | null
  utm:        { source: string | null; campaign: string | null; content: string | null }
}

/**
 * Combines the three carriers. Session ids and device ids are a de-duplicated UNION (linking more of the person's own
 * anonymous sessions is always right). The return path is a PRIORITY pick — the link they actually clicked wins, then
 * the intent recorded when that link was requested, then this browser's last-saved value (a Google round trip).
 */
export function mergeIdentity(s: IdentitySources): MergedIdentity {
  const sessionIds = cleanSessionIds([...s.url.sessionIds, ...(s.intent?.sessionIds ?? []), ...s.local.sessionIds])
  const deviceIds  = Array.from(new Set([s.url.deviceId, s.intent?.deviceId ?? null, s.local.deviceId].filter((d): d is string => !!d)))
  const returnTo   = sanitizeReturnTo(s.url.returnTo) ?? sanitizeReturnTo(s.intent?.returnTo) ?? sanitizeReturnTo(s.local.returnTo)
  return {
    sessionIds, deviceIds, returnTo,
    utm: {
      source:   s.url.utmSource   ?? s.intent?.utmSource   ?? null,
      campaign: s.url.utmCampaign ?? s.intent?.utmCampaign ?? null,
      content:  s.url.utmContent  ?? s.intent?.utmContent  ?? null,
    },
  }
}

// ── What Supabase puts in the URL when a link fails ──────────────────────────────────────────────────────────────
// With the implicit flow this project uses, a failed link arrives as  #error=access_denied&error_code=otp_expired&...
// in the URL HASH, not the query string — which the callback used to look at, so it never saw the error and fell
// through to a confusing "no session" failure.

export interface ParsedAuthHash {
  hasTokens:   boolean
  error:       string | null
  errorCode:   string | null
  description: string | null
  /** 'expired' covers expired AND already-used links (a mail scanner opening the link first looks identical). */
  kind:        'ok' | 'expired' | 'denied' | 'none'
}

export function parseAuthHash(hash: string | null | undefined): ParsedAuthHash {
  const raw = (hash ?? '').replace(/^#/, '')
  if (!raw) return { hasTokens: false, error: null, errorCode: null, description: null, kind: 'none' }
  const p = new URLSearchParams(raw)
  const error = p.get('error')
  const errorCode = p.get('error_code')
  const description = p.get('error_description')
  const hasTokens = !!p.get('access_token')
  if (error || errorCode) {
    const expired = errorCode === 'otp_expired' || /expired|invalid|already/i.test(description ?? '')
    return { hasTokens, error, errorCode, description, kind: expired ? 'expired' : 'denied' }
  }
  return { hasTokens, error: null, errorCode: null, description: null, kind: hasTokens ? 'ok' : 'none' }
}

/** Appends a query flag to a same-origin path, respecting an existing query string. */
export function withQueryFlag(path: string, key: string, value: string): string {
  return `${path}${path.includes('?') ? '&' : '?'}${encodeURIComponent(key)}=${encodeURIComponent(value)}`
}

// ── Pre-hydration rescue ─────────────────────────────────────────────────────────────────────────────────────────
// If Supabase ever sends someone to a page other than /auth/callback (Site URL fallback, a stale allow-list), the
// tokens still arrive in the URL hash of whatever page they landed on, and the Supabase client would quietly sign them
// in there — with no session linking and no way back to their Council. This script runs in <head>, before React, and
// forwards that hash to /auth/callback so the one code path that does the full job always runs.
//
// It is a string (not a function) because it is inlined into app/layout.tsx; tests/auth-intent.test.ts executes it
// against fake locations so the string cannot silently drift from the intended behaviour.
export const AUTH_HASH_RESCUE_SCRIPT = `(function(){try{
var l=window.location,h=l.hash||'';
if(!h)return;
if(l.pathname==='/auth/callback'){window.__QUORUM_AUTH_HASH__=h;return}
if(/(^#|&)access_token=/.test(h)&&/(^#|&)refresh_token=/.test(h)||/(^#|&)error_code=/.test(h)){
l.replace('/auth/callback'+(l.search||'')+h);
}
}catch(e){}})();`

/**
 * On /auth/callback the same script stashes the original hash on window before any client code runs. The Supabase
 * client reads (and may then clear) the hash while it initialises, which would race with the callback reading an
 * error out of it; the stash makes that read deterministic.
 */
export function readInitialAuthHash(): string {
  if (typeof window === 'undefined') return ''
  return (window as unknown as { __QUORUM_AUTH_HASH__?: string }).__QUORUM_AUTH_HASH__ ?? window.location.hash
}

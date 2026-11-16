// lib/url-prefill.ts
// -- Prepopulated decision links (Nov 2026) ------------------------------------------------------------------
// A marketing link such as
//   https://app.quorumvault.org/?decision=I%20have%20two%20job%20offers...&utm_source=linkedin&utm_campaign=job_offers
// should open the front door with that text already sitting in the chat box. The visitor edits it, deletes it or
// sends it. NOTHING here (or in the caller) ever sends it for them.
//
// Pure helpers only: no React, no storage, no network. components/ChatIntake.tsx owns the input state and calls these.
//
// Privacy / safety:
//   - The text is untrusted. It is only ever put into a <textarea> value (React sets it as text, never as HTML).
//   - Invisible direction-override characters and control characters are removed, so a link cannot make the box show
//     something different from what is stored. Zero-width joiners are KEPT (Devanagari, Arabic and emoji need them).
//   - Analytics gets the LENGTH and flags, never the text (see ChatIntake: decision_prefill_loaded).
//
// Precedence when more than one source wants to fill the empty box (highest first):
//   1. sessionStorage hand-off (lib/prefill.ts)  - an in-app "Bring it now" the person just chose themselves
//   2. ?decision= in the URL                      - a link someone sent them
//      ?scenario=<slug>                           - same, but a short link whose wording lives in lib/post-scenarios.ts
//                                                   (?decision= wins when both are present)
//   3. ?q=1                                       - focus only, carries no text
// Starter cards are never a conflict: they act on a click, after the box exists, and replace the text by design.

import { MAX_PREFILL_CHARS } from './prefill'
import { SCENARIO_PARAM, scenarioText } from './post-scenarios'

export const DECISION_PARAM = 'decision'

export interface UrlDecisionPrefill {
  /** Cleaned text, at most MAX_PREFILL_CHARS characters. Never empty. */
  text: string
  /** True when the link carried more than we keep. */
  truncated: boolean
}

// Controls except tab and newline (\u0009, \u000A), DEL and the C1 range, BOM, and the bidi embedding / override /
// isolate characters (\u202A-\u202E, \u2066-\u2069). Zero-width joiner / non-joiner and LRM / RLM stay.
// eslint-disable-next-line no-control-regex
const STRIP_CHARS = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\uFEFF\u202A-\u202E\u2066-\u2069\uFFFD]/g
// Built with the constructor so the unicode-property escape does not depend on the TS compile target.
const HAS_LETTER_OR_DIGIT = new RegExp('[\\p{L}\\p{N}]', 'u')

// Reading a huge value is pointless and slow; anything past this is cut before cleaning.
const RAW_READ_LIMIT = MAX_PREFILL_CHARS * 8

/**
 * Clean arbitrary text into something safe to put in the chat box. Null when nothing usable is left
 * (empty, whitespace, or no letter/digit at all, e.g. a value that is only punctuation or broken bytes).
 */
export function cleanPrefillText(raw: unknown, max: number = MAX_PREFILL_CHARS): UrlDecisionPrefill | null {
  if (typeof raw !== 'string') return null
  let truncated = raw.length > RAW_READ_LIMIT
  let t = truncated ? raw.slice(0, RAW_READ_LIMIT) : raw
  try { t = t.normalize('NFC') } catch { /* keep as is */ }
  t = t
    .replace(/\r\n?/g, '\n')
    .replace(/[\u2028\u2029]/g, '\n')
    .replace(STRIP_CHARS, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  if (!t || !HAS_LETTER_OR_DIGIT.test(t)) return null

  // Cut by code point, not UTF-16 unit, so an emoji or a rare script is never split in half.
  const points = Array.from(t)
  if (points.length > max) {
    t = points.slice(0, max).join('').trimEnd()
    truncated = true
  }
  return t ? { text: t, truncated } : null
}

/**
 * Read ?decision= from a location.search string. URLSearchParams has already URI-decoded the value, so it is NOT
 * decoded again (decoding twice throws on a literal "%", e.g. "cut prices by 20%" - the same bug HomeClient fixed).
 * Malformed percent-sequences never throw; the broken bytes just become U+FFFD, which cleanPrefillText removes.
 * With several ?decision= values the first one wins.
 */
export function readUrlDecisionPrefill(search: unknown): UrlDecisionPrefill | null {
  if (typeof search !== 'string' || !search) return null
  let raw: string | null
  try {
    const params = new URLSearchParams(search)
    raw = params.get(DECISION_PARAM)
    // Campaign scenario: only when there is no usable ?decision= text, so a hand-written link always wins.
    if (!cleanPrefillText(raw)) raw = scenarioText(params.get(SCENARIO_PARAM))
  } catch { return null }
  return cleanPrefillText(raw)
}

/** True when the query string has a decision or scenario key at all (even an empty or unusable one), so it can be tidied away. */
export function hasDecisionParam(search: unknown): boolean {
  if (typeof search !== 'string' || !search) return false
  try { const p = new URLSearchParams(search); return p.has(DECISION_PARAM) || p.has(SCENARIO_PARAM) } catch { return false }
}

/**
 * The same location with the named query keys removed. Every other pair is kept EXACTLY as it was written (no
 * re-encoding, same order), so utm_source / utm_medium / utm_campaign / utm_content / utm_term, fbclid, ?n= and
 * everything else survive untouched. The #hash is kept too.
 */
export function urlWithoutParams(pathname: string, search: string, hash: string, removeIn: readonly string[]): string {
  // Tidying away ?decision= also tidies away ?scenario= (the same kind of link), so neither stays in the address bar.
  const remove = removeIn.includes(DECISION_PARAM) ? [...removeIn, SCENARIO_PARAM] : removeIn
  const raw = (search || '').startsWith('?') ? search.slice(1) : (search || '')
  const kept = raw.split('&').filter(pair => {
    if (!pair) return false
    const k = pair.split('=')[0]
    let key = k
    try { key = decodeURIComponent(k.replace(/\+/g, ' ')) } catch { /* compare the raw key */ }
    return !remove.includes(key)
  })
  return (pathname || '/') + (kept.length ? `?${kept.join('&')}` : '') + (hash || '')
}

export type PrefillSource = 'session' | 'url'

/** Apply the precedence documented at the top of this file. */
export function resolveFirstMessagePrefill(args: {
  sessionPrefill: string | null | undefined
  urlPrefill:     string | null | undefined
}): { text: string; source: PrefillSource } | null {
  if (args.sessionPrefill && args.sessionPrefill.trim()) return { text: args.sessionPrefill, source: 'session' }
  if (args.urlPrefill && args.urlPrefill.trim())         return { text: args.urlPrefill,     source: 'url' }
  return null
}

// One claim per page load. ChatIntake can mount more than once in a page's life (React StrictMode in dev, and the
// "Bring me another decision" remount); the same URL text must never be loaded, or counted, twice.
let claimedText: string | null = null
export function claimUrlPrefill(text: string): boolean {
  if (claimedText === text) return false
  claimedText = text
  return true
}
/** Test hook: module state lives for one page load in the browser. */
export function __resetUrlPrefillForTests(): void { claimedText = null }

const squash = (s: string) => s.trim().replace(/\s+/g, ' ')

/**
 * Props for decision_started: whether the first message came from a prefilled link, and whether the person changed
 * it. Empty object for an ordinary visit, so ordinary decision_started events are byte-identical to before.
 * Compared ignoring only whitespace; any wording change (including swapping in a starter card) counts as edited.
 */
export function prefillSendProps(applied: string | null, sent: string): Record<string, boolean> {
  if (!applied) return {}
  return { prefilled: true, prefill_edited: squash(applied) !== squash(sent) }
}

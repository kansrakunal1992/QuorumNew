// lib/json-repair.ts
// ── Shared JSON recovery utilities for parsing AI model output ───────────────
//
// Model responses that are supposed to be pure JSON often aren't, in two
// distinct ways this file handles separately:
//
//   1. Wrapping / preamble — the model adds a code fence, or a sentence of
//      commentary before or after the actual JSON ("Here's the analysis:
//      { ... } Let me know if you'd like changes."). The real JSON is in
//      there, just not the whole string. extractJSONSlice() finds it.
//
//   2. Malformed JSON syntax — single-quoted keys/values, trailing commas,
//      unescaped characters inside string values (most common in long
//      free-text fields like a "reasoning" string). repairJSON() fixes it.
//
// parseJSONLoose() combines both into one attempt chain, so any caller with
// a "the model was supposed to return JSON" problem can use one function
// instead of re-deriving this. It never throws — returns null on failure so
// callers keep whatever fallback behavior they already have.
//
// History: repairJSON() originally lived only in lib/bias-scorer.ts, added
// to handle two specific DeepSeek failure modes seen in production. Moved
// here (2026-08) so lib/ontology-tagger.ts could reuse the same tolerance —
// the tagger's own JSON.parse had no recovery path at all before this, and a
// bracket-slice fallback for it had been planned but never built. bias-scorer.ts
// now imports repairJSON from here instead of defining its own copy.
// ─────────────────────────────────────────────────────────────────────────────

// ── extractJSONSlice ──────────────────────────────────────────────────────────
// Finds the first top-level {...} or [...] in a string and returns just that
// slice, so preamble or trailing commentary around the real JSON doesn't
// break JSON.parse. Bracket-depth tracking correctly skips over braces/
// brackets that appear inside string literals (so `{"note": "use {curly}
// braces"}` isn't miscounted), and respects backslash-escaped characters
// inside strings so an escaped quote doesn't look like the string ending.
//
// Returns the original (trimmed) string unchanged if no balanced top-level
// object or array is found, so a caller's own JSON.parse still fails
// naturally and its existing error handling still runs — this function only
// ever narrows the input, never invents content.
export function extractJSONSlice(raw: string): string {
  const s = raw.trim()

  // Find the first opening bracket of either kind.
  let start = -1
  let openChar: '{' | '[' = '{'
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '{' || s[i] === '[') {
      start = i
      openChar = s[i] as '{' | '['
      break
    }
  }
  if (start === -1) return s

  const closeChar = openChar === '{' ? '}' : ']'
  let depth = 0
  let inString = false

  for (let i = start; i < s.length; i++) {
    const ch = s[i]

    if (inString) {
      if (ch === '\\') { i++; continue }       // skip the escaped character too
      if (ch === '"') inString = false
      continue
    }

    if (ch === '"') { inString = true; continue }
    if (ch === openChar) depth++
    else if (ch === closeChar) {
      depth--
      if (depth === 0) return s.slice(start, i + 1)
    }
  }

  // Never found a matching close (truncated response, etc.) — return
  // everything from the opening bracket onward and let JSON.parse fail
  // naturally rather than guessing at where it should have ended.
  return s.slice(start)
}

// ── repairJSON ────────────────────────────────────────────────────────────────
// Handles two distinct classes of malformed-JSON error in two sequential
// phases, seen most often from DeepSeek responses:
//
// Phase 1 (structural) — the "Expected double-quoted property name" class:
//   single-quoted keys/values, JS-style comments, trailing commas.
//
// Phase 2 (string content) — the "Expected ',' or '}' after property value"
//   class: unescaped newlines / tabs / embedded double-quotes inside string
//   values (typically in long free-text fields). Uses a character-by-character
//   scan with a peek-ahead heuristic on `"` characters: if the next
//   non-whitespace character is a JSON structural character (',', '}', ']',
//   ':') the quote ends the string; otherwise it's an embedded unescaped
//   quote and gets escaped in place.
export function repairJSON(raw: string): string {
  // ── Phase 1: structural fixes ──────────────────────────────────────────
  let s = raw
    .replace(/\/\*[\s\S]*?\*\//g, '')                  // block comments
    .replace(/\/\/[^\n\r]*/g, '')                       // line comments
    .replace(/([{,]\s*)'([^'\\]+)'\s*:/g, '$1"$2":')  // single-quoted keys
    .replace(/:\s*'([^'\\]*)'/g, ': "$1"')             // single-quoted values
    .replace(/,(\s*[}\]])/g, '$1')                      // trailing commas
    .trim()

  // Fast path: Phase 1 was sufficient
  try { JSON.parse(s); return s } catch { /* fall through to Phase 2 */ }

  // ── Phase 2: string content repair ────────────────────────────────────
  const STRUCTURAL = new Set([',', '}', ']', ':'])
  let out = ''
  let i   = 0

  while (i < s.length) {
    const ch = s[i]

    if (ch !== '"') { out += ch; i++; continue }

    // ── Entering a string ──
    out += '"'
    i++

    while (i < s.length) {
      const c = s[i]

      // Already-escaped sequence: copy both characters verbatim
      if (c === '\\') {
        out += c; i++
        if (i < s.length) { out += s[i]; i++ }
        continue
      }

      // Quote character: decide if it ends the string or is embedded
      if (c === '"') {
        // Peek past whitespace to find the next meaningful character
        let j = i + 1
        while (j < s.length && (s[j] === ' ' || s[j] === '\r' || s[j] === '\n')) j++
        if (j >= s.length || STRUCTURAL.has(s[j])) {
          out += '"'; i++; break        // genuine end-of-string
        }
        out += '\\"'; i++; continue    // embedded quote — escape and stay inside string
      }

      // Illegal raw control characters inside a JSON string
      if (c === '\n') { out += '\\n'; i++; continue }
      if (c === '\r') { out += '\\r'; i++; continue }
      if (c === '\t') { out += '\\t'; i++; continue }

      out += c; i++
    }
  }

  return out
}

// ── parseJSONLoose ─────────────────────────────────────────────────────────────
// One attempt chain combining both recovery strategies above. Tries, in
// order: (1) parse as-is, (2) strip a code fence + bracket-slice + parse,
// (3) the same slice run through repairJSON + parse. Returns null (never
// throws) if every attempt fails, so callers keep whatever fallback
// behavior they already have for "the model didn't give us usable JSON."
export function parseJSONLoose<T = unknown>(raw: string): T | null {
  const fenceStripped = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim()

  try {
    return JSON.parse(fenceStripped) as T
  } catch { /* try the next strategy */ }

  const sliced = extractJSONSlice(fenceStripped)
  try {
    return JSON.parse(sliced) as T
  } catch { /* try the next strategy */ }

  try {
    return JSON.parse(repairJSON(sliced)) as T
  } catch {
    return null
  }
}

// lib/chat-intake-context.ts
// ── Tiny, client-safe context helpers ───────────────────────────────────────
// Split out of lib/chat-intake-state.ts (build fix, Sept 2026): that module
// imports lib/ai-client.ts, which carries a build-time `import 'server-only'`
// guard (Sprint TB1) — anything that transitively imports it can never be
// reached from a Client Component; Next fails the build with "You're
// importing a component that needs 'server-only'" if it is.
// components/SessionView.tsx ('use client') needs parseOptionLabels() for
// the Prediction-continuity fix (pre-Council leaning screen referencing the
// finalized options) — pulling it from chat-intake-state.ts dragged that
// whole server-only ai-client graph into the client bundle and broke the
// Railway build. This file has zero dependencies of its own, so it's safe
// for both server routes and client components to import.
//
// OPTIONS_LINE_PREFIX is the single source of truth for the "Options
// considered: ..." line format: lib/chat-intake-state.ts's
// assembleSessionInput() (server-only, unaffected by this split) imports it
// from here to WRITE that line into context_text; parseOptionLabels() below
// is how a client component reads it back out later, without needing
// anything else that file has.

export const OPTIONS_LINE_PREFIX = 'Options considered: '

/**
 * Reverses the "Options considered: A; B" line assembleSessionInput()
 * writes into context_text, for screens that want the finalized option
 * labels for continuity. Returns [] for a classic (non-chat) session, where
 * context_text never had this line to begin with — callers should treat
 * that as "no continuity data available" and fall back to generic copy, not
 * as an error.
 */
export function parseOptionLabels(contextText: string | null | undefined): string[] {
  if (!contextText) return []
  const line = contextText.split('\n').find(l => l.startsWith(OPTIONS_LINE_PREFIX))
  if (!line) return []
  return line.slice(OPTIONS_LINE_PREFIX.length).split(';').map(s => s.trim()).filter(Boolean)
}

// ── v4: the rest of the structured lines assembleSessionInput() writes ─────
// Same single-source-of-truth rule as OPTIONS_LINE_PREFIX above: the server
// writes these lines into context_text, and anything that needs them back
// (the prediction route, the examiner derive step) reads them with
// parseContextLine() instead of re-implementing the format.
export const LEAN_LINE_PREFIX     = 'Where they are leaning: '
export const PRIORITY_LINE_PREFIX = 'What matters most to them: '
export const GUT_LINE_PREFIX      = 'How they feel about it: '
export const SUCCESS_LINE_PREFIX  = 'What a good outcome looks like to them: '

/** Returns the text after `prefix` on the first matching line, or null. */
export function parseContextLine(
  contextText: string | null | undefined,
  prefix: string,
): string | null {
  if (!contextText) return null
  const line = contextText.split('\n').find(l => l.startsWith(prefix))
  if (!line) return null
  const value = line.slice(prefix.length).trim()
  return value || null
}

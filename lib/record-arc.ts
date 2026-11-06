// lib/record-arc.ts
// ── "How this decision moved" — what the Record page and the PDF brief say about lean / guess / choice (pure) ──────
//
// Two things were wrong on a brand-new person's first Record:
//
//  1. INITIAL LEAN said "Leaning yes" for a decision like "Buy the house now / Keep looking". The stored value
//     sessions.initial_instinct is only ever 'accept' | 'reject' | 'unsure' (a position on an ambiguous yes/no axis),
//     and the Record page translated that bare value. The exact option the person tapped IS saved — as the
//     "Where they are leaning: …" line in the session's context — and the in-session reveal already uses it. The
//     Record now shows that option, and only falls back to yes / no when the session never had named options.
//
//  2. QUORUM PREDICTED / "This surprised Quorum" presented a first-ever decision exactly like a personalised one.
//     Quorum predicts from decision #1 BY DESIGN (lib/prediction-engine.ts: below HISTORY_THRESHOLD_FOR_PERSONALIZATION
//     it falls back to a web-search "how people generally decide" guess and says so in its reasoning). That caveat was
//     never carried to the Record, so a person Quorum had never met was told they "surprised" it. The live reveal
//     (components/PredictionReveal.tsx, `earlyUser`) already words this honestly; this module gives the Record and the
//     PDF the same wording from the same threshold.
//
// If you would rather NOT show a guess at all for a person's first decisions, flip SHOW_EARLY_PREDICTION_ON_RECORD.

import { LEAN_LINE_PREFIX, parseContextLine } from '@/lib/chat-intake-context'

/** One of a person's first decisions: Quorum's guess came from general patterns, not from their own history. Matches SessionView's `earlyUser`. */
export const EARLY_DECISION_MAX = 3

/** false -> a person's first decisions show their lean and final choice only; the guess (and "surprised") is hidden. */
export const SHOW_EARLY_PREDICTION_ON_RECORD = true

export interface RecordArcInput {
  initialInstinct:    string | null | undefined
  /** Decrypted sessions.context_text (carries the saved option list + "Where they are leaning" line). */
  contextText:        string | null | undefined
  predictedChoice:    string | null | undefined
  predictionMatched:  boolean | null | undefined
  finalDecision:      string | null | undefined
  /** How many decisions this person had made when this one was made (this one included). */
  decisionsSoFar:     number | null | undefined
}

export interface RecordArc {
  early:         boolean
  /** Text under "Initial lean", or null to omit the field. */
  lean:          string | null
  /** Heading for the guess ("Quorum predicted" / "Quorum's first guess"), or null when no guess should be shown. */
  guessHeading:  string | null
  guess:         string | null
  /** One-line honesty note under an early guess, or null. */
  guessNote:     string | null
  /** Line under "Finally chose" comparing it with the guess, or null. */
  verdict:       string | null
}

const NOT_SURE = 'not sure yet'

export function leanDisplay(initialInstinct: string | null | undefined, contextText: string | null | undefined): string | null {
  const saved = parseContextLine(contextText, LEAN_LINE_PREFIX)
  if (saved && saved.trim().toLowerCase() !== NOT_SURE) return saved.trim()      // the exact option they tapped
  if (initialInstinct === 'accept') return 'Leaning yes'
  if (initialInstinct === 'reject') return 'Leaning no'
  if (initialInstinct === 'unsure' || saved) return 'Genuinely unsure'
  return null
}

export function buildRecordArc(i: RecordArcInput): RecordArc {
  const early = (i.decisionsSoFar ?? 0) <= EARLY_DECISION_MAX
  const hideGuess = early && !SHOW_EARLY_PREDICTION_ON_RECORD
  const hasGuess = !!i.predictedChoice?.trim() && !hideGuess
  const matched = i.predictionMatched

  let verdict: string | null = null
  if (hasGuess && matched !== null && matched !== undefined) {
    verdict = early
      ? (matched ? 'Quorum\u2019s first guess matched' : 'Quorum guessed differently')
      : (matched ? 'Quorum predicted this' : 'This surprised Quorum')
  }

  return {
    early,
    lean:         leanDisplay(i.initialInstinct, i.contextText),
    guessHeading: hasGuess ? (early ? 'Quorum\u2019s first guess' : 'Quorum predicted') : null,
    guess:        hasGuess ? i.predictedChoice!.trim() : null,
    guessNote:    hasGuess && early ? 'A general-pattern guess \u2014 Quorum is still learning how you decide.' : null,
    verdict,
  }
}

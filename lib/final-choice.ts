// lib/final-choice.ts
// ── The decision box after the Council: tappable options, and an exact match with Quorum's guess (pure) ──
//
// After the Council a person records what they are actually going to do. That used to be free text only, which made two
// things unreliable: (1) it could not be compared with where they leaned earlier, because the wording never matched the
// options they were shown; (2) "did Quorum guess it?" was a keyword overlap on the typed words, so "I'll accept the
// offer" could count as a miss against a guess of "Take the better job".
//
// The options are the SAME ones shown on the confirm screen (same labels, same order, same cap, same clipping — built
// by the same function), read back from the session's saved context. Quorum's prediction is instructed to name one of
// those options (lib/prediction-engine.ts), so a tapped option can be compared with it exactly. "Something else" stays
// as free text and falls back to the old keyword comparison.
//
// Pure and dependency-light: used by a client component and by the decide route.

import { buildLeanChoices } from '@/lib/chat-intake-lean'

export interface FinalChoice {
  /** What the chip shows (clipped for a phone). */
  label:       string
  /** The full option text: this is what is saved as the final decision. */
  fullLabel:   string
  /** True for the option they tapped as their first lean on the confirm screen. */
  isFirstLean: boolean
}

const norm = (s: string | null | undefined): string =>
  String(s ?? '').toLowerCase().replace(/[\u201C\u201D"'\u2019.!?]+/g, '').replace(/\s+/g, ' ').trim()

/**
 * The tappable options for the decision box, or null when there are fewer than two named options (older or classic
 * sessions): the box then stays exactly as before, a text field. The generic "Not sure yet" chip from the confirm
 * screen is not offered here — a recorded decision is a decision; "Something else" covers "still undecided".
 */
export function finalChoicesFor(
  optionLabels: string[] | null | undefined,
  firstLeanLabel: string | null | undefined,
): FinalChoice[] | null {
  const labels = (optionLabels ?? []).map(l => l.trim()).filter(Boolean)
  if (labels.length < 2) return null
  // Only the labels, their order, the cap and the clipping matter here — so the option type is irrelevant.
  const chips = buildLeanChoices(labels.map(label => ({ label, type: 'wait' as const }))).filter(c => !c.isUnsure)
  const lean = norm(firstLeanLabel)
  return chips.map(c => ({ label: c.label, fullLabel: c.fullLabel, isFirstLean: !!lean && norm(c.fullLabel) === lean }))
}

/**
 * Did the tapped option match Quorum's guess? true / false when both can be tied to the session's real options;
 * null when they cannot (an unknown option, or a guess that names none of them) — the caller then falls back to the
 * older keyword comparison, so nothing gets worse.
 */
export function matchPrediction(
  predicted:    string | null | undefined,
  optionLabels: string[] | null | undefined,
  chosenLabel:  string | null | undefined,
): boolean | null {
  const labels = (optionLabels ?? []).map(l => l.trim()).filter(Boolean)
  const chosen = norm(chosenLabel)
  const guess  = norm(predicted)
  if (!chosen || !guess || labels.length < 2) return null
  const normLabels = labels.map(norm)
  if (!normLabels.includes(chosen)) return null                    // not one of this session's options: do not trust it

  let idx = normLabels.indexOf(guess)                              // the guess is an option, word for word
  if (idx === -1 && guess.length >= 4) {
    // "shortened is fine": the guess may be a shorter form of one option, or an option inside a longer guess.
    const hits = normLabels.map((l, i) => (l.includes(guess) || guess.includes(l) ? i : -1)).filter(i => i >= 0)
    if (hits.length === 1) idx = hits[0]
  }
  if (idx === -1) return null
  return normLabels[idx] === chosen
}

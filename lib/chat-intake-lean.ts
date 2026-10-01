// lib/chat-intake-lean.ts
// ── Natural Intake (v4) — end-of-chat lean + priority chips ───────────────────
//
// The chat used to end by handing the person to a separate "lean" screen
// (InitialInstinctCapture) after the checkpoint. v4 moves that capture to the
// last step of the chat itself, as two tap-only questions, so the prediction
// can start the moment the person confirms their decision.
//
// Pure and dependency-free on purpose (types only): this is imported by a
// Client Component (ChatIntake.tsx) AND by server routes, so it must never
// pull in lib/ai-client.ts's server-only guard — same rule, same reason as
// lib/chat-intake-context.ts.
//
// The stored contract is unchanged: sessions.initial_instinct is still only
// ever 'accept' | 'reject' | 'unsure', and optimization_priority is still one
// of the six values app/api/session/[id]/instinct/route.ts already accepts.
// What's new is that the chip the person tapped keeps its exact option label
// (chosenLeanLabel), so the prediction can reason about "Switch to Y" instead
// of an ambiguous "accept".

import type { ChatDecisionOption, ChatDecisionState } from '@/lib/types'

export type LeanValue = 'accept' | 'reject' | 'unsure'

export interface LeanChoice {
  value: LeanValue
  /** Text shown on the chip (clipped so it fits on a phone). */
  label: string
  /** Full, unclipped option text — this is what gets saved as chosenLeanLabel. */
  fullLabel: string
  /** True for the "not sure yet" chip — saved with a null label. */
  isUnsure?: boolean
}

export const PRIORITIES: { value: string; label: string }[] = [
  { value: 'career_growth', label: 'Career growth' },
  { value: 'security',      label: 'Security' },
  { value: 'money',         label: 'Money' },
  { value: 'time_freedom',  label: 'Time / freedom' },
  { value: 'family',        label: 'Family' },
  { value: 'other',         label: 'Something else' },
]

export const VALID_LEAN_VALUES: readonly LeanValue[] = ['accept', 'reject', 'unsure']
export const VALID_PRIORITY_VALUES: readonly string[] = PRIORITIES.map(p => p.value)

export const UNSURE_LABEL = 'Not sure yet'
const MAX_OPTION_CHIPS = 4
const MAX_LABEL_CHARS  = 52

export function priorityLabel(value: string | null | undefined): string {
  return PRIORITIES.find(p => p.value === value)?.label ?? (value ?? '')
}

function clip(label: string): string {
  const t = label.trim()
  return t.length > MAX_LABEL_CHARS ? `${t.slice(0, MAX_LABEL_CHARS - 1).trimEnd()}\u2026` : t
}

function valueForType(type: ChatDecisionOption['type'] | undefined): LeanValue {
  if (type === 'act')      return 'accept'
  if (type === 'dont_act') return 'reject'
  return 'unsure'   // wait / gather_info / experiment — "not committing yet"
}

/**
 * Builds the lean chips from the options the chat extracted.
 *
 *  - Options carrying act / dont_act types map by type (so "Switch to Y" is
 *    'accept' and "Stay at X" is 'reject' regardless of the order they came
 *    up in).
 *  - Otherwise falls back to InitialInstinctCapture's own positional
 *    convention: first option = accept, second = reject, the rest unsure.
 *  - Fewer than two usable options → the same generic yes / no wording the
 *    classic lean screen uses.
 *  - A "Not sure yet" chip is always last.
 */
export function buildLeanChoices(options: ChatDecisionOption[] | null | undefined): LeanChoice[] {
  const usable = (options ?? []).filter(o => o?.label?.trim())
  const unsure: LeanChoice = { value: 'unsure', label: UNSURE_LABEL, fullLabel: UNSURE_LABEL, isUnsure: true }

  if (usable.length < 2) {
    return [
      { value: 'accept', label: 'Leaning yes', fullLabel: 'Leaning yes' },
      { value: 'reject', label: 'Leaning no',  fullLabel: 'Leaning no' },
      unsure,
    ]
  }

  const capped  = usable.slice(0, MAX_OPTION_CHIPS)
  const typed   = capped.some(o => o.type === 'act' || o.type === 'dont_act')
  const chips: LeanChoice[] = capped.map((o, i) => ({
    value: typed ? valueForType(o.type) : (i === 0 ? 'accept' : i === 1 ? 'reject' : 'unsure'),
    label: clip(o.label),
    fullLabel: o.label.trim(),
  }))

  // An option that itself maps to "unsure" (e.g. "Wait a few months") is a
  // real stated lean, so keep it as its own chip — and still add the generic
  // "Not sure yet" so nobody is forced to pick a stance they don't hold.
  return [...chips, unsure]
}

/** Finds which chip (if any) matches a previously saved selection. */
export function matchSavedLean(
  choices: LeanChoice[],
  chosenLean: LeanValue | null | undefined,
  chosenLeanLabel: string | null | undefined,
): LeanChoice | null {
  if (!chosenLean) return null
  if (chosenLean === 'unsure' && !chosenLeanLabel) return choices.find(c => c.isUnsure) ?? null
  return choices.find(c => c.fullLabel === chosenLeanLabel) ?? null
}

/**
 * v4: chosenLean / chosenLeanLabel / optimizationPriority are written only by
 * the end-of-chat chips (POST /api/chat-intake/lean), never by the model — so
 * the model's JSON (which doesn't know they exist) must not be allowed to
 * drop them. Matters when someone taps "Let me add more first" after picking
 * their chips: the next extraction run would otherwise erase their selection.
 */
export function preserveChipFields(
  priorState: ChatDecisionState | null,
  extracted:  ChatDecisionState,
): ChatDecisionState {
  if (!priorState) return extracted
  const out: ChatDecisionState = { ...extracted }
  if (priorState.chosenLean !== undefined)           out.chosenLean           = priorState.chosenLean
  if (priorState.chosenLeanLabel !== undefined)      out.chosenLeanLabel      = priorState.chosenLeanLabel
  if (priorState.optimizationPriority !== undefined) out.optimizationPriority = priorState.optimizationPriority
  return out
}

// lib/chat-intake-state.ts
// ── Natural Intake (v1) — running decision-state extraction ──────────────────
//
// This is Depth A from the plan (section 4D): a fast, cheap model call after
// every chat turn, updating a private "decision state" — never shown to the
// user directly, never gating the conversation. It exists purely so the
// checkpoint (Depth B, which reuses the EXISTING ontology tagger / bias
// scorer unchanged) has a well-formed decision_text + context_text to hand
// off, and so the Examiner derive-and-confirm check (lib/examiner-derive.ts)
// has something concrete to check against.
//
// Deliberately does NOT define a second taxonomy of dimensions, biases, or
// decision types (plan section 4D's hard rule) — this only extracts the
// generic shape (options, stakeholders, deadline, assumptions...), never
// anything resembling the 14-dimensional ontology, which stays the sole job
// of lib/ontology-tagger.ts, run once at the checkpoint exactly as today.

import { createCompletion } from '@/lib/ai-client'
import type { ChatDecisionState, ChatIntakeMessage } from '@/lib/types'

// ── Chat length (locked, Sept 2026) ──────────────────────────────────────────
export const DEFAULT_MAX_EXCHANGES  = 6
export const KEEP_THINKING_EXTRA    = 3   // "Let me add more" grants this many additional exchanges, once
export const ABSOLUTE_MAX_EXCHANGES = DEFAULT_MAX_EXCHANGES + KEEP_THINKING_EXTRA   // hard server-side ceiling regardless of client requests

const EXTRACTION_PROMPT = (
  priorState: ChatDecisionState | null,
  transcript: ChatIntakeMessage[],
) => `You maintain a compact internal note of a decision someone is talking through with an assistant. You do NOT talk to the user — you only update a private JSON record after each of their messages.

RULES:
- Only fill in a field when the transcript actually contains evidence for it. Leave everything else out (do not guess, do not invent placeholder values).
- Never ask a question yourself — you are not part of the conversation, only its notetaker.
- "options" should reflect real alternatives the person has named or clearly implied, including passive ones — staying with the status quo, waiting, or testing something first are all valid options, not just the two obvious named choices.
- "initialReaction" should only be set from the person's very first message in the transcript, before the assistant said anything back — capture their gut reaction untouched by anything the assistant said afterward. Never overwrite it once set.
- "userCorrections" should capture only cases where the person explicitly corrected something the assistant said back to them ("no, that's not it" / "actually..."). Do not use it for ordinary new information.
- Return ONLY a JSON object matching this shape (all fields optional, omit anything with no evidence yet):
{
  "decisionStatement": string,
  "options": [{ "label": string, "type": "act"|"dont_act"|"wait"|"gather_info"|"experiment" }],
  "leaningOptionType": "act"|"dont_act"|"wait"|"gather_info"|"experiment",
  "stakeholders": [{ "name": string, "role": string, "consultReason": "expertise"|"challenge"|"approval"|"affected"|"trust" }],
  "deadline": string,
  "reversibility": "reversible"|"somewhat_reversible"|"irreversible",
  "assumptions": [string],
  "unknowns": [string],
  "evidence": [string],
  "decisionThreshold": string,
  "initialReaction": "act"|"dont_act"|"wait"|"gather_info"|"experiment",
  "userCorrections": [string]
}

PRIOR STATE (carry forward and refine — do not drop a field just because this turn didn't mention it again):
${priorState ? JSON.stringify(priorState) : '(none yet — this is the first turn)'}

TRANSCRIPT SO FAR:
${transcript.map(m => `${m.role === 'user' ? 'PERSON' : 'ASSISTANT'}: ${m.content}`).join('\n')}

UPDATED JSON:`.trim()

/**
 * Runs the lightweight per-turn extraction. Cheap/fast tier by design — this
 * fires after every single message, unlike the checkpoint's one-time premium
 * ontology-tagger call. Never blocks the chat reply on failure: on any error
 * or malformed output, the prior state is returned unchanged rather than
 * losing what was already captured.
 */
export async function extractDecisionState(
  priorState: ChatDecisionState | null,
  transcript: ChatIntakeMessage[],
): Promise<ChatDecisionState> {
  try {
    const raw   = await createCompletion(EXTRACTION_PROMPT(priorState, transcript), 500, { provider: 'deepseek' })
    const clean = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim()
    const parsed = JSON.parse(clean)
    if (parsed && typeof parsed === 'object') {
      return parsed as ChatDecisionState
    }
    return priorState ?? {}
  } catch (err) {
    console.error('[ChatIntake] extractDecisionState failed:', err)
    return priorState ?? {}
  }
}

/**
 * "Maximum decision clarity per interaction" (plan section 4B) — stop asking
 * before the exchange ceiling if the state is already well-formed. Kept
 * deliberately simple and deterministic (no extra AI call) rather than a
 * second judgment model: a decision statement plus at least one option plus
 * at least one of {stakeholders, deadline, reversibility, assumptions} is
 * treated as "enough to checkpoint on" — the checkpoint screen itself is
 * where the person confirms or corrects it, so this only needs to be a
 * reasonable trigger, not a perfect one.
 */
export function hasEnoughToCheckpoint(state: ChatDecisionState): boolean {
  const hasStatement = !!state.decisionStatement?.trim()
  const hasOptions    = (state.options?.length ?? 0) > 0
  const hasContext     =
    (state.stakeholders?.length ?? 0) > 0 ||
    !!state.deadline ||
    !!state.reversibility ||
    (state.assumptions?.length ?? 0) > 0

  return hasStatement && hasOptions && hasContext
}

export function shouldStopEarly(state: ChatDecisionState, exchangeCount: number): boolean {
  // Never stop before 2 exchanges — the very first reply back needs at
  // least one follow-up, or this behaves like a form with extra steps.
  if (exchangeCount < 2) return false
  return hasEnoughToCheckpoint(state)
}

/**
 * Assembles the two fields the EXISTING POST /api/session expects
 * (decision_text, context_text) from the running state — this is the only
 * place a chat_intake's content ever becomes a real Quorum session. Nothing
 * downstream of /api/session needs to know a chat happened at all.
 */
export function assembleSessionInput(
  state: ChatDecisionState,
  transcript: ChatIntakeMessage[],
): { decisionText: string; contextText: string } {
  const decisionText = state.decisionStatement?.trim()
    || transcript.find(m => m.role === 'user')?.content?.trim()
    || ''

  const contextParts: string[] = []
  if (state.options?.length) {
    contextParts.push(`Options considered: ${state.options.map(o => o.label).join('; ')}`)
  }
  if (state.stakeholders?.length) {
    contextParts.push(`People involved: ${state.stakeholders.map(s => s.role ? `${s.name} (${s.role})` : s.name).join('; ')}`)
  }
  if (state.deadline)     contextParts.push(`Deadline: ${state.deadline}`)
  if (state.assumptions?.length) contextParts.push(`Assumptions: ${state.assumptions.join('; ')}`)
  if (state.unknowns?.length)    contextParts.push(`Open questions: ${state.unknowns.join('; ')}`)
  if (state.evidence?.length)    contextParts.push(`Evidence gathered: ${state.evidence.join('; ')}`)

  // Full transcript included last, verbatim — the ontology tagger and
  // Examiner both benefit from the raw conversation, not just the summary
  // above, and this is exactly the material lib/examiner-derive.ts checks
  // against.
  contextParts.push('---')
  contextParts.push('Conversation transcript:')
  contextParts.push(transcript.map(m => `${m.role === 'user' ? 'Person' : 'Quorum'}: ${m.content}`).join('\n'))

  return { decisionText, contextText: contextParts.join('\n\n') }
}

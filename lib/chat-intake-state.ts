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
 * before the exchange ceiling once the decision is well-formed enough,
 * without dumping every possible field on the person first.
 *
 * v2 (product feedback, Sept 2026): the previous version was a single
 * boolean (statement + options + one of {stakeholders, deadline,
 * reversibility, assumptions}) gated behind a flat "always ask at least 3
 * follow-ups" floor. Feedback was that the fixed minimum was the wrong lever
 * — a rich first message shouldn't be forced through mechanical extra
 * questions, and a sparse one shouldn't be allowed to close just because it
 * cleared a low bar. Replaced with an explicit weighted framework: each
 * dimension of a well-formed decision carries a weight (they don't matter
 * equally — knowing the actual decision and the real options matters more
 * than knowing the deadline), and the conversation is considered "complete
 * enough" once the weighted total clears COMPLETENESS_THRESHOLD (80%) —
 * "80–90% of the inputs needed to frame the decision," per the product call.
 * This same breakdown (score + which dimensions are still missing) is fed
 * back into lib/chat-intake-reply.ts's follow-up prompt, so the next
 * question always targets a real, named gap rather than working off a
 * separate hardcoded priority list that could say something different from
 * what this function is actually checking.
 */
interface CompletenessDimension {
  label: string
  weight: number
  check: (state: ChatDecisionState) => boolean
}

const COMPLETENESS_DIMENSIONS: CompletenessDimension[] = [
  { label: 'a clear decision statement',        weight: 20, check: s => !!s.decisionStatement?.trim() },
  { label: 'at least two real options',         weight: 20, check: s => (s.options?.length ?? 0) >= 2 },
  { label: 'who else is involved',              weight: 10, check: s => (s.stakeholders?.length ?? 0) > 0 },
  { label: 'whether there\u2019s a real deadline', weight: 10, check: s => !!s.deadline },
  { label: 'how reversible this is',            weight: 10, check: s => !!s.reversibility },
  { label: 'the assumptions in play',           weight: 10, check: s => (s.assumptions?.length ?? 0) > 0 },
  { label: 'what would actually change their mind', weight: 10, check: s => (s.evidence?.length ?? 0) > 0 || !!s.decisionThreshold },
  { label: 'what matters most to them here',    weight: 10, check: s => !!s.leaningOptionType || !!s.initialReaction },
]

export interface CompletenessResult {
  score:   number    // 0–100, weighted
  missing: string[]  // human-readable labels for every dimension not yet covered, in priority order
}

export function scoreCompleteness(state: ChatDecisionState): CompletenessResult {
  let score = 0
  const missing: string[] = []
  for (const d of COMPLETENESS_DIMENSIONS) {
    if (d.check(state)) score += d.weight
    else missing.push(d.label)
  }
  return { score, missing }
}

// "80–90%" per the product call — the lower bound is used so the framework
// never runs long on a decision that's already genuinely well-formed.
export const COMPLETENESS_THRESHOLD = 80

// A small safety floor, not a target: without this, an unusually complete
// single first message could close the conversation with zero follow-up
// questions at all, which felt broken in testing regardless of how the
// completeness math scored it. This only prevents that one edge case — from
// exchange 2 onward, completeness (above) is the sole real gate, so a
// decision that's still missing key pieces keeps going, and one that's
// genuinely clear doesn't get held hostage to a fixed question count.
const MIN_EXCHANGES_BEFORE_STOP = 2

export function shouldStopEarly(state: ChatDecisionState, exchangeCount: number): boolean {
  if (exchangeCount < MIN_EXCHANGES_BEFORE_STOP) return false
  return scoreCompleteness(state).score >= COMPLETENESS_THRESHOLD
}

const OPTIONS_LINE_PREFIX = 'Options considered: '

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
    contextParts.push(`${OPTIONS_LINE_PREFIX}${state.options.map(o => o.label).join('; ')}`)
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

/**
 * Reverses the "Options considered: A; B" line assembleSessionInput() above
 * writes into context_text, for screens later in the flow that want the
 * finalized option labels for continuity (item 7, product feedback: the
 * pre-Council leaning capture read as generic and disconnected from the
 * decision + options the person had just finished confirming at the
 * checkpoint). Returns [] for a classic (non-chat) session, where
 * context_text never had this line to begin with — callers should treat
 * that as "no continuity data available" and fall back to generic copy,
 * not as an error.
 */
export function parseOptionLabels(contextText: string | null | undefined): string[] {
  if (!contextText) return []
  const line = contextText.split('\n').find(l => l.startsWith(OPTIONS_LINE_PREFIX))
  if (!line) return []
  return line.slice(OPTIONS_LINE_PREFIX.length).split(';').map(s => s.trim()).filter(Boolean)
}

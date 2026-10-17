// lib/chat-intake-planner.ts
// ── Natural Intake (v7) — one call per turn: notes + next question ───────────
//
// Before v7 every turn made TWO model calls: a silent extraction
// (lib/chat-intake-state.ts) and then a separate reply writer
// (lib/chat-intake-reply.ts) that was only allowed to ask about whatever the
// fixed checklist said was missing. The two could disagree, the reply writer
// could not ask anything off-list ("which city?"), and extraction was capped at
// 500 tokens with a bare JSON.parse that silently kept the OLD state on any
// failure — so a long state could stall and the same gap got re-asked.
//
// This module is the merge: ONE call that returns
//   - the updated private notes (including the decision brief's facts),
//   - whether the person just answered the question that was pending,
//   - the single best next question and its tap-answers,
//   - a one-line playback of what Quorum has understood, and
//   - the "smart friend" check — the one thing a sharp friend would still ask.
//
// The model PROPOSES; the server DECIDES (lib/chat-intake-turn.ts). Every field
// is validated there, and the brief's slot list — not the model — is the source
// of truth for what counts as "done". Failure is safe: this returns null and
// the turn logic falls back to deterministic questions from the slot list.

import { createCompletion } from '@/lib/ai-client'
import type { ChatDecisionState, ChatIntakeMessage } from '@/lib/types'
import { rankMissing, slotCatalogForPrompt, slotSpec } from '@/lib/chat-intake-brief'
import { parsePlannerOutput } from '@/lib/chat-intake-plan-parse'
import type { PlannerOutput } from '@/lib/chat-intake-plan-parse'

export type { PlannerOutput }

// Up from 500: the notes carry forward every turn and now include facts, so a
// 500-token cap could truncate mid-JSON as the state grew.
export const PLANNER_MAX_TOKENS = 1400

export interface PlannerInput {
  state:         ChatDecisionState       // state BEFORE this turn's message (deterministic pre-steps already applied)
  transcript:    ChatIntakeMessage[]     // includes this turn's user message as the last entry
  exchangeCount: number
  ceiling:       number
  /** Background for returning users — see lib/chat-intake-memory.ts. '' for anonymous / first-time. */
  background:    string
}

// Fields of ChatDecisionState the model is allowed to read and write.
const CONTENT_KEYS = [
  'decisionStatement', 'decisionKind', 'options', 'leaningOptionType', 'stakeholders',
  'deadline', 'reversibility', 'assumptions', 'unknowns', 'evidence', 'decisionThreshold',
  'initialReaction', 'gutFeeling', 'successPicture', 'userCorrections',
  'facts', 'unknownFacts', 'naSlots',
] as const

function contentView(state: ChatDecisionState): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const k of CONTENT_KEYS) {
    const v = (state as Record<string, unknown>)[k]
    if (v !== undefined && v !== null && !(Array.isArray(v) && v.length === 0)) out[k] = v
  }
  return out
}

const PROMPT = (inp: PlannerInput): string => {
  const { state } = inp
  const pending   = state.pending
  const ranked    = rankMissing(state)
  const missing   = ranked.map(s => {
    const asked = state.askCounts?.[s.key] ?? 0
    return `${s.key} — ${s.label}${asked ? ` (already asked ${asked}x: ask it more simply or differently)` : ''}`
  })

  const pendingLine = pending && (pending.kind === 'ask' || pending.kind === 'smart_friend') && pending.slotKey
    ? `The question just asked was about "${pending.slotKey}"${slotSpec(state.decisionKind, pending.slotKey) ? ` (${slotSpec(state.decisionKind, pending.slotKey)!.label})` : ''}. The person's latest message is most likely the answer to it. Set answeredPending to true only if it actually answers that question.`
    : pending?.kind === 'playback' || pending?.kind === 'correct'
      ? 'You just played back your understanding and the person is correcting or adding to it. Update the facts to match what they said, record the correction in userCorrections, and set answeredPending to true.'
      : 'No question is pending — this is an opening or open-ended message.'

  const mode = state.walkthrough
    ? 'MODE: the person asked to be walked through it step by step. Use the simplest words, one tiny question at a time, always offer tap-answers, and never assume they have the details to hand.'
    : state.richness === 'rich'
      ? 'MODE: their first message was detailed. Fill every slot it already answers, and only ask about what is genuinely still open.'
      : state.richness === 'sparse'
        ? 'MODE: their first message was short and vague. Be concrete and easy: simple words, tap-answers wherever the answer is a choice.'
        : 'MODE: normal.'

  return `You are Quorum's intake planner. Someone is talking through a decision. After EVERY message you do four jobs in one JSON reply: update a private note, say what to ask next, summarise what you understand, and say what a sharp friend would still need. You never talk to the person outside the "question", "playback" and "smartFriendQuestion" strings.

KINDS OF DECISION and their slots (* = required). Pick the one that fits in "decisionKind":
${slotCatalogForPrompt()}

PRIVATE NOTE SO FAR (carry forward; do not drop anything just because this message didn't repeat it):
${JSON.stringify(contentView(state))}

${missing.length ? `STILL OPEN (required slots, most useful first):\n${missing.map(m => `- ${m}`).join('\n')}` : 'STILL OPEN: nothing — every required slot is covered.'}

${pendingLine}
${mode}
${inp.background ? `\nKNOWN BACKGROUND about this person from earlier (use it so they are not asked what you already know; when you rely on it, put "(from earlier)" in front of that fact so they can correct it):\n${inp.background}\n` : ''}
THIS IS EXCHANGE ${inp.exchangeCount} OF UP TO ${inp.ceiling}.

RULES FOR THE NOTE:
- "facts" maps a slot key to a SHORT phrase in the person's own words (under 140 characters), only when the conversation actually answers it. Never guess. One message can fill several slots — fill them all.
- "alternatives" counts only a real route beyond the two obvious ones (e.g. negotiate, trial it, ask for a change). Staying put and doing the thing do NOT count. If they say there is no other route, fill it with that.
- "unknownFacts": slot keys the person said they don't know or haven't worked out. "naSlots": slot keys that clearly don't apply to them (e.g. who_moves if they live alone).
- "options" are the real choices, including passive ones (stay, wait, test first) — they feed a later screen. Keep every option label under 40 characters.
- "initialReaction" is set only from the very first message and never overwritten. "gutFeeling" and "successPicture": fill only if the person volunteers them — never ask for them.
- Use the person's specifics (the city, the role, the amount) rather than generic labels.

RULES FOR THE NEXT QUESTION ("next"):
- Choose ONE slot from STILL OPEN: the one whose answer would most change the advice for THIS person. Skip a slot if the answer could not change what you'd say.
- Plain words, a human voice, under 35 words, exactly one question. Name their specifics (e.g. "Delhi" not "your city"). No therapy-speak, no jargon, and never the words Examiner, Council, ontology, checkpoint, slot or brief.
- Ask about facts and situation, not feelings or "what would success look like".
- "chips": 2–4 short tap-answers (under 28 characters each) that could each stand as a full answer, or [] if it needs free text. Never include "not sure" — the app adds it.
- For "alternatives": name one or two plausible routes they have NOT mentioned, as chips, so they can widen their thinking.
- If nothing is open, set "next" to null.

PLAYBACK ("playback"): 1–2 sentences, "Here's what I've got — …", using their concrete specifics and ending with "Did I get that right?". Mention anything you took from KNOWN BACKGROUND.

SMART FRIEND ("smartFriendQuestion"): if you had to advise this person right now, what ONE fact would you still ask for that changes your advice? One short question, or null if nothing material is missing.

If the latest message is a question about Quorum itself (privacy, pricing, how it works) rather than about their decision, set "aboutQuorum" to true and leave "next" as null.

Return ONLY this JSON object, nothing else:
{
  "notes": { "decisionStatement": string, "decisionKind": string, "options": [{"label": string, "type": "act"|"dont_act"|"wait"|"gather_info"|"experiment"}], "leaningOptionType": string, "stakeholders": [{"name": string, "role": string, "consultReason": "expertise"|"challenge"|"approval"|"affected"|"trust"}], "deadline": string, "reversibility": "reversible"|"somewhat_reversible"|"irreversible", "assumptions": [string], "unknowns": [string], "evidence": [string], "decisionThreshold": string, "initialReaction": string, "gutFeeling": string, "successPicture": string, "userCorrections": [string], "facts": { "<slot key>": string }, "unknownFacts": [string], "naSlots": [string] },
  "answeredPending": boolean,
  "aboutQuorum": boolean,
  "next": { "slotKey": string, "question": string, "chips": [string] } | null,
  "playback": string,
  "smartFriendQuestion": string | null
}
(Omit any "notes" field that has no evidence yet.)

CONVERSATION SO FAR:
${inp.transcript.map(m => `${m.role === 'user' ? 'PERSON' : 'YOU'}: ${m.content}`).join('\n')}

JSON:`.trim()
}

/**
 * One planner call. Returns null on any failure (network, empty, unparseable) —
 * the caller (lib/chat-intake-turn.ts) then falls back to the slot list so the
 * chat keeps moving instead of stalling or re-asking.
 */
export async function planTurn(inp: PlannerInput): Promise<PlannerOutput | null> {
  try {
    const raw = await createCompletion(PROMPT(inp), PLANNER_MAX_TOKENS, { provider: 'deepseek', temperature: 0.3 })
    const out = parsePlannerOutput(raw)
    if (!out) console.error('[ChatIntake] planner returned unparseable output')
    return out
  } catch (err) {
    console.error('[ChatIntake] planTurn failed:', err)
    return null
  }
}

// lib/chat-intake-reply.ts
// ── Natural Intake (v1) — the chat's own voice ────────────────────────────────
//
// Same peer register as the existing Examiner E0/S0/C0 questions (see
// app/api/examiner/route.ts's generateE0Question doc comments) — a trusted
// advisor, not an interviewer or a form. This module owns only the
// CONVERSATIONAL reply; lib/chat-intake-state.ts owns the silent structured
// extraction that runs alongside it. Two prompts, two concerns, same
// convention the Examiner route already uses for its own question
// generators.

import { createCompletion } from '@/lib/ai-client'
import type { ChatDecisionState, ChatIntakeMessage } from '@/lib/types'

// Locked copy (docs/COPY_AND_STRUCTURE_LOCK_v1.md) — fixed string, no AI
// call needed for turn one.
export const OPENING_LINE = "What's going on? Don't worry about structuring it — just tell me."

const FOLLOW_UP_PROMPT = (
  state:         ChatDecisionState,
  transcript:    ChatIntakeMessage[],
  exchangeCount: number,
  maxExchanges:  number,
  closingTurn:   boolean,
) => `You are Quorum, a sharp, warm thinking partner helping someone talk through a real decision — closer to a trusted colleague than a chatbot or a form. Write ONE short reply to what they just said.

VOICE:
- Plain, direct, human. No therapy-speak, no "I understand that must be difficult." No bullet points.
- One idea per message. Under 30 words unless a brief reflection genuinely needs more.
- Never say "Examiner," "Council," "structural read," "ontology," or any internal product/engineering term.
- Ask at most one question. Every question must earn its place — don't ask something you could reasonably infer or that doesn't change what happens next.

WHAT YOU ALREADY KNOW ABOUT THIS DECISION (do not re-ask anything already covered here):
${JSON.stringify(state)}

THIS IS EXCHANGE ${exchangeCount} OF UP TO ${maxExchanges}.

${closingTurn
  ? `This is the LAST turn before you reflect the decision back to them. Do not ask a new question. Write one short line that closes the conversation naturally and signals you're about to sum up what you've heard — e.g. something like "Okay — I think I've got a clear picture. Let me reflect it back to you."`
  : `Guidance for what's most useful to surface next, in rough priority order, but only if it's a genuine gap and only ever ONE thing:
1. If the actual decision is still unclear or seems to be two decisions tangled together, gently name that.
2. If no real options are named yet — including passive ones like waiting, doing nothing, or testing something small first — invite those.
3. If a named stakeholder hasn't been explored, ask what's actually driving the need to involve them (expertise, wanting to be challenged, needing their approval, they're affected, or you just trust their read) — only if it would change what happens next, not as a checklist item.
4. If nothing about what would actually change their mind has come up, ask what evidence or information would move it.
5. Otherwise, deepen whatever thread is most alive in what they just said.
Do not ask about all five — pick the single most useful thing right now.`}

CONVERSATION SO FAR:
${transcript.map(m => `${m.role === 'user' ? 'PERSON' : 'YOU'}: ${m.content}`).join('\n')}

YOUR REPLY (just the message text, nothing else):`.trim()

export async function generateFollowUpReply(
  state:         ChatDecisionState,
  transcript:    ChatIntakeMessage[],
  exchangeCount: number,
  maxExchanges:  number,
  closingTurn:   boolean,
): Promise<string> {
  try {
    const raw = await createCompletion(
      FOLLOW_UP_PROMPT(state, transcript, exchangeCount, maxExchanges, closingTurn),
      120,
      { provider: 'deepseek', temperature: 0.6 },
    )
    return raw.trim().replace(/^"|"$/g, '')
  } catch (err) {
    console.error('[ChatIntake] generateFollowUpReply failed:', err)
    return closingTurn
      ? "Okay — I think I've got enough. Let me reflect back what I'm hearing."
      : 'Tell me a bit more about what\'s making this hard to call.'
  }
}

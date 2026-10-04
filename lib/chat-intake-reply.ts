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
import { faqReferenceText } from '@/lib/faq-content'
import { isUnifiedSessionEnabled } from '@/lib/feature-flags'

// Warm welcome + positioning (product call, Sept 2026): the previous opening
// line — "What's going on? Don't worry about structuring it — just tell
// me." — is still the right *prompt*, but on its own it reads as a bare
// chatbot with no signal of what Quorum actually is or does next. Devil's-
// advocate feedback on the chat-first entry screen was specifically that a
// stranger's first reaction is "isn't this just ChatGPT?" — this message is
// the fix: a brief, plain-language positioning (mirror / compounding
// judgment, not "an AI advisor"), what happens with what they type (Quorum
// helps find the real decision, not just answers the stated one), that
// Council is available for the decisions worth it, and that Quorum will
// even take a guess at their choice before they see it (the Prediction
// flow) — all in one short paragraph, not a feature list. ChatIntake.tsx's
// hero screen shows its own short, separate headline copy ("What's going
// on?") rather than this whole paragraph as a giant heading — this is the
// literal first chat message, read as a message, not as marketing type.
// Oct 2026 copy trim: dropped the "Tell me what's going on, in your own words"
// sentence — the hero headline and the closing question already say it — so
// this reads as positioning + one question, matching the shorter hero copy.
export const OPENING_LINE = "Hey, I'm Quorum \u2014 less an AI advisor, more a mirror that gets sharper about your judgment the more we work through together. I'll help you find the real decision underneath, bring in the full Council if it's a big one, and even guess what you'll choose before you see it. So \u2014 what's going on?"

// Compact reference block the follow-up prompt below can ground FAQ-type
// answers in — computed once per module load (FAQS itself is a static
// array), not per request.
const FAQ_REFERENCE = faqReferenceText()

// v4 — "how they feel" and "what a good outcome looks like" are the chat's
// versions of the Examiner's E0 and C0 questions (see lib/chat-intake-state.ts's
// COMPLETENESS_DIMENSIONS). They need a specific way of being asked, or they
// come out as interview questions. 'What matters most' is deliberately NOT
// asked in chat any more — the end-of-chat priority chip captures it.
const FEELING_LABEL = 'how they feel about it'
const SUCCESS_LABEL = 'what a good outcome looks like'
const PRIORITY_LABEL = 'what matters most to them here'

const FEELING_HINT_BLOCK = (missing: string[]): string => {
  const parts: string[] = []
  if (missing.includes(FEELING_LABEL)) {
    parts.push(`If you ask about how they feel, make it a gut check in plain words — something like "When you picture actually doing it, what's the first feeling that comes up?" — not a request to analyze their emotions.`)
  }
  if (missing.includes(SUCCESS_LABEL)) {
    parts.push(`If you ask about what a good outcome looks like, anchor it in the future in their terms — something like "A year from now, what would make you glad you chose this?"`)
  }
  return parts.length ? `\n${parts.join('\n')}` : ''
}

// Closing-turn copy depends on what the screen under the message will show:
// with the unified session flag on it's the two lean / priority chips; with
// it off it's the old reflect-the-decision-back step (no chips exist then).
const CLOSING_INSTRUCTION = (): string => isUnifiedSessionEnabled()
  ? `This is the LAST turn of the conversation. Do not ask a new question. Write one short line that closes the conversation naturally and tells them what happens next: they'll tap two quick answers right below your message (where they're leaning, and what matters most to them here), and then you'll show them what you think they'll choose. Keep it to a few words, not a list — e.g. something like "Okay — I think I've got a clear picture. Two quick taps below, then I'll show you what I think you'll choose." Never use the words "checkpoint," "session," "Council," or "Examiner."`
  : `This is the LAST turn before you reflect the decision back to them. Do not ask a new question. Write one short line that closes the conversation naturally, signals you're about to sum up what you've heard, AND briefly previews what happens next — that they'll see the decision reflected back, then can choose to bring in the full Council if it's worth it. Keep the preview to a few words, not a list. Never use the words "checkpoint," "session," or "Examiner."`

const CLOSING_FALLBACK = (): string => isUnifiedSessionEnabled()
  ? "Okay — I think I've got a clear picture. Two quick taps below, then I'll show you what I think you'll choose."
  : "Okay — I think I've got enough. Let me reflect it back, and then you can decide if this is worth bringing the full Council into."

const FOLLOW_UP_PROMPT = (
  state:             ChatDecisionState,
  transcript:        ChatIntakeMessage[],
  exchangeCount:     number,
  maxExchanges:      number,
  closingTurn:       boolean,
  missingDimensions: string[],
) => `You are Quorum, a sharp, warm thinking partner helping someone talk through a real decision — closer to a trusted colleague than a chatbot or a form. Write ONE short reply to what they just said.

VOICE:
- Plain, direct, human. No therapy-speak, no "I understand that must be difficult." No bullet points.
- One idea per message. Under 30 words unless a brief reflection genuinely needs more.
- Never say "Examiner," "Council," "structural read," "ontology," or any internal product/engineering term.
- Ask at most one question. Every question must earn its place — don't ask something you could reasonably infer or that doesn't change what happens next.

IF THEY ASK ABOUT QUORUM ITSELF (not their own decision) — e.g. privacy, pricing, "is this just a chatbot," how the Council works, what happens after this chat — answer briefly and accurately using this reference, then return to their decision with a short line (don't just end on the FAQ answer with nothing else):
${FAQ_REFERENCE}
If something isn't covered by this reference or by what you already know about Quorum, say so plainly rather than guessing — don't invent product details, pricing, or mechanics that aren't in this reference.

WHAT YOU ALREADY KNOW ABOUT THIS DECISION (do not re-ask anything already covered here):
${JSON.stringify(state)}

THIS IS EXCHANGE ${exchangeCount} OF UP TO ${maxExchanges}.

${closingTurn
  ? CLOSING_INSTRUCTION()
  : missingDimensions.length
    ? `Here is what's still genuinely missing from this decision, in priority order: ${missingDimensions.join(' \u00b7 ')}.
Pick ONLY the single most useful one of these to surface right now — never more than one, and never something not on this list. If the top item doesn't fit naturally given what they just said, use judgment and pick whichever one on the list does.${FEELING_HINT_BLOCK(missingDimensions)}`
    : `The decision already covers everything on the usual checklist. Don't force a new structural question — instead, deepen whatever thread is most alive in what they just said, or gently reflect something back that might sharpen their own thinking.`}

CONVERSATION SO FAR:
${transcript.map(m => `${m.role === 'user' ? 'PERSON' : 'YOU'}: ${m.content}`).join('\n')}

YOUR REPLY (just the message text, nothing else):`.trim()

export async function generateFollowUpReply(
  state:             ChatDecisionState,
  transcript:        ChatIntakeMessage[],
  exchangeCount:     number,
  maxExchanges:      number,
  closingTurn:       boolean,
  allMissing:        string[] = [],
): Promise<string> {
  // The priority chip captures this one, so the chat never asks it.
  const missingDimensions = allMissing.filter(l => l !== PRIORITY_LABEL)
  try {
    const raw = await createCompletion(
      FOLLOW_UP_PROMPT(state, transcript, exchangeCount, maxExchanges, closingTurn, missingDimensions),
      160,
      { provider: 'deepseek', temperature: 0.6 },
    )
    return raw.trim().replace(/^"|"$/g, '')
  } catch (err) {
    console.error('[ChatIntake] generateFollowUpReply failed:', err)
    return closingTurn
      ? CLOSING_FALLBACK()
      : 'Tell me a bit more about what\'s making this hard to call.'
  }
}

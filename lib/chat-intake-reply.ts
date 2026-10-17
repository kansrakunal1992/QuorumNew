// lib/chat-intake-reply.ts
// ── Natural Intake (v1) — the chat's own voice ────────────────────────────────
//
// v7: this module no longer writes the per-turn follow-up question. That moved
// into the merged planner (lib/chat-intake-planner.ts), which extracts, judges
// readiness and writes the next question in one call, driven by the decision
// brief (lib/chat-intake-brief.ts) instead of a generic checklist. What stays
// here: the fixed opening line, the fixed closing line, and the one reply the
// planner can't write — an honest answer when the person asks about Quorum
// itself (privacy, pricing, how the Council works) in the middle of a chat.

import { createCompletion } from '@/lib/ai-client'
import type { ChatIntakeMessage } from '@/lib/types'
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

// Compact reference block the answer prompt below grounds in — computed once
// per module load (FAQS itself is a static array), not per request.
const FAQ_REFERENCE = faqReferenceText()

// Closing-turn copy depends on what the screen under the message will show:
// with the unified session flag on it's the two lean / priority chips; with
// it off it's the old reflect-the-decision-back step (no chips exist then).
// v7: fixed strings, no model call — the playback ("here's what I heard") is
// what the person just confirmed, so the closing line only has to hand off.
export const closingLine = (): string => isUnifiedSessionEnabled()
  ? "Okay \u2014 I think I've got a clear picture. Two quick taps below, then I'll show you what I think you'll choose."
  : "Okay \u2014 I think I've got enough. Let me reflect it back, and then you can decide if this is worth bringing the full Council into."

const ABOUT_QUORUM_PROMPT = (
  transcript: ChatIntakeMessage[],
) => `You are Quorum, a sharp, warm thinking partner. The person just asked something about Quorum itself (privacy, pricing, "is this just a chatbot", how the Council works, what happens after this chat) rather than about their own decision.

Answer briefly and accurately using ONLY this reference, then return to what you were asking with one short line (do not just end on the answer):
${FAQ_REFERENCE}
If something isn't covered by this reference, say so plainly rather than guessing \u2014 never invent product details, pricing or mechanics.

VOICE: plain, direct, human. No bullet points. Under 60 words in total. Never say "Examiner", "ontology", "structural read" or any internal term.

CONVERSATION SO FAR:
${transcript.map(m => `${m.role === 'user' ? 'PERSON' : 'YOU'}: ${m.content}`).join('\n')}

YOUR REPLY (just the message text, nothing else):`.trim()

export async function generateAboutQuorumReply(transcript: ChatIntakeMessage[]): Promise<string> {
  try {
    const raw = await createCompletion(ABOUT_QUORUM_PROMPT(transcript), 220, { provider: 'deepseek', temperature: 0.5 })
    return raw.trim().replace(/^"|"$/g, '')
  } catch (err) {
    console.error('[ChatIntake] generateAboutQuorumReply failed:', err)
    return "Good question \u2014 the FAQ at the top of the screen covers that. Meanwhile, I'd like to stay with your decision."
  }
}

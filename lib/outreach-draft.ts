import 'server-only'

// lib/outreach-draft.ts
// ── Stakeholder outreach drafting (Phase 2, v2) ───────────────────────────────
//
// One drafting function for every channel — Slack, Teams, email, WhatsApp,
// or "just going to copy this." The channel changes tone slightly (an email
// gets a greeting/sign-off; a Slack/Teams message doesn't) but not the
// underlying ask, which is always the same: state what's being decided,
// name the specific thing this person's view would help with, ask a real
// question. See plan section 12's own example: "What's the strongest reason
// you think we should hire now, and what evidence would change your mind?"
// — specific, answerable, not "thoughts?"

import { createCompletion } from '@/lib/ai-client'
import type { DecisionOptionType } from '@/lib/types'

export type OutreachChannel = 'slack' | 'teams' | 'email' | 'whatsapp' | 'manual'
type ConsultReason = 'expertise' | 'challenge' | 'approval' | 'affected' | 'trust' | null | undefined

const REASON_HINT: Record<string, string> = {
  expertise: 'You are asking because of their specific expertise — ask the question only they could answer well.',
  challenge: 'You are asking because you want them to push back — invite disagreement explicitly, do not soften the ask.',
  approval:  "You are asking because you need their sign-off — be direct about that being the ask, don't bury it.",
  affected:  'This person is affected by the outcome — ask what matters to them about it, not just what they think you should do.',
  trust:     "You're asking because you trust their read — ask for their honest gut reaction, not a formal analysis.",
}

const DRAFT_PROMPT = (
  decisionText:     string,
  stakeholderName:  string,
  consultReason:    ConsultReason,
  channel:          OutreachChannel,
  userInstruction:  string | null,
) => `Draft a short message asking ${stakeholderName} for their input on a decision.

THE DECISION:
${decisionText.slice(0, 1000)}

${consultReason ? REASON_HINT[consultReason] ?? '' : ''}
${userInstruction ? `The person sending this specifically wants to say: ${userInstruction}` : ''}

RULES:
- Ask ONE specific, answerable question — never a vague "thoughts?" or "what do you think?"
- ${channel === 'email' ? 'Include a brief greeting and sign-off appropriate for a short work email. No subject line — just the body.' : 'No greeting or sign-off needed — write it the way a person actually messages a colleague on Slack or Teams: direct, brief.'}
- Under 60 words.
- Write it as if the sender wrote it themselves — first person, natural, not corporate-sounding.
- Do not mention "Quorum," "the Council," or any AI/tool involvement — this message is from the sender, about their own decision.

Return ONLY the message text, nothing else — no quotation marks, no preamble.`.trim()

export async function draftOutreachMessage(
  decisionText:    string,
  stakeholderName: string,
  consultReason:   ConsultReason,
  channel:         OutreachChannel,
  userInstruction?: string,
): Promise<string> {
  try {
    const raw = await createCompletion(
      DRAFT_PROMPT(decisionText, stakeholderName, consultReason, channel, userInstruction ?? null),
      160,
      { provider: 'deepseek', temperature: 0.65 },
    )
    return raw.trim().replace(/^"|"$/g, '')
  } catch (err) {
    console.error('[OutreachDraft] failed:', err)
    return `Hey ${stakeholderName} — I'm working through a decision and would really value your take. Got a few minutes to weigh in?`
  }
}

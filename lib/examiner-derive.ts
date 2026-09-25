// lib/examiner-derive.ts
// ── Natural Intake (v1) — Examiner derive-and-confirm ─────────────────────────
//
// Answers the caveat: "ask only the gaps" cannot mean "skip the row if the
// chat sort of covered it" — three engines (lib/bias-scorer.ts's C0 pull,
// lib/independence-score.ts, lib/contradiction-detector.ts) read saved
// examiner_responses rows by exact rule_id, not "was this topic discussed
// somewhere." So this module never causes a question to be silently
// dropped. It only decides whether the user has to type the answer again or
// can confirm one already extracted from the chat with a single tap — either
// way, a normal examiner_responses row gets written under the correct
// rule_id (see app/api/examiner/route.ts's POST, which now accepts an
// optional derived_from_chat flag on each response row).
//
// Scope: only called for sessions where intake_mode === 'chat' AND
// NEXT_PUBLIC_NATURAL_INTAKE_ENABLED is on (checked by the caller in
// app/api/examiner/route.ts). A classic-flow session never reaches this
// file. REDIRECT-mode questions (R1/R7) are also never checked here — those
// already have their own grounding safeguards (hasUngroundedSpecifics in
// app/api/examiner/route.ts) and are conservative-by-design hard blocks;
// this module only applies to the three always-fire/rule slots (E0, S0-or-
// rule, C0).
//
// Fails closed: any error, empty result, or ambiguous model output returns
// covered: false, so the question is asked directly exactly as it is today.
// Missing a shortcut costs the user one extra tap. Wrongly skipping costs a
// downstream engine its input silently — so ties go to asking.

import { createCompletion } from '@/lib/ai-client'

export interface DeriveCheckResult {
  covered:       boolean
  derivedAnswer: string | null
}

const DERIVE_PROMPT = (questionText: string, chatContext: string) => `You are checking whether a specific question has already been directly answered somewhere in a conversation — not just whether the general topic came up.

QUESTION TO CHECK: "${questionText}"

RULES:
- Only say it's covered if the person's own words in the conversation directly answer THIS specific question's intent — not a related or adjacent topic.
- If it's genuinely ambiguous, or only partially covered, say it is NOT covered. When in doubt, say NOT covered.
- If covered, extract the answer using the person's own words as closely as possible — a real paraphrase of what they actually said, not a generic restatement. This will be saved as their answer to the question, exactly as if they had typed it.
- Return ONLY a JSON object: { "covered": true|false, "derivedAnswer": string|null }
- derivedAnswer must be null when covered is false.

CONVERSATION:
${chatContext.slice(0, 6000)}

JSON:`.trim()

export async function checkChatCoverage(
  questionText: string,
  chatContext:  string,
): Promise<DeriveCheckResult> {
  if (!chatContext?.trim()) return { covered: false, derivedAnswer: null }

  try {
    const raw    = await createCompletion(DERIVE_PROMPT(questionText, chatContext), 300, { provider: 'deepseek' })
    const clean  = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim()
    const parsed = JSON.parse(clean) as { covered?: boolean; derivedAnswer?: string | null }

    if (parsed?.covered === true && parsed.derivedAnswer?.trim()) {
      return { covered: true, derivedAnswer: parsed.derivedAnswer.trim() }
    }
    return { covered: false, derivedAnswer: null }
  } catch (err) {
    console.error('[ExaminerDerive] checkChatCoverage failed — asking directly:', err)
    return { covered: false, derivedAnswer: null }
  }
}

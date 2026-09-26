// lib/chat-intake-insight.ts
// ── Natural Intake (v1) — checkpoint "reward" / Council incentive ──────────
//
// Product feedback (Sept 2026): the examine-phase bottom card showed only
// two bare buttons ("Convene the Council" / "I'm done") with no substance —
// no reward for finishing the chat, and no real incentive to click Convene.
// This module is the fix's AI half (the structural-read half is built
// straight from ChatDecisionState client-side in DecisionCheckpoint.tsx,
// no model call needed since that data is already sitting in state).
//
// Deliberately ONE call that both classifies and responds, rather than a
// classify call followed by a second response call — half the latency and
// cost, and the classification is never shown on its own, only used to
// choose which kind of message to write.
//
// Explicit product decision: for a genuinely low-stakes decision, this
// should behave like a small amount of real help (an honest verdict + a
// next step), not a teaser for a feature the person may not need. For a
// high-stakes one, it should NOT venture a verdict — a fast take on a
// consequential, irreversible call is exactly the wrong move — and instead
// name the specific reason (grounded in their actual situation, not a
// generic "big decisions deserve scrutiny" line) that multiple structured
// perspectives would actually help, which is what earns the click into
// Council rather than a generic feature description.

import { createCompletion } from '@/lib/ai-client'
import type { ChatDecisionState } from '@/lib/types'

export interface CheckpointInsight {
  stakesLevel: 'low' | 'high'
  message:     string
}

const INSIGHT_PROMPT = (state: ChatDecisionState) => `You are Quorum. Someone has just finished talking through a decision with you. Decide how much this decision actually needs deliberate, multi-perspective scrutiny versus a fast, honest take — then write the appropriate short message.

DECISION STATE:
${JSON.stringify(state)}

CLASSIFY stakesLevel:
- "low": everyday, low-consequence, comfortably reversible, no complex stakeholder dynamics, no real internal conflict between what they want and what's stopping them.
- "high": meaningfully consequential, hard or impossible to reverse, genuine tradeoffs, multiple people significantly affected, or real tension between competing things they care about.

IF "low": write a short, honest, SPECIFIC verdict. Actually take a position on which option looks stronger given what you know, and name one concrete next step. Do not hedge, do not just restate their options back to them, do not say "it depends." Under 55 words.

IF "high": do NOT give a verdict — a fast take on something this consequential would be the wrong move. Instead, in under 40 words, name the ONE specific thing about THIS decision (not decisions in general) that a single quick read is likely to miss, and that multiple structured perspectives would actually catch. Ground it in a real detail from the state above, not a generic statement about high-stakes decisions.

Never use the words "Council," "Examiner," "structural read," "ontology," or "checkpoint" in the message text itself — the surrounding screen names Council; you're writing only the reasoning/verdict content.

Return ONLY a JSON object, nothing else:
{ "stakesLevel": "low" | "high", "message": string }`.trim()

const FALLBACK: CheckpointInsight = {
  stakesLevel: 'high',
  message: 'There\u2019s enough here — competing considerations, real stakes — that a second, more structured look tends to catch something a single quick read would miss.',
}

export async function generateCheckpointInsight(state: ChatDecisionState): Promise<CheckpointInsight> {
  try {
    const raw   = await createCompletion(INSIGHT_PROMPT(state), 220, { provider: 'deepseek', temperature: 0.6 })
    const clean = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim()
    const parsed = JSON.parse(clean)
    if (
      parsed && typeof parsed === 'object' &&
      (parsed.stakesLevel === 'low' || parsed.stakesLevel === 'high') &&
      typeof parsed.message === 'string' && parsed.message.trim()
    ) {
      return { stakesLevel: parsed.stakesLevel, message: parsed.message.trim() }
    }
    return FALLBACK
  } catch (err) {
    console.error('[ChatIntake] generateCheckpointInsight failed:', err)
    return FALLBACK
  }
}

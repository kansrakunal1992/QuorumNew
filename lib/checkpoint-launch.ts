// lib/checkpoint-launch.ts
// ── Confirm → Council hand-off rules (pure, no React, no network) ────────────
//
// v10 removed the separate "quick check" and "before the Council weighs in" screens from the normal path. What is
// left is a small set of rules about the Examiner's questions, kept here so they can be unit-tested and cannot
// drift from what the screen does:
//
//   • Only a CRITICAL question (one the Council cannot run without) is ever put in front of the person. R1/R7 are
//     excluded: those are redirect blocks with their own override on the session page.
//   • Every other question is recorded without a screen. If the chat already answered it, it is recorded as
//     "from chat" (derived_from_chat = true, which the scoring engines ignore); otherwise it is recorded blank —
//     exactly what tapping Continue with an empty box did before — and the Council is told it is unresolved.
//   • A critical question that the chat already answered is shown once for a one-tap "did I get this right?".

export type Criticality = 'critical' | 'important' | 'optional'

export interface CheckpointQuestion {
  order:          number
  text:           string
  gap:            string
  rule_id:        string | null
  criticality:    Criticality
  derived?:       boolean
  derivedAnswer?: string | null
}

export interface ExaminerRow {
  question_text:       string
  response_text:       string | null
  question_order:      number
  unknown_unknown_gap: string
  rule_id:             string | null
  criticality:         Criticality
  derived_from_chat:   boolean
}

type Flags = Record<number, boolean>
type Texts = Record<number, string>

/** Questions the Council cannot run without (lib/readiness.ts: only 'critical' ones produce NOT_READY). */
export function isCouncilCritical(q: CheckpointQuestion): boolean {
  return q.criticality === 'critical' && q.rule_id !== 'R1' && q.rule_id !== 'R7'
}

/** True when the chat already supplied a usable answer for this question. */
export function hasDerivedAnswer(q: CheckpointQuestion): boolean {
  return !!q.derived && !!(q.derivedAnswer ?? '').trim()
}

/** The only questions the person is ever shown before the Council: the critical ones. */
export function questionsToAsk(qs: CheckpointQuestion[]): CheckpointQuestion[] {
  return qs.filter(isCouncilCritical)
}

/** Does the person need to see a screen at all before the Council can start? */
export function needsCheck(qs: CheckpointQuestion[]): boolean {
  return questionsToAsk(qs).length > 0
}

/**
 * Chat-covered answers to NON-critical questions, recorded as "from chat" without a screen.
 * (Critical ones are never auto-confirmed — they get the one-tap check.)
 */
export function autoConfirmed(qs: CheckpointQuestion[]): Flags {
  const out: Flags = {}
  for (const q of qs) if (!isCouncilCritical(q) && hasDerivedAnswer(q)) out[q.order] = true
  return out
}

/** Resolved = the person confirmed a chat-derived answer, or typed one. */
export function isResolved(q: CheckpointQuestion, confirmed: Flags, answers: Texts): boolean {
  return (!!q.derived && !!confirmed[q.order]) || !!answers[q.order]?.trim()
}

/** Critical questions still unanswered — the Council would hit its "not ready" wall on these. */
export function blockingQuestions(qs: CheckpointQuestion[], confirmed: Flags, answers: Texts): CheckpointQuestion[] {
  return qs.filter(q => isCouncilCritical(q) && !isResolved(q, confirmed, answers))
}

/** The rows POSTed to /api/examiner: one per question, in the same shape the old quick-check screen sent. */
export function buildExaminerRows(qs: CheckpointQuestion[], confirmed: Flags, answers: Texts): ExaminerRow[] {
  return qs.map(q => {
    const fromChat = !!(q.derived && confirmed[q.order])
    return {
      question_text:       q.text,
      response_text:       fromChat ? (q.derivedAnswer ?? null) : (answers[q.order]?.trim() || null),
      question_order:      q.order,
      unknown_unknown_gap: q.gap,
      rule_id:             q.rule_id,
      criticality:         q.criticality,
      derived_from_chat:   fromChat,
    }
  })
}

/**
 * QUORUM — Readiness Gate (PR3)
 *
 * Decision-architecture review (Nancy/Seejo feedback, code audit, Aug 2026).
 * This is the deterministic answer to: "if Quorum itself knows it needs an
 * answer, why does it comfortably give a verdict anyway?"
 *
 * Deliberately a pure, synchronous, no-I/O function — same convention as
 * lib/rule-engine.ts's evaluateRules(), for the same reason: it needs to be
 * unit-testable against fixtures without a network call, and it needs to be
 * safely callable from BOTH a client component (SessionView.tsx, to decide
 * whether to let synthesis fire) and a server route (app/api/persona/route.ts,
 * to build the "unresolved important questions" block passed into
 * buildCouncilContext) against the same DB truth, without duplicating logic.
 *
 * WHAT THIS DOES NOT DO, ON PURPOSE:
 *   - It does not touch R1/R7 REDIRECT — that's a separate, already-working
 *     hard block (SessionView.tsx's mode==='REDIRECT' path). This only
 *     covers the gap the audit found: GATE-tier and enrichment-tier
 *     questions that were previously never enforced at all.
 *   - It does not block on every unresolved question. Only 'critical'
 *     questions (currently: R2, R3 — see app/api/examiner/route.ts's
 *     CRITICAL_RULE_IDS) can produce NOT_READY. The team already learned,
 *     the hard way, that over-blocking is its own failure mode (see
 *     lib/examiner-resolvability-check.ts's doc comment on the R7 fix) —
 *     this gate is intentionally narrow rather than "any open question
 *     blocks," which would just move Seejo's complaint to Nancy's decision.
 */

export type Readiness = 'NOT_READY' | 'READY_WITH_CAVEATS' | 'READY'

export interface ExaminerResponseForReadiness {
  question_text: string
  response_text: string | null
  criticality?:  'critical' | 'important' | 'optional' | null
}

export interface ReadinessResult {
  readiness:            Readiness
  unresolvedCritical:   ExaminerResponseForReadiness[]
  unresolvedImportant:  ExaminerResponseForReadiness[]
}

function isUnresolved(r: ExaminerResponseForReadiness): boolean {
  return !r.response_text?.trim()
}

export function computeReadiness(
  responses: ExaminerResponseForReadiness[],
): ReadinessResult {
  const unresolvedCritical  = responses.filter(r => r.criticality === 'critical'  && isUnresolved(r))
  const unresolvedImportant = responses.filter(r => r.criticality === 'important' && isUnresolved(r))

  const readiness: Readiness =
    unresolvedCritical.length  > 0 ? 'NOT_READY' :
    unresolvedImportant.length > 0 ? 'READY_WITH_CAVEATS' :
    'READY'

  return { readiness, unresolvedCritical, unresolvedImportant }
}

/**
 * Formats unresolved 'important' questions into the plain-text lines
 * buildCouncilContext() (lib/rule-engine.ts) appends to Council context —
 * used so synthesis can carry the open item forward explicitly instead of
 * silently proceeding as if nothing was left unanswered.
 */
export function formatUnresolvedForCouncil(
  unresolvedImportant: ExaminerResponseForReadiness[],
): string[] {
  return unresolvedImportant.map(r => r.question_text)
}

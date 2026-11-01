// lib/convene-gate.ts
// -- v14: sign in before the Council runs -----------------------------------------------------------------------
// The Council is the product, and every follow-up (review-date reminder, 30-day check-in, the Mirror, history on a
// new device) needs to know who the person is. Until now ~46% of decisions had no identity at all. This gate asks
// for sign-in at the moment of highest intent: after the chat and the confirm screen, immediately before the Council
// would start. It is NOT asked before the person has typed anything.
//
// ON by default. Kill switch: set NEXT_PUBLIC_CONVENE_GATE=off (also accepts 0 / false / disabled) and redeploy.
//
// The gate only applies to a session whose Council has never run. Anything already run, locked or completed opens
// exactly as before, so nobody is ever locked out of an existing record.

export const CONVENE_GATE_STAGE = 'convene_gate'

export function isConveneGateEnabled(value: string | undefined | null = process.env.NEXT_PUBLIC_CONVENE_GATE): boolean {
  const v = (value ?? '').trim().toLowerCase()
  return !(v === 'off' || v === '0' || v === 'false' || v === 'disabled' || v === 'no')
}

export interface GateSessionFacts {
  /** assistant messages that belong to an advisor / synthesis (i.e. the Council has produced output) */
  councilMessageCount: number
  status: string | null | undefined
  finalDecisionLockedAt: string | null | undefined
  examinerSubmitted: boolean
}

/** True when this session is waiting for the Council to start (so a sign-in can still be asked for first). */
export function isCouncilNotYetRun(f: GateSessionFacts): boolean {
  if (f.councilMessageCount > 0) return false
  if (f.status === 'completed') return false
  if (f.finalDecisionLockedAt) return false
  if (f.examinerSubmitted) return false
  return true
}

export function isGateCandidate(enabled: boolean, f: GateSessionFacts): boolean {
  return enabled && isCouncilNotYetRun(f)
}

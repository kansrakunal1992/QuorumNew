// lib/council-gates.ts
//
// When may the six advisors FETCH, and when may the Council be REVEALED?
//
// Before: one expression — advisors fetched only after the Examiner was done AND the Opening Ceremony was cleared AND
// "Quorum's Read" was dismissed (sessions 1-3), so the Council sat idle while the person read the hypothesis.
//
// Early start (NEXT_PUBLIC_EARLY_COUNCIL_START): fetch and reveal are separated. Advisors may fetch as soon as the
// Examiner is done; the reveal (cards fading in, the tension interstitial that shows advisor leans, and synthesis)
// still waits for both gates, so the person sees Quorum's hypothesis BEFORE any advisor — the ordering the gates exist
// to protect. Flag off: identical to the old single expression.

export interface CouncilGateInput {
  earlyStart:          boolean
  examinerSubmitted:   boolean
  notReadyBlocked:     boolean
  ceremonyGateOpen:    boolean
  quorumReadGateOpen:  boolean
}

export interface CouncilGates {
  /** Advisors may start their /api/persona fetch. (DB-hydrated cards bypass this, per card.) */
  canStream:       boolean
  /** Advisor content, the tension interstitial and synthesis may become visible / start. */
  councilRevealed: boolean
}

export function councilGates(i: CouncilGateInput): CouncilGates {
  const gatesOpen = i.ceremonyGateOpen && i.quorumReadGateOpen
  return {
    canStream:       i.examinerSubmitted && !i.notReadyBlocked && (i.earlyStart || gatesOpen),
    councilRevealed: !i.earlyStart || gatesOpen,
  }
}

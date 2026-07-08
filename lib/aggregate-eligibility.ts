// lib/aggregate-eligibility.ts
// Institutional Sprint 2 (task 4) — stub contract for "is this membership's
// data eligible for aggregation right now."
//
// Sprint 4 replaces the body of isAggregationEligible() with a real query
// against the floor-protected aggregate view (K_FLOOR check included there,
// not here). The *contract* — given a membership's current consent state,
// return whether it counts toward aggregation — stays the same, which is
// what the Sprint 2 hard-invariant test binds against now, and what Sprint
// 4's test re-verifies against the real view.

export interface MembershipConsentState {
  consent_aggregate: boolean
}

export function isAggregationEligible(membership: MembershipConsentState): boolean {
  return membership.consent_aggregate === true
}

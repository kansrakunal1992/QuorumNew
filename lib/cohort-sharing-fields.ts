// lib/cohort-sharing-fields.ts
// Institutional Sprint 2 (task 5) — defines exactly which fields are
// "insight-level" and shareable between two mutually consent_shared_cohort
// members. Cohort tables and the actual sharing query come in Sprint 3;
// this file is the single source of truth for the whitelist so Sprint 3
// imports it rather than re-deciding it.

export const COHORT_SHARED_FIELDS = [
  'session_score',
  'calibration_delta',
  'bias_parameter',
] as const

export type CohortSharedField = typeof COHORT_SHARED_FIELDS[number]

// Deliberately NOT included, and why — read before adding anything here:
//
//   - decision_text / context_text / response_text: raw per-decision
//     content. Never shareable under any consent tier, cohort or otherwise.
//
//   - bias_library.activation_contexts (jsonb): per schema comment this
//     stores "{decision_type: [...], pressure: [...], etc}" — likely
//     decision-specific, not just a parameter label. Needs a content audit
//     (confirm it never carries free text tied to a specific decision)
//     before it's added here. Flagged as a Sprint 3 pre-req, not silently
//     included.

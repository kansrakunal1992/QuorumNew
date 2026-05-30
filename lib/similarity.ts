// lib/similarity.ts
// ── Additional Risk C fix: canonical dimension weight config ──────────────────
//
// PROBLEM FIXED:
//   Before this file, DIM_WEIGHTS were defined locally in structural-retrieval.ts
//   and not used at all in benchmark/route.ts. The two similarity calculations
//   were therefore mathematically inconsistent:
//
//   structural-retrieval.ts  → score × confidence × dim_weight  (within-user)
//   benchmark/route.ts       → score only                        (cross-user)
//
//   A decision could show HIGH structural similarity in personal retrieval and
//   MODERATE in the peer benchmark (or vice versa) with no architectural reason
//   for the difference. Both used SIMILARITY_THRESHOLD = 0.808 against different
//   effective distributions.
//
// WHAT THIS FILE DOES:
//   Exports DIM_WEIGHTS as the single source of truth. Both structural-retrieval.ts
//   and benchmark/route.ts import from here, ensuring consistent dimension
//   weighting across all similarity computations in the system.
//
// WHY THE FORMULAS STAY DIFFERENT (intentional, documented in handover):
//   structural-retrieval.ts uses score × confidence × dim_weight.
//   benchmark/route.ts uses score × dim_weight (no confidence term).
//
//   Confidence is a per-session, per-user tagger signal reflecting how certain
//   the ontology model was about each dimension classification. It is valid as
//   a within-user multiplier (your own past sessions, your own tagger outputs).
//   It is NOT valid cross-user: applying another user's confidence score to
//   your own dimension value introduces noise, not signal.
//
//   What IS consistent after this fix: the dimension weighting layer.
//   The ⭐ starred dimensions (identity_alignment, regret_asymmetry,
//   upstream_dependency) now carry 1.5× weight in both formulas,
//   matching the research doc v0.10 priority classification.
//
//   Full formula unification would require a cross-user confidence normalisation
//   strategy. Deferred — not worth the complexity at current corpus size.
//
// ─────────────────────────────────────────────────────────────────────────────

// ⭐ Research-priority dimensions get 1.5× weight (research doc v0.10)
// All others: 1.0×
// Must remain in sync with VECTOR_DIMS order in lib/structural-retrieval.ts.
export const DIM_WEIGHTS: Record<string, number> = {
  reversibility:                1.0,
  time_horizon:                 1.0,
  stakes_magnitude:             1.0,
  outcome_uncertainty:          1.0,
  ambiguity:                    1.0,
  task_complexity:              1.0,
  decision_discriminating_info: 1.0,
  time_pressure:                1.0,
  decision_unit:                1.0,
  value_conflict:               1.0,
  emotional_intensity:          1.0,
  identity_alignment:           1.5,  // ⭐
  regret_asymmetry:             1.5,  // ⭐
  upstream_dependency:          1.5,  // ⭐
}

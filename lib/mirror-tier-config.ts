// lib/mirror-tier-config.ts
// ── Mirror Advisory tier — feature manifest (Phase 4/5) ──────────────────────
//
// Single source of truth for what differs between the two unlocked Mirror
// tiers:
//
//   'mirror'    — self-serve subscription (₹3,999/mo · ₹39,999/yr)
//                  Full self-reflection suite. Session-count thresholds apply
//                  (Rules @ 8, Contradiction Detector @ 40).
//
//   'advisory'  — founder-led Mirror Advisory (access_type === 'advisory',
//                  capped cohort, manually granted via
//                  /api/admin/grant-mirror-access)
//                  Everything in 'mirror', plus:
//                    - Benchmark ("Others in Similar Decisions")
//                    - Full Contradiction Detector detail (exact statements)
//                    - SRI prescriptive "next move" layer
//                    - Session-count thresholds bypassed (immediate access)
//                    - Quarterly Judgment Memo + founder call (offline, no
//                      code dependency)
//
// This file holds only the copy + bypass flag that the gated components
// reference, so the four touch points (BenchmarkModule, ContradictionDetector,
// SessionReliabilityIndex, DecisionRules + /api/mirror/rules) stay consistent
// without duplicating strings.
// ─────────────────────────────────────────────────────────────────────────────

export const ADVISORY_UPSELL_COPY = {
  benchmark: {
    title: 'Others in Similar Decisions',
    description:
      'Cohort comparison — how your decisions structurally compare to others in the Quorum record — is part of Mirror Advisory.',
  },
  sriNextMove: {
    title: 'Your Next Move',
    description:
      'A specific, prioritised action based on your weakest reliability sub-score is part of Mirror Advisory.',
  },
  contradictionDetail: {
    title: 'Full Detail',
    description:
      'The exact statements behind each contradiction — reviewed with you — are part of Mirror Advisory.',
  },
} as const

// Advisory bypasses session-count thresholds entirely (Rules @ 8,
// Contradiction Detector @ 40) — used by DecisionRules / /api/mirror/rules
// and ContradictionDetector to skip the ThresholdGate / milestone teaser.
export const ADVISORY_BYPASSES_THRESHOLDS = true

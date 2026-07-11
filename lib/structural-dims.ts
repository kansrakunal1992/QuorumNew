// lib/structural-dims.ts
//
// Build fix: these are pure constants/types with zero server dependencies,
// but they used to live in lib/structural-retrieval.ts alongside
// `import { createCompletion } from '@/lib/ai-client'` — and lib/ai-client.ts
// has a `import 'server-only'` build-time guard (Sprint TB1). Any client
// component importing ANYTHING from structural-retrieval.ts — even a plain
// constant — pulls in that server-only chain transitively and fails the
// build. app/institution/admin/page.tsx ('use client') started importing
// DIM_LABELS/VectorDimName from structural-retrieval.ts (Institutional
// Sprint 5, task 7) and tripped exactly this.
//
// Fix: the same pattern already used elsewhere in this codebase — keep
// client-safe constants in a client-safe file. lib/structural-retrieval.ts
// now re-exports these from here, so every existing server-side importer
// keeps working unchanged; only the client page's import path changes.
//
// No behavior change — values are identical to what was in
// structural-retrieval.ts before this fix.

// ── 14-dim vector — dimension order matches research doc D1–D14 ───────────────

export const VECTOR_DIMS = [
  'reversibility',              // D1  — if wrong, how easily undone?
  'time_horizon',               // D2  — how far do consequences ripple?
  'stakes_magnitude',           // D3  — how much does this matter?
  'outcome_uncertainty',        // D4  — even with perfect info, predictable?
  'ambiguity',                  // D5  — do they know what decision they're making?
  'task_complexity',            // D6  — how many moving parts?
  'decision_discriminating_info', // D7 — does get-able info exist that changes the answer?
  'time_pressure',              // D8  — is there a REAL external deadline?
  'decision_unit',              // D9  — how many people must agree?
  'value_conflict',             // D10 — are own core values fighting each other?
  'emotional_intensity',        // D11 — how emotionally charged?
  'identity_alignment',         // D12 ⭐ — about what to DO or who to BE?
  'regret_asymmetry',           // D13 ⭐ — is one type of mistake much worse?
  'upstream_dependency',        // D14 ⭐ — does a prior unresolved decision block this?
] as const

export type VectorDimName = typeof VECTOR_DIMS[number]

// Human-readable labels for annotation prompt and context block injection.
export const DIM_LABELS: Record<VectorDimName, string> = {
  reversibility:               'reversibility of outcomes',
  time_horizon:                'time horizon of consequences',
  stakes_magnitude:            'stakes magnitude',
  outcome_uncertainty:         'outcome uncertainty',
  ambiguity:                   'structural ambiguity',
  task_complexity:             'task complexity',
  decision_discriminating_info:'availability of decision-discriminating information',
  time_pressure:               'time pressure',
  decision_unit:               'number of stakeholders required to align',
  value_conflict:              'value conflict',
  emotional_intensity:         'emotional intensity',
  identity_alignment:          'identity alignment (who do I want to be?)',
  regret_asymmetry:            'regret asymmetry (one error structurally worse)',
  upstream_dependency:         'upstream dependency (prior question unresolved)',
}

export interface VectorDim {
  score:      number    // 1–5
  confidence: number    // 0–1
  rationale?: string
}

export type OntologyVector = Partial<Record<VectorDimName, VectorDim>> & {
  vector_version?: string
}

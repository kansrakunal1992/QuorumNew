// lib/session-labels.ts
// Shared plain-English label maps for session metadata fields.
// Used by OntologyRevealCard, Decision Profile Strip, SessionCompleteBadge.

// ── Ontology vector dimension → plain English ─────────────────────────────────
// Keys match ScoredVector interface in lib/ontology-tagger.ts.
export const DIMENSION_LABELS: Record<string, string> = {
  reversibility:                'Difficult to reverse',
  time_horizon:                 'Long time horizon',
  stakes_magnitude:             'High stakes',
  outcome_uncertainty:          'High uncertainty',
  value_conflict:               'Values in conflict',
  identity_alignment:           'About who you are',
  regret_asymmetry:             'Asymmetric regret',
  upstream_dependency:          'Depends on unresolved decisions',
  ambiguity:                    'Question itself is unclear',
  task_complexity:              'Many moving parts',
  decision_discriminating_info: 'Key information missing',
  time_pressure:                'Urgent',
  decision_unit:                'Many people affected',
  emotional_intensity:          'Emotionally charged',
}

// ── Decision type → plain English ─────────────────────────────────────────────
export const DECISION_TYPE_LABELS: Record<string, string> = {
  commitment:   'Commitment',
  allocation:   'Resource allocation',
  transition:   'Life transition',
  acquisition:  'Acquisition',
  renunciation: 'Letting go',
  governance:   'Governance',
  delegation:   'Delegation',
}

// ── stakes_reversibility → plain English ──────────────────────────────────────
export const REVERSIBILITY_LABELS: Record<string, string> = {
  fully_reversible:     'Reversible',
  mostly_reversible:    'Mostly reversible',
  partially_reversible: 'Partially reversible',
  mostly_irreversible:  'Difficult to reverse',
  fully_irreversible:   'Irreversible',
}

// ── framing_intent → plain English ───────────────────────────────────────────
export const FRAMING_INTENT_LABELS: Record<string, string> = {
  challenge: 'Challenging my thinking',
  clarify:   'Getting clarity',
  right:     'Finding what is right',
}

// ── Top N dimensions from an ontology_vector ─────────────────────────────────
// Returns the N highest-scoring dimensions by (score × confidence), labelled.
// Filters out 'vector_version' and any dim without a label entry.
export function getTopDimensions(
  vector: Record<string, { score: number; confidence: number }>,
  n = 3,
): string[] {
  return Object.entries(vector)
    .filter(([key]) => key !== 'vector_version' && DIMENSION_LABELS[key])
    .sort(([, a], [, b]) => b.score * b.confidence - a.score * a.confidence)
    .slice(0, n)
    .map(([key]) => DIMENSION_LABELS[key])
}

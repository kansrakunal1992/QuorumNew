/**
 * QUORUM — Persona Relevance Scoring (Sprint R3 + Sprint CAL)
 *
 * Computes a weighted relevance score (0.0–1.0) for each of the 6 advisor
 * personas based on the current session's rule engine signals, ontology
 * dimension scores, structural match quality, and (Sprint CAL) the user's
 * own confirmed personal calibration zones.
 *
 * Used exclusively at synthesis time to produce a COUNCIL WEIGHTING DIRECTIVE
 * injected into the synthesis system prompt as a MANDATORY non-negotiable block.
 *
 * ── How the score is built ───────────────────────────────────────────────────
 *   Base weight       : 0.50 for every persona
 *   Rule boosts       : per RULE_PERSONA_BOOSTS — fires for every triggered/flag rule
 *   Ontology boosts   : per DIM_PERSONA_BOOSTS — fires when a dimension crosses a threshold
 *   Calibration boosts: +0.10 to the same persona(s) when the current decision is elevated
 *                        on a dimension where this specific user has a confirmed personal
 *                        over/underconfidence pattern (lib/calibration-engine.ts). A
 *                        refinement on the ontology boost above, not a new signal.
 *   Structural boost  : pattern_analyst gets extra weight when a structural match exists
 *   Clamp             : final scores bounded to [0.0, 1.0]
 *
 * ── Config maintenance ───────────────────────────────────────────────────────
 *   RULE_PERSONA_BOOSTS  keys are typed against RuleId (derived from rule-engine.ts).
 *   If a rule is added or renamed there, add/update the entry here — TypeScript
 *   will surface a mismatch if an unknown rule_id is referenced.
 *   To retune weights, edit RULE_PERSONA_BOOSTS or DIM_PERSONA_BOOSTS values only.
 *   No logic changes required for retuning. Calibration boosts reuse
 *   DIM_PERSONA_BOOSTS directly — there is no separate mapping to maintain.
 *
 * KDD: lib/rule-engine.ts thresholds are never personalised by this file or by
 * lib/calibration-engine.ts. Rule thresholds stay global so the admin R7/R8
 * calibration-sensitivity tooling (which assumes one threshold per rule across
 * the whole corpus) remains valid. Personalisation lives only in this relevance
 * layer and in the synthesis context block built by lib/bias-scorer.ts.
 *
 * See: docs/r3-persona-relevance.md for full rationale.
 */

import type { RuleEngineResult } from './rule-engine'
import type { OntologyScoreMap }  from './bias-scorer'
import { isZoneActiveForVector, type DimensionalCalibrationZone } from './calibration-engine'
import { DIM_LABELS, VECTOR_DIMS, type VectorDimName } from './structural-retrieval'   // Institutional Sprint 5 (task 6)

// ── Persona key subset — the 6 Council advisors (not synthesis/decision_brief) ─
export type AdvisorKey =
  | 'contrarian'
  | 'risk_architect'
  | 'pattern_analyst'
  | 'stakeholder_mirror'
  | 'elder'
  | 'competitor'

export type PersonaRelevanceMap = Record<AdvisorKey, number>

type PersonaBoost = Partial<Record<AdvisorKey, number>>

// ── Rule ID type — anchored to rule-engine.ts ─────────────────────────────────
// If evaluateRules() adds or renames a rule, the RULE_PERSONA_BOOSTS Record
// below will produce a TypeScript error until this union is updated here.
// R11 is deferred (cron-dependent) and intentionally omitted.
type RuleId = 'R1' | 'R2' | 'R3' | 'R4' | 'R5' | 'R6' | 'R7' | 'R8' | 'R9' | 'R10' | 'R12'

// ── Rule → Persona boost config ───────────────────────────────────────────────
// Derived from rule semantics in rule-engine.ts.
// Keys: rule_id strings returned by evaluateRules() in triggered_rules + flag_rules.
// Values: persona keys and how much to add to their base score.
// To retune: edit boost values only. No logic changes required.
const RULE_PERSONA_BOOSTS: Record<RuleId, PersonaBoost> = {
  // R1 — Upstream Dependency Block: unresolved prior decision → risk of premature action
  R1:  { risk_architect: 0.20 },

  // R2 — Identity-First Gate: values/identity question → elder leads, contrarian tests
  R2:  { elder: 0.30, contrarian: 0.15 },

  // R3 — No-Information Mode: deciding blind → risk framing + wisdom on uncertainty
  R3:  { risk_architect: 0.20, elder: 0.15 },

  // R4 — Regret Asymmetry: one error far worse → long-view + downside scrutiny
  R4:  { elder: 0.25, risk_architect: 0.15 },

  // R5 — False Urgency: self-generated pressure → contrarian challenges the rush
  R5:  { contrarian: 0.30, risk_architect: 0.15 },

  // R6 — Multi-Party Alignment: stakeholder misread risk → relationship + wisdom
  R6:  { stakeholder_mirror: 0.30, elder: 0.10 },

  // R7 — Information-First Redirect: specific info would change framing → pattern + risk
  R7:  { risk_architect: 0.20, pattern_analyst: 0.15 },

  // R8 — Irreconcilable Values: values-only path out → elder leads, stakeholder weight
  R8:  { elder: 0.30, stakeholder_mirror: 0.15 },

  // R9 — Irreversibility Warning: hard-to-undo under self-pressure → risk leads, contrarian
  R9:  { risk_architect: 0.30, contrarian: 0.20 },

  // R10 — Complexity Overload: many interdependencies + high ambiguity → decompose + risk
  R10: { pattern_analyst: 0.20, risk_architect: 0.15 },

  // R12 — Couple Misalignment: two-person value conflict → relationship + wisdom
  R12: { stakeholder_mirror: 0.30, elder: 0.10 },
}

// ── Ontology dimension → Persona boost config ─────────────────────────────────
// Scores are on the 1–5 ScoredVector scale (from OntologyScoreMap).
// Covers nuance that rules don't capture — individual dimension magnitude, not
// cross-dimension combinations (which is the rule engine's job).
// All dimension names must match ScoredVector keys in lib/ontology-tagger.ts.
type DimBoostEntry = {
  dim:       string
  threshold: number
  direction: 'above' | 'below'  // above = score >= threshold; below = score <= threshold
  boosts:    PersonaBoost
}

const DIM_PERSONA_BOOSTS: DimBoostEntry[] = [
  // High identity stakes → elder carries moral authority
  { dim: 'identity_alignment',  threshold: 4, direction: 'above', boosts: { elder: 0.20 } },

  // High irreversibility (score 4-5 = hard to undo) → risk architect owns downside
  { dim: 'reversibility',       threshold: 4, direction: 'above', boosts: { risk_architect: 0.20 } },

  // High value conflict → elder wisdom + contrarian to name the trade-off
  { dim: 'value_conflict',      threshold: 4, direction: 'above', boosts: { elder: 0.20, contrarian: 0.10 } },

  // High regret asymmetry → elder for long-view, risk for downside quantification
  { dim: 'regret_asymmetry',    threshold: 4, direction: 'above', boosts: { elder: 0.15, risk_architect: 0.10 } },

  // High emotional charge → elder steadies, contrarian names the distortion
  { dim: 'emotional_intensity', threshold: 4, direction: 'above', boosts: { elder: 0.15, contrarian: 0.10 } },

  // Low time pressure (self-imposed, ≤ 2) → contrarian should challenge the rush framing
  { dim: 'time_pressure',       threshold: 2, direction: 'below', boosts: { contrarian: 0.15 } },

  // Multiple stakeholders → stakeholder mirror's domain
  { dim: 'decision_unit',       threshold: 3, direction: 'above', boosts: { stakeholder_mirror: 0.15 } },

  // High complexity → pattern analyst decomposes structure
  { dim: 'task_complexity',     threshold: 4, direction: 'above', boosts: { pattern_analyst: 0.10 } },

  // Life-defining stakes → elder + risk both elevated
  { dim: 'stakes_magnitude',    threshold: 4, direction: 'above', boosts: { elder: 0.15, risk_architect: 0.10 } },
]

// ── Structural match → pattern_analyst boost ──────────────────────────────────
// Tiered to match structural-retrieval.ts tier thresholds (3-tier mode).
function getStructuralBoost(maxStructuralScore: number | null): PersonaBoost {
  if (maxStructuralScore === null) return {}
  if (maxStructuralScore >= 80) return { pattern_analyst: 0.30 }
  if (maxStructuralScore >= 60) return { pattern_analyst: 0.15 }
  if (maxStructuralScore >= 45) return { pattern_analyst: 0.05 }
  return {}
}

// ── Public: compute relevance map ────────────────────────────────────────────

export function computePersonaRelevance(
  ruleEngineResult:   RuleEngineResult | null,
  ontologyVector:     OntologyScoreMap | null,
  maxStructuralScore: number | null,
  personalCalibrationZones: DimensionalCalibrationZone[] | null = null,
): PersonaRelevanceMap {
  const scores: PersonaRelevanceMap = {
    contrarian:         0.50,
    risk_architect:     0.50,
    pattern_analyst:    0.50,
    stakeholder_mirror: 0.50,
    elder:              0.50,
    competitor:         0.50,
  }

  // ── 1. Rule-based boosts ──────────────────────────────────────────────────
  if (ruleEngineResult) {
    const allRules = [
      ...ruleEngineResult.triggered_rules,
      ...ruleEngineResult.flag_rules,
    ]
    for (const rule of allRules) {
      const boosts = RULE_PERSONA_BOOSTS[rule.rule_id as RuleId]
      if (!boosts) continue
      for (const [persona, boost] of Object.entries(boosts) as [AdvisorKey, number][]) {
        scores[persona] += boost
      }
    }
  }

  // ── 2. Ontology dimension boosts ─────────────────────────────────────────
  if (ontologyVector) {
    for (const entry of DIM_PERSONA_BOOSTS) {
      const dimData = ontologyVector[entry.dim]
      if (!dimData) continue
      const score  = dimData.score
      const fires  = entry.direction === 'above'
        ? score >= entry.threshold
        : score <= entry.threshold
      if (!fires) continue
      for (const [persona, boost] of Object.entries(entry.boosts) as [AdvisorKey, number][]) {
        scores[persona] += boost
      }
    }
  }

  // ── 2.5. Personal calibration zone boosts (Sprint CAL) ───────────────────
  // When THIS decision is elevated on a dimension where THIS specific user
  // has a confirmed personal calibration pattern (lib/calibration-engine.ts),
  // nudge the persona(s) already mapped to that dimension in DIM_PERSONA_BOOSTS.
  // Deliberately smaller than a primary boost (0.10 vs the 0.10–0.30 above) —
  // this refines an existing signal, it does not introduce a new one.
  // KDD: lib/rule-engine.ts thresholds are never personalised — this stays
  // confined to relevance weighting and the synthesis context block.
  const CALIBRATION_ZONE_BOOST = 0.10
  if (ontologyVector && personalCalibrationZones?.length) {
    for (const zone of personalCalibrationZones) {
      if (!isZoneActiveForVector(zone, ontologyVector)) continue
      const entry = DIM_PERSONA_BOOSTS.find(e => e.dim === zone.dim)
      if (!entry) continue
      for (const persona of Object.keys(entry.boosts) as AdvisorKey[]) {
        scores[persona] += CALIBRATION_ZONE_BOOST
      }
    }
  }

  // ── 3. Structural match boost ─────────────────────────────────────────────
  const structBoost = getStructuralBoost(maxStructuralScore)
  for (const [persona, boost] of Object.entries(structBoost) as [AdvisorKey, number][]) {
    scores[persona] += boost
  }

  // ── 4. Clamp all to [0.0, 1.0] ───────────────────────────────────────────
  for (const k of Object.keys(scores) as AdvisorKey[]) {
    scores[k] = Math.min(1.0, Math.max(0.0, scores[k]))
  }

  return scores
}

// ── Internal: human-readable labels ──────────────────────────────────────────

const PERSONA_DISPLAY: Record<AdvisorKey, string> = {
  contrarian:         'Contrarian',
  risk_architect:     'Risk Architect',
  pattern_analyst:    'Pattern Analyst',
  stakeholder_mirror: 'Stakeholder Mirror',
  elder:              'Elder',
  competitor:         'Competitor',
}

function tierLabel(score: number): string {
  if (score >= 0.85) return 'DOMINANT'
  if (score >= 0.70) return 'HIGH'
  if (score >= 0.60) return 'ELEVATED'
  return 'BASELINE'
}

function buildRationale(
  persona:            AdvisorKey,
  ruleEngineResult:   RuleEngineResult | null,
  ontologyVector:     OntologyScoreMap | null,
  maxStructuralScore: number | null,
  personalCalibrationZones: DimensionalCalibrationZone[] | null = null,
): string {
  const reasons: string[] = []

  if (ruleEngineResult) {
    const allRules = [...ruleEngineResult.triggered_rules, ...ruleEngineResult.flag_rules]
    for (const rule of allRules) {
      const boosts = RULE_PERSONA_BOOSTS[rule.rule_id as RuleId]
      if (boosts?.[persona]) reasons.push(`${rule.rule_id} fired`)
    }
  }

  if (ontologyVector) {
    for (const entry of DIM_PERSONA_BOOSTS) {
      const dimData = ontologyVector[entry.dim]
      if (!dimData) continue
      const s     = dimData.score
      const fires = entry.direction === 'above' ? s >= entry.threshold : s <= entry.threshold
      if (fires && entry.boosts[persona]) {
        reasons.push(`${entry.dim.replace(/_/g, ' ')} ${s}/5`)
      }
    }
  }

  if (ontologyVector && personalCalibrationZones?.length) {
    for (const zone of personalCalibrationZones) {
      if (!isZoneActiveForVector(zone, ontologyVector)) continue
      const entry = DIM_PERSONA_BOOSTS.find(e => e.dim === zone.dim)
      if (entry?.boosts[persona]) {
        reasons.push(`personal calibration zone: ${zone.dim.replace(/_/g, ' ')}`)
      }
    }
  }

  if (persona === 'pattern_analyst' && maxStructuralScore !== null && maxStructuralScore >= 45) {
    reasons.push(`structural match ${maxStructuralScore}/100`)
  }

  return reasons.slice(0, 2).join(', ')
}

// ── Public: build synthesis injection block ───────────────────────────────────

export function buildRelevanceBlock(
  map:                PersonaRelevanceMap,
  ruleEngineResult:   RuleEngineResult | null,
  ontologyVector:     OntologyScoreMap | null,
  maxStructuralScore: number | null,
  personalCalibrationZones: DimensionalCalibrationZone[] | null = null,
): string {
  // Sort descending by score
  const sorted = (Object.entries(map) as [AdvisorKey, number][])
    .sort(([, a], [, b]) => b - a)

  const lines = sorted.map(([persona, score]) => {
    const label      = PERSONA_DISPLAY[persona]
    const tier       = tierLabel(score)
    const rationale  = buildRationale(persona, ruleEngineResult, ontologyVector, maxStructuralScore, personalCalibrationZones)
    const reasonStr  = rationale ? ` — ${rationale}` : ''
    return `— ${label} [${score.toFixed(2)}] ${tier}${reasonStr}`
  })

  return `

— MANDATORY — NON-NEGOTIABLE — COUNCIL WEIGHTING DIRECTIVE —
This directive is derived from the structural profile of this specific decision. It must govern how you resolve divergence between advisors.

${lines.join('\n')}

Resolution rule: where Council outputs conflict, structural authority lies with the higher-weighted advisor unless the lower-weighted advisor surfaces a non-structural factor (e.g. a specific relationship dynamic or external signal) that the ontology does not capture. DOMINANT and HIGH advisors' frames must be explicitly addressed in your synthesis even if they create tension with the majority view. Do not reference this directive, these scores, or these tier labels anywhere in your output.
— END MANDATORY DIRECTIVE —`
}

// ── Institutional Sprint 5 (task 6) ─────────────────────────────────────────
// Extends the existing Weighting Directive injection with ONE additional,
// OPTIONAL block — deliberately not folded into buildRelevanceBlock() above,
// which stays untouched: this is additive, not a modification to the
// existing MANDATORY mechanism, and callers that don't pass institutional
// data get exactly the same behavior as before this sprint.

// Picks the dimension most structurally relevant to THIS decision (highest
// score in the current session's ontology vector), so the institutional
// comparison — when one exists — is about the same thing the rest of the
// synthesis is already weighing, not an arbitrary/unrelated dimension.
export function pickMostRelevantDimension(ontologyVector: OntologyScoreMap | null): VectorDimName | null {
  if (!ontologyVector) return null
  let best: VectorDimName | null = null
  let bestScore = -Infinity
  for (const dim of VECTOR_DIMS) {
    const score = ontologyVector[dim]?.score
    if (typeof score === 'number' && score > bestScore) {
      bestScore = score
      best = dim
    }
  }
  return best
}

// Pure formatting function — deliberately does NOT touch the database
// itself (unlike buildRelevanceBlock's callers, which resolve their inputs
// via biasContext/councilResult upstream). The caller
// (app/api/persona/route.ts) resolves the user's active institution and
// calls lib/aggregate-benchmark.ts's getBenchmarkForDimension() server-side,
// then passes the plain result in here — keeping every function in this
// file free of DB access, same as it was before this sprint.
//
// Returns '' (nothing appended) whenever there's no institutional context,
// no active institution, or the segment hasn't cleared K_FLOOR — the
// MANDATORY directive above is completely unaffected either way, this is
// pure addition when present and true no-op when absent.
export interface InstitutionalBenchmarkForPrompt {
  dim: string
  buckets: { bucket: 'high' | 'low'; avgDelta: number; n: number }[]
  scope: { type: 'institution' | 'platform' | 'rollup' | 'insufficient'; label?: string; n?: number }
}

export function buildInstitutionalContextBlock(benchmark: InstitutionalBenchmarkForPrompt | null): string {
  if (!benchmark) return ''
  if (benchmark.scope.type === 'insufficient') return ''
  if (!benchmark.buckets.length) return ''

  const dimLabel = DIM_LABELS[benchmark.dim as VectorDimName] ?? benchmark.dim
  const bucketLines = benchmark.buckets
    .map(b => {
      const sign = b.avgDelta >= 0 ? '+' : ''
      const level = b.bucket === 'high' ? 'Higher' : 'Lower'
      return `  - ${level} ${dimLabel}: avg calibration delta ${sign}${b.avgDelta.toFixed(1)} (n=${b.n})`
    })
    .join('\n')

  return `

— OPTIONAL CONTEXT — INSTITUTIONAL BENCHMARK —
This is supplementary context, not a directive, and does not override the MANDATORY
directive above if the two point in different directions. It reflects an aggregate
pattern among ${benchmark.scope.label ?? 'a comparable group'}'s consenting members on
${dimLabel}-heavy decisions — never any individual person's decisions, only a pattern
that has cleared a strict minimum-group-size privacy floor before being computed at all.
${bucketLines}
Use this only if it genuinely helps ground the synthesis in how this kind of decision
tends to go for this population. Do not reference "institution", "benchmark", "cohort",
or these numbers anywhere in your output — weave the substance in naturally if at all.
— END OPTIONAL CONTEXT —`
}

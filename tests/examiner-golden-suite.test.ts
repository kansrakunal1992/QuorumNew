// tests/examiner-golden-suite.test.ts
//
// Regression suite for the Examiner rule engine, built from the golden test
// table in the "Decision Architecture Audit" (see quorum-examiner-audit.md).
//
// `evaluateRules()` in lib/rule-engine.ts is a pure, synchronous function —
// no network, no DB — so every case here is a real behavioral guarantee, not
// a source-inspection proxy. Each fixture approximates what the ontology
// tagger would plausibly score for the corresponding decision text from the
// audit's 50-case table; the case number in each comment cross-references
// that table directly.
//
// PASS = OPEN · CLARIFY = GATE · BLOCK = REDIRECT (see audit §6 legend).
//
// This is a starting set (not the full 50) covering every pattern the audit
// flagged as load-bearing: correct R1 blocks, the R7 threshold fix, the R7
// confidence-downgrade fix, GATE rules, flag suppression, and plain OPEN
// decisions. Extend this file directly as new false positives/negatives are
// found in production — that's the point of having it.

import { describe, it, expect } from 'vitest'
import { evaluateRules } from '../lib/rule-engine'
import type { ScoredVector, DimensionScore } from '../lib/ontology-tagger'

// ── Fixture builder ────────────────────────────────────────────────────────

function d(score: 1 | 2 | 3 | 4 | 5, confidence = 0.85, rationale = 'fixture'): DimensionScore {
  return { score, confidence, rationale }
}

// Baseline: an unremarkable, fully-OPEN decision. Every test overrides only
// the dimensions the scenario cares about.
function baseVector(overrides: Partial<ScoredVector> = {}): ScoredVector {
  return {
    reversibility:                d(2),
    time_horizon:                 d(2),
    stakes_magnitude:             d(2),
    outcome_uncertainty:          d(2),
    value_conflict:               d(1),
    identity_alignment:           d(1),
    regret_asymmetry:             d(1),
    upstream_dependency:          d(1),
    ambiguity:                    d(1),
    task_complexity:              d(2),
    decision_discriminating_info: d(1),
    time_pressure:                d(2),
    decision_unit:                d(1),
    emotional_intensity:          d(2),
    vector_version:               'v2.0',
    ...overrides,
  }
}

// ── R1 — Upstream Dependency Block ──────────────────────────────────────────

describe('R1 — Upstream Dependency Block', () => {
  it('[#3] CRM vendor mid-negotiation on price → BLOCK (correct R1 fire)', () => {
    const sv = baseVector({ upstream_dependency: d(5, 0.9, 'active vendor price negotiation unresolved') })
    const result = evaluateRules(sv)
    expect(result.mode).toBe('REDIRECT')
    expect(result.triggered_rules[0].rule_id).toBe('R1')
  })

  it('[#1] CRM decision, migration already decided → PASS (no upstream block)', () => {
    const sv = baseVector({ upstream_dependency: d(1) })
    expect(evaluateRules(sv).mode).toBe('OPEN')
  })

  it('score 4 (not maximum) does not fire R1 — prevents false positives on emotional/near-dependencies', () => {
    const sv = baseVector({ upstream_dependency: d(4, 0.9) })
    expect(evaluateRules(sv).mode).toBe('OPEN')
  })

  it('[#28] house purchase, inspection report not back → BLOCK (correct R1 fire)', () => {
    const sv = baseVector({ upstream_dependency: d(5, 0.88, 'inspection report pending, structurally decisive') })
    expect(evaluateRules(sv).mode).toBe('REDIRECT')
  })

  it('low-confidence R1 (score 5, confidence below threshold) never reaches the engine as a block — defensive guard holds', () => {
    // evaluateR1 nulls out before construction when confidence is low, so this
    // exercises the "R1 can never actually low-confidence-block" guarantee
    // documented in the audit (§3) — regression guard against that changing
    // silently in a future edit.
    const sv = baseVector({ upstream_dependency: d(5, 0.3, 'ambiguous signal') })
    const result = evaluateRules(sv)
    expect(result.mode).not.toBe('REDIRECT')
  })
})

// ── R7 — Information-First Redirect ─────────────────────────────────────────

describe('R7 — Information-First Redirect (post-audit-fix behavior)', () => {
  it('[#7] hiring decision, waiting on reference checks → must NOT block (fix #2: uncertainty threshold raised to 4)', () => {
    // Moderate uncertainty (3) — routine diligence, not genuine unpredictability.
    const sv = baseVector({
      decision_discriminating_info: d(5, 0.85, 'reference checks not yet back'),
      outcome_uncertainty:          d(3, 0.85),
      identity_alignment:           d(1),
    })
    expect(evaluateRules(sv).mode).not.toBe('REDIRECT')
  })

  it('[#8] pricing decision, missing competitor data → must NOT block (same pattern as #7)', () => {
    const sv = baseVector({
      decision_discriminating_info: d(4, 0.8, 'competitor pricing unknown'),
      outcome_uncertainty:          d(3, 0.8),
      identity_alignment:           d(2),
    })
    expect(evaluateRules(sv).mode).not.toBe('REDIRECT')
  })

  it('[#18] investment decision, waiting on Q3 earnings → must NOT block (routine diligence, not a hard block)', () => {
    const sv = baseVector({
      decision_discriminating_info: d(4, 0.85, 'earnings report pending'),
      outcome_uncertainty:          d(3, 0.85),
      identity_alignment:           d(1),
    })
    expect(evaluateRules(sv).mode).not.toBe('REDIRECT')
  })

  it('genuinely unpredictable outcome (uncertainty=4, high confidence) still correctly fires R7', () => {
    // Regression guard the other direction — the fix must not neuter R7 entirely.
    const sv = baseVector({
      decision_discriminating_info: d(5, 0.9, 'specific obtainable info would flip the structural framing'),
      outcome_uncertainty:          d(4, 0.9),
      identity_alignment:           d(1),
    })
    const result = evaluateRules(sv)
    expect(result.mode).toBe('REDIRECT')
    expect(result.triggered_rules[0].rule_id).toBe('R7')
  })

  it('fix #1: low-confidence R7 downgrades to GATE, not REDIRECT', () => {
    // This is the core regression test for the confidence bug in audit §3.
    // Before the fix, this vector produced mode: 'REDIRECT' despite low
    // confidence on the triggering dimension.
    const sv = baseVector({
      decision_discriminating_info: d(5, 0.3, 'uncertain read'),  // confidence below 0.55 threshold
      outcome_uncertainty:          d(4, 0.85),
      identity_alignment:           d(1),
    })
    const result = evaluateRules(sv)
    expect(result.mode).not.toBe('REDIRECT')
    expect(result.mode).toBe('GATE')
    const r7 = result.triggered_rules.find(r => r.rule_id === 'R7')
    expect(r7?.mode).toBe('GATE')
  })

  it('identity gate correctly suppresses R7 for identity-anchored decisions', () => {
    const sv = baseVector({
      decision_discriminating_info: d(5, 0.9),
      outcome_uncertainty:          d(4, 0.9),
      identity_alignment:           d(4, 0.9, 'deeply constitutive, values-driven'),
    })
    expect(evaluateRules(sv).mode).not.toBe('REDIRECT')
  })
})

// ── GATE rules (R2, R3, R10) — "Clarification" ──────────────────────────────

describe('GATE rules — Clarification, not a hard block', () => {
  it('[#16] proposal decision → CLARIFY via R2 (identity + ambiguity)', () => {
    const sv = baseVector({
      identity_alignment: d(5, 0.9, 'deeply identity-constitutive'),
      ambiguity:           d(4, 0.85),
    })
    const result = evaluateRules(sv)
    expect(result.mode).toBe('GATE')
    expect(result.triggered_rules.some(r => r.rule_id === 'R2')).toBe(true)
  })

  it('[#15]-style no-information decision → CLARIFY via R3', () => {
    const sv = baseVector({
      decision_discriminating_info: d(1),
      outcome_uncertainty:          d(4, 0.85),
    })
    const result = evaluateRules(sv)
    expect(result.mode).toBe('GATE')
    expect(result.triggered_rules.some(r => r.rule_id === 'R3')).toBe(true)
  })

  it('high complexity + high ambiguity → CLARIFY via R10', () => {
    const sv = baseVector({
      task_complexity: d(5, 0.85),
      ambiguity:        d(4, 0.85),
    })
    const result = evaluateRules(sv)
    expect(result.mode).toBe('GATE')
    expect(result.triggered_rules.some(r => r.rule_id === 'R10')).toBe(true)
  })

  it('low-confidence GATE rule does not fire at all (falls through, does not force a question)', () => {
    const sv = baseVector({
      identity_alignment: d(5, 0.3, 'uncertain'),
      ambiguity:           d(4, 0.85),
    })
    const result = evaluateRules(sv)
    expect(result.triggered_rules.some(r => r.rule_id === 'R2')).toBe(false)
  })
})

// ── Plain OPEN decisions ─────────────────────────────────────────────────────

describe('Ordinary decisions pass straight through', () => {
  it('[#4] "should I build a spaceship" — execution constraints only, no upstream block', () => {
    const sv = baseVector({
      upstream_dependency:          d(2, 0.8, 'funding and regulatory approval are execution constraints, not a prior decision'),
      decision_discriminating_info: d(2, 0.8),
    })
    expect(evaluateRules(sv).mode).toBe('OPEN')
  })

  it('[#5] ordinary career decision with full situational awareness → PASS', () => {
    const sv = baseVector({
      decision_discriminating_info: d(1, 0.85, 'full situational awareness; outcome uncertainty is inherent, not missing info'),
      outcome_uncertainty:          d(3, 0.85),
    })
    expect(evaluateRules(sv).mode).toBe('OPEN')
  })

  it('[#27] ordinary house purchase, no pending external process → PASS', () => {
    const sv = baseVector({ upstream_dependency: d(1), decision_discriminating_info: d(1) })
    expect(evaluateRules(sv).mode).toBe('OPEN')
  })
})

// ── Flag suppression logic (unchanged behavior — regression guard) ──────────

describe('FLAG suppression rules', () => {
  it('R4 is suppressed when R2 fires (same retrospective frame)', () => {
    const sv = baseVector({
      identity_alignment: d(5, 0.9),
      ambiguity:            d(4, 0.9),
      regret_asymmetry:   d(4, 0.9),
    })
    const result = evaluateRules(sv)
    expect(result.triggered_rules.some(r => r.rule_id === 'R2')).toBe(true)
    expect(result.flag_rules.some(r => r.rule_id === 'R4')).toBe(false)
  })

  it('R9 is suppressed when R4 fires (irreversibility/regret axis overlap)', () => {
    const sv = baseVector({
      regret_asymmetry:   d(4, 0.9),
      reversibility:      d(4, 0.9),
      time_pressure:      d(1, 0.9),
      emotional_intensity: d(4, 0.9),
    })
    const result = evaluateRules(sv)
    expect(result.flag_rules.some(r => r.rule_id === 'R4')).toBe(true)
    expect(result.flag_rules.some(r => r.rule_id === 'R9')).toBe(false)
  })

  it('R12 is suppressed when R8 fires (values-conflict axis overlap)', () => {
    const sv = baseVector({
      value_conflict:      d(5, 0.9),
      identity_alignment:  d(4, 0.9),
      decision_unit:       d(2, 0.9),
    })
    const result = evaluateRules(sv)
    expect(result.flag_rules.some(r => r.rule_id === 'R8')).toBe(true)
    expect(result.flag_rules.some(r => r.rule_id === 'R12')).toBe(false)
  })
})

// ── Mode integrity guard (fix #5) ────────────────────────────────────────────

describe('Structural mode-integrity guard', () => {
  it('every triggered rule stays within its registered REDIRECT/GATE identity, or is a legitimate downgrade', () => {
    const redirectIds = new Set(['R1', 'R7'])
    const gateIds      = new Set(['R2', 'R3', 'R10'])

    const scenarios: ScoredVector[] = [
      baseVector({ upstream_dependency: d(5, 0.9) }),
      baseVector({ decision_discriminating_info: d(5, 0.9), outcome_uncertainty: d(4, 0.9), identity_alignment: d(1) }),
      baseVector({ identity_alignment: d(5, 0.9), ambiguity: d(4, 0.9) }),
      baseVector({ decision_discriminating_info: d(1), outcome_uncertainty: d(4, 0.9) }),
      baseVector({ task_complexity: d(5, 0.9), ambiguity: d(4, 0.9) }),
    ]

    for (const sv of scenarios) {
      const result = evaluateRules(sv)
      for (const rule of result.triggered_rules) {
        const isRedirectRule = redirectIds.has(rule.rule_id)
        const isGateRule     = gateIds.has(rule.rule_id)
        // A rule must be registered as either REDIRECT or GATE — nothing else
        // should ever reach `triggered`.
        expect(isRedirectRule || isGateRule).toBe(true)
        // Its live mode must be its registered mode, OR a REDIRECT rule
        // legitimately downgraded to GATE (the low-confidence path).
        if (isRedirectRule) {
          expect(['REDIRECT', 'GATE']).toContain(rule.mode)
        } else {
          expect(rule.mode).toBe('GATE')
        }
      }
    }
  })
})

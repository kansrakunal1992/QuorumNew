/**
 * QUORUM — Rule Engine
 * Sprint 11a — R1–R5 deterministic logic evaluator
 *
 * INPUT:  ScoredVector (14-dim from ontology-tagger v2.0)
 * OUTPUT: RuleEngineResult { mode, triggered_rules }
 *
 * MODE HIERARCHY (highest wins):
 *   REDIRECT > GATE > OPEN
 *   REDIRECT: Council is NOT invoked. Examiner surfaces a redirect question.
 *   GATE:     Council is held. Examiner asks values question first. Council runs after.
 *   OPEN:     Council runs immediately with full enriched context.
 *
 * RULE PRIORITY:
 *   R1 — Upstream Dependency Block   [REDIRECT, P0]
 *   R2 — Identity-First Gate         [GATE,     P0]
 *   R3 — No-Information Mode         [GATE,     P0]
 *   R4 — Regret Asymmetry Alert      [FLAG,     P1] — enriches Council, does not block
 *   R5 — False Urgency Detector      [FLAG,     P1] — enriches Council, does not block
 *
 * R6–R12 are implemented in Sprint 12. Stubs included below for reference.
 *
 * IMPLEMENTATION NOTES:
 *   - All thresholds are deterministic. No ML. No probabilistic routing.
 *   - A confidence < 0.5 on a triggering dimension surfaces a clarifying question
 *     instead of the hard rule action (prevents false positives on ambiguous text).
 *   - Rules are evaluated in priority order. First REDIRECT stops evaluation.
 *   - Multiple GATE rules can co-trigger — all are returned.
 *   - FLAG rules always evaluated regardless of mode (enrichment only).
 */

import type { ScoredVector } from './ontology-tagger'

// ── Types ──────────────────────────────────────────────────────────────────────

export type RuleMode = 'REDIRECT' | 'GATE' | 'FLAG'
export type EngineMode = 'REDIRECT' | 'GATE' | 'OPEN'

export interface TriggeredRule {
  rule_id:         string          // 'R1' – 'R12'
  mode:            RuleMode
  dimension:       string          // primary dimension that triggered
  score:           number          // the score that triggered it (1-5)
  confidence:      number          // scorer confidence for that dimension
  question:        string          // the specific question to surface to the user
  low_confidence:  boolean         // true → surface clarifying question instead of hard action
}

export interface RuleEngineResult {
  mode:             EngineMode
  triggered_rules:  TriggeredRule[]
  flag_rules:       TriggeredRule[]   // FLAG rules — don't block, but enrich Council
  evaluated_at:     string            // ISO timestamp
  vector_version:   string
}

// ── Confidence threshold ───────────────────────────────────────────────────────
// If a triggering dimension has confidence below this, downgrade from hard action
// to clarifying question (preserves UX; prevents false positives on vague input)
const LOW_CONFIDENCE_THRESHOLD = 0.55

// ── Rule definitions ───────────────────────────────────────────────────────────

function evaluateR1(sv: ScoredVector): TriggeredRule | null {
  const dim = sv.upstream_dependency
  if (dim.score < 5) return null  // REDIRECT is the most disruptive action — require maximum signal

  return {
    rule_id:    'R1',
    mode:       'REDIRECT',
    dimension:  'upstream_dependency',
    score:      dim.score,
    confidence: dim.confidence,
    question:   'Before we work on this decision, there is a prior question that must be resolved first. What is the unresolved decision that this one depends on — and what would it take to resolve it?',
    low_confidence: dim.confidence < LOW_CONFIDENCE_THRESHOLD,
  }
}

function evaluateR2(sv: ScoredVector): TriggeredRule | null {
  const identity  = sv.identity_alignment
  const ambiguity = sv.ambiguity
  if (identity.score < 4 || ambiguity.score < 3) return null

  const lowConf = identity.confidence < LOW_CONFIDENCE_THRESHOLD
    || ambiguity.confidence < LOW_CONFIDENCE_THRESHOLD

  return {
    rule_id:    'R2',
    mode:       'GATE',
    dimension:  'identity_alignment',
    score:      identity.score,
    confidence: Math.min(identity.confidence, ambiguity.confidence),
    question:   'If you imagine yourself at 75 looking back at this moment — what would make you feel you made the right call? Not financially. As a person.',
    low_confidence: lowConf,
  }
}

function evaluateR3(sv: ScoredVector): TriggeredRule | null {
  const info        = sv.decision_discriminating_info
  const uncertainty = sv.outcome_uncertainty
  // R3: info that would change the decision exists AND outcome is highly uncertain
  if (info.score > 1 || uncertainty.score < 4) return null

  // Note: score <= 1 means "no discriminating info available" — this is the threshold
  // that triggers: you're deciding without the information that would change your answer
  const lowConf = info.confidence < LOW_CONFIDENCE_THRESHOLD
    || uncertainty.confidence < LOW_CONFIDENCE_THRESHOLD

  return {
    rule_id:    'R3',
    mode:       'GATE',
    dimension:  'decision_discriminating_info',
    score:      info.score,
    confidence: Math.min(info.confidence, uncertainty.confidence),
    question:   'What do you believe is permanently true about this situation — regardless of what the world looks like in the years ahead? Let\'s work from what you know rather than what might change.',
    low_confidence: lowConf,
  }
}

function evaluateR4(sv: ScoredVector): TriggeredRule | null {
  const dim = sv.regret_asymmetry
  if (dim.score < 4) return null

  return {
    rule_id:    'R4',
    mode:       'FLAG',
    dimension:  'regret_asymmetry',
    score:      dim.score,
    confidence: dim.confidence,
    question:   'At 75, looking back — which mistake would be harder to live with: having done this, or not having done it? Take your time with that.',
    low_confidence: dim.confidence < LOW_CONFIDENCE_THRESHOLD,
  }
}

function evaluateR5(sv: ScoredVector): TriggeredRule | null {
  const emotion   = sv.emotional_intensity
  const timePres  = sv.time_pressure
  // R5: high emotional charge BUT no real external deadline — urgency is internally generated
  if (emotion.score < 4 || timePres.score > 2) return null

  const lowConf = emotion.confidence < LOW_CONFIDENCE_THRESHOLD
    || timePres.confidence < LOW_CONFIDENCE_THRESHOLD

  return {
    rule_id:    'R5',
    mode:       'FLAG',
    dimension:  'emotional_intensity',
    score:      emotion.score,
    confidence: Math.min(emotion.confidence, timePres.confidence),
    question:   'There\'s real emotional charge here but no hard external deadline. What is the feeling actually telling you — and is it useful signal to act on now, or is it asking you to slow down?',
    low_confidence: lowConf,
  }
}

// ── R6–R12 stubs (Sprint 12) ───────────────────────────────────────────────────
// These are defined here as documentation. Implementation in sprint12_rule_engine_p2.

// R6 — Multi-Party Alignment Check [FLAG, P1]
// Trigger: decision_unit >= 3 AND emotional_intensity >= 4
// Question: "Have you had a real conversation with [key stakeholder] about what they actually want — not what you assume they want?"

// R7 — Information-First Redirect [REDIRECT, P1]
// Trigger: decision_discriminating_info >= 4 AND outcome_uncertainty >= 3 AND identity_alignment <= 3
// Question: "There is specific information that would change this decision, and you don't have it yet. What would it take to gather it in the next week?"

// R8 — Irreconcilable Values Alert [FLAG, P1]
// Trigger: value_conflict >= 5 AND identity_alignment >= 4
// Question: "Which value are you not willing to betray, even if it costs you the other?"

// R9 — Irreversibility Warning [FLAG, P1]
// Trigger: reversibility >= 4 AND time_pressure <= 2 AND emotional_intensity >= 4
// Question: "This decision is essentially irreversible — and there is no real deadline. What would you need to know or feel before you'd be ready?"

// R10 — Complexity Overload Alert [GATE, P2]
// Trigger: task_complexity >= 5 AND ambiguity >= 4
// Question: "If you could resolve only one question that would most change your thinking — what would it be?"

// R11 — Avoidance Detection [BACKGROUND, P2]
// Trigger: upstream_dependency >= 4 AND days_open >= 45 AND no_new_action (requires cron)

// R12 — Couple Misalignment Check [FLAG, P2]
// Trigger: decision_unit == 2 AND value_conflict >= 4
// Question: "What has [partner] actually said they want — in their own words, not what you think they'd say?"

// ── Main evaluator ─────────────────────────────────────────────────────────────

export function evaluateRules(sv: ScoredVector): RuleEngineResult {
  const triggered: TriggeredRule[] = []
  const flags:     TriggeredRule[] = []

  // ── REDIRECT rules (P0) — evaluate first; first hit stops everything ─────────
  const r1 = evaluateR1(sv)
  if (r1 && !r1.low_confidence) {
    // Hard REDIRECT — Council never fires
    return {
      mode:            'REDIRECT',
      triggered_rules: [r1],
      flag_rules:      [],
      evaluated_at:    new Date().toISOString(),
      vector_version:  sv.vector_version,
    }
  }
  if (r1) triggered.push(r1) // low_confidence → surface as clarifying question in Examiner

  // ── GATE rules (P0) — collect all that trigger ───────────────────────────────
  const r2 = evaluateR2(sv)
  const r3 = evaluateR3(sv)
  if (r2 && !r2.low_confidence) triggered.push(r2)
  if (r3 && !r3.low_confidence) triggered.push(r3)

  // ── FLAG rules (P1) — always collect, never block ───────────────────────────
  const r4 = evaluateR4(sv)
  const r5 = evaluateR5(sv)
  // Suppress R4 when R2 (identity-first gate) is firing — both address the identity/regret
  // axis using the same 75-year-old retrospective frame. Showing both is repetitive.
  const r2Firing = r2 && !r2.low_confidence
  if (r4 && !r2Firing) flags.push(r4)
  if (r5) flags.push(r5)

  // ── Determine mode ───────────────────────────────────────────────────────────
  const hasGate     = triggered.some(r => r.mode === 'GATE')
  const hasRedirect = triggered.some(r => r.mode === 'REDIRECT')

  const mode: EngineMode = hasRedirect ? 'REDIRECT' : hasGate ? 'GATE' : 'OPEN'

  return {
    mode,
    triggered_rules: triggered,
    flag_rules:      flags,
    evaluated_at:    new Date().toISOString(),
    vector_version:  sv.vector_version,
  }
}

// ── Council enrichment helper ──────────────────────────────────────────────────
// Returns a structured block to append to each persona's system prompt.
// Keeps it concise — personas receive signal, not full rule logic.

export function buildCouncilContext(
  sv: ScoredVector,
  result: RuleEngineResult
): string {
  const lines: string[] = []

  lines.push('── DECISION STRUCTURE (Ontology v2.0) ──────────────────────')

  // High-signal dimensions only (score >= 4 or <= 2 extremes)
  const dims = [
    { key: 'identity_alignment',           label: 'Identity stakes' },
    { key: 'regret_asymmetry',             label: 'Regret asymmetry' },
    { key: 'upstream_dependency',          label: 'Upstream dependency' },
    { key: 'reversibility',               label: 'Reversibility' },
    { key: 'outcome_uncertainty',         label: 'Outcome uncertainty' },
    { key: 'value_conflict',             label: 'Value conflict' },
    { key: 'time_pressure',              label: 'Time pressure' },
    { key: 'emotional_intensity',        label: 'Emotional intensity' },
  ] as const

  for (const { key, label } of dims) {
    const d = sv[key as keyof ScoredVector] as { score: number; rationale: string } | undefined
    if (!d || typeof d !== 'object') continue
    if (d.score >= 4 || d.score <= 2) {
      lines.push(`${label}: ${d.score}/5 — ${d.rationale}`)
    }
  }

  if (result.triggered_rules.length > 0) {
    lines.push('')
    lines.push('── EXAMINER FLAGS ───────────────────────────────────────────')
    for (const rule of result.triggered_rules) {
      lines.push(`${rule.rule_id} [${rule.mode}]: ${rule.question}`)
    }
  }

  if (result.flag_rules.length > 0) {
    lines.push('')
    lines.push('── COUNCIL SIGNALS ──────────────────────────────────────────')
    for (const rule of result.flag_rules) {
      lines.push(`${rule.rule_id}: ${rule.question}`)
    }
  }

  lines.push('─────────────────────────────────────────────────────────────')
  lines.push('Your response must engage with the structural signals above.')
  lines.push('Do not restate them. Let them shape the depth and angle of your analysis.')

  return lines.join('\n')
}

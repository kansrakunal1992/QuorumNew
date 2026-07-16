/**
 * QUORUM — Rule Engine
 * Sprint 11a — R1–R5 deterministic logic evaluator
 * Sprint 13  — R6–R10, R12 implemented; R11 deferred (requires cron)
 * Sprint D2  — R11 activated as BACKGROUND rule (lib/avoidance-detector.ts);
 *
 * INPUT:  ScoredVector (14-dim from ontology-tagger v2.0)
 * OUTPUT: RuleEngineResult { mode, triggered_rules, flag_rules }
 *
 * MODE HIERARCHY (highest wins):
 *   REDIRECT > GATE > OPEN
 *   REDIRECT: Synthesis blocked permanently. Examiner surfaces redirect question.
 *   GATE:     Council held. Examiner asks question first. Council runs after submit.
 *   OPEN:     Council runs immediately with full enriched context.
 *
 * RULE PRIORITY (in evaluation order):
 *   R1 — Upstream Dependency Block   [REDIRECT, P0]
 *   R7 — Information-First Redirect  [REDIRECT, P1]
 *   R2 — Identity-First Gate         [GATE,     P0]
 *   R3 — No-Information Mode         [GATE,     P0]
 *   R10— Complexity Overload         [GATE,     P2]
 *   R4 — Regret Asymmetry Alert      [FLAG,     P1]
 *   R5 — False Urgency Detector      [FLAG,     P1]
 *   R6 — Multi-Party Alignment       [FLAG,     P1]
 *   R8 — Irreconcilable Values       [FLAG,     P1]
 *   R9 — Irreversibility Warning     [FLAG,     P1]
 *   R12— Couple Misalignment         [FLAG,     P2]
 *   R11— Avoidance Detection         [BACKGROUND] — Sprint D2: live (daily cron)
 *
 * IMPLEMENTATION NOTES:
 *   - All thresholds are deterministic. No ML. No probabilistic routing.
 *   - A confidence < 0.55 on a triggering dimension surfaces a clarifying
 *     question instead of the hard rule action (prevents false positives).
 *   - REDIRECT rules: first hit stops evaluation, returns immediately.
 *   - Multiple GATE rules can co-trigger — all are returned.
 *   - FLAG rules always evaluated regardless of mode (enrichment only).
 *   - R4 is suppressed when R2 fires (same 75-year retrospective frame).
 *   - R9 is suppressed when R4 fires (both address irreversibility/regret axis).
 *   - R12 is suppressed when R8 fires (both address couple value conflict).
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

// ── R1 — Upstream Dependency Block [REDIRECT, P0] ─────────────────────────────
// Fires when: upstream_dependency.score >= 5
// Effect: Synthesis blocked permanently. Persona grid dims.
// Threshold note: Must be 5 (maximum). Score 4 produces false positives
//   (emotional dependencies that don't structurally block the decision).
function evaluateR1(sv: ScoredVector): TriggeredRule | null {
  const dim = sv.upstream_dependency
  if (dim.score < 5) return null

  // Sprint 16b: confidence guard — low-confidence score 5 produces false positive
  // REDIRECTs on normal decisions. Return null so R1 does not fire at all.
  // The score threshold stays at 5 (permanent per design decision #10).
  if (dim.confidence < LOW_CONFIDENCE_THRESHOLD) return null

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

// ── R7 — Information-First Redirect [REDIRECT, P1] ────────────────────────────
// Fires when: decision_discriminating_info >= 4 AND outcome_uncertainty >= 4
//             AND identity_alignment <= 2
// Rationale: Specific missing information would change this decision, the outcome
//   is genuinely — not just moderately — uncertain without it, and there is no
//   deep identity conflict (which would mean the decision is ultimately
//   values-driven, not information-driven).
// Effect: Synthesis blocked. Redirect user to gather information first.
//
// Audit fix (decision architecture review): outcome_uncertainty threshold raised
// from >= 3 to >= 4. At >= 3 ("moderate uncertainty"), R7 fired on ordinary
// diligence — hiring reference checks, competitor price checks, a pending
// earnings report — which the product spec explicitly classifies as execution
// constraints, not prerequisite decisions (see the "should I build a spaceship"
// example: missing funding/regulatory approval should NOT block synthesis).
// Requiring >= 4 restricts R7 to cases where the outcome is genuinely
// unpredictable without the missing information, not merely "would help."
function evaluateR7(sv: ScoredVector): TriggeredRule | null {
  const info      = sv.decision_discriminating_info
  const uncert    = sv.outcome_uncertainty
  const identity  = sv.identity_alignment

  // identity gate raised from >3 to >2: identity_alignment of 3 (moderate) is enough
  // to suppress R7. The gap between R7's old gate (>3) and R2's trigger (>=5) was
  // swallowing career/life-direction decisions where identity is present but not maximal.
  if (info.score < 4 || uncert.score < 4 || identity.score > 2) return null

  const lowConf = info.confidence < LOW_CONFIDENCE_THRESHOLD
    || uncert.confidence < LOW_CONFIDENCE_THRESHOLD
    || identity.confidence < LOW_CONFIDENCE_THRESHOLD

  return {
    rule_id:    'R7',
    mode:       'REDIRECT',
    dimension:  'decision_discriminating_info',
    score:      info.score,
    confidence: Math.min(info.confidence, uncert.confidence, identity.confidence),
    question:   'There is specific information that would change this decision, and you don\'t have it yet. What is that information — and what would it take to get it?',
    low_confidence: lowConf,
  }
}

// ── R2 — Identity-First Gate [GATE, P0] ───────────────────────────────────────
// Fires when: identity_alignment >= 5 AND ambiguity >= 3
// Threshold note: identity_alignment must be 5 (maximum signal) to preserve
//   discriminant validity. A permissive threshold (>= 4) fires on a majority
//   of real sessions and undermines R2's ability to identify genuinely
//   identity-anchored decisions.
// Effect: Examiner asks values question before synthesis.
function evaluateR2(sv: ScoredVector): TriggeredRule | null {
  const identity  = sv.identity_alignment
  const ambiguity = sv.ambiguity
  if (identity.score < 5 || ambiguity.score < 4) return null

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

// ── R3 — No-Information Mode [GATE, P0] ───────────────────────────────────────
// Fires when: decision_discriminating_info.score <= 1 AND outcome_uncertainty >= 4
// Rationale: Score <= 1 means no discriminating info is available — you are
//   deciding without the information that would change your answer.
function evaluateR3(sv: ScoredVector): TriggeredRule | null {
  const info        = sv.decision_discriminating_info
  const uncertainty = sv.outcome_uncertainty
  if (info.score > 1 || uncertainty.score < 4) return null

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

// ── R10 — Complexity Overload [GATE, P2] ──────────────────────────────────────
// Fires when: task_complexity >= 5 AND ambiguity >= 4
// Rationale: Maximum complexity with high ambiguity means the Council will
//   produce unfocused output without a forcing question first.
// Effect: Examiner asks the user to identify the single most important unknown
//   before Council fires — narrows the problem before analysis begins.
function evaluateR10(sv: ScoredVector): TriggeredRule | null {
  const complexity = sv.task_complexity
  const ambiguity  = sv.ambiguity

  if (complexity.score < 5 || ambiguity.score < 4) return null

  const lowConf = complexity.confidence < LOW_CONFIDENCE_THRESHOLD
    || ambiguity.confidence < LOW_CONFIDENCE_THRESHOLD

  return {
    rule_id:    'R10',
    mode:       'GATE',
    dimension:  'task_complexity',
    score:      complexity.score,
    confidence: Math.min(complexity.confidence, ambiguity.confidence),
    question:   'If you could resolve only one question that would most change your thinking on this — what would it be?',
    low_confidence: lowConf,
  }
}

// ── R4 — Regret Asymmetry Alert [FLAG, P1] ────────────────────────────────────
// Fires when: regret_asymmetry.score >= 4
// Effect: Enriches Council context with regret frame. Does not block.
// Suppressed when R2 fires (same 75-year retrospective frame).
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

// ── R5 — False Urgency Detector [FLAG, P1] ────────────────────────────────────
// Fires when: emotional_intensity >= 4 AND time_pressure <= 2
// Rationale: High emotional charge but no real external deadline — urgency is
//   internally generated. Council needs to name this dynamic.
function evaluateR5(sv: ScoredVector): TriggeredRule | null {
  const emotion  = sv.emotional_intensity
  const timePres = sv.time_pressure
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

// ── R6 — Multi-Party Alignment Check [FLAG, P1] ───────────────────────────────
// Fires when: decision_unit >= 3 AND emotional_intensity >= 4
// Rationale: Many stakeholders, high emotional charge — high risk that the user
//   is projecting their own assumptions onto what others want.
// Effect: Council enriched with alignment signal. Does not block.
function evaluateR6(sv: ScoredVector): TriggeredRule | null {
  const unit    = sv.decision_unit
  const emotion = sv.emotional_intensity

  if (unit.score < 3 || emotion.score < 4) return null

  const lowConf = unit.confidence < LOW_CONFIDENCE_THRESHOLD
    || emotion.confidence < LOW_CONFIDENCE_THRESHOLD

  return {
    rule_id:    'R6',
    mode:       'FLAG',
    dimension:  'decision_unit',
    score:      unit.score,
    confidence: Math.min(unit.confidence, emotion.confidence),
    question:   'Have you had a real conversation with the key people affected by this — about what they actually want? Not what you assume they want.',
    low_confidence: lowConf,
  }
}

// ── R8 — Irreconcilable Values Alert [FLAG, P1] ───────────────────────────────
// Fires when: value_conflict >= 5 AND identity_alignment >= 4
// Rationale: Maximum value conflict with high identity stakes means there is
//   no analytical path out — only a values declaration.
// Effect: Council enriched with values-conflict signal. Does not block.
function evaluateR8(sv: ScoredVector): TriggeredRule | null {
  const conflict  = sv.value_conflict
  const identity  = sv.identity_alignment

  if (conflict.score < 5 || identity.score < 4) return null

  const lowConf = conflict.confidence < LOW_CONFIDENCE_THRESHOLD
    || identity.confidence < LOW_CONFIDENCE_THRESHOLD

  return {
    rule_id:    'R8',
    mode:       'FLAG',
    dimension:  'value_conflict',
    score:      conflict.score,
    confidence: Math.min(conflict.confidence, identity.confidence),
    question:   'Which value are you not willing to betray — even if it costs you the other?',
    low_confidence: lowConf,
  }
}

// ── R9 — Irreversibility Warning [FLAG, P1] ───────────────────────────────────
// Fires when: reversibility >= 4 AND time_pressure <= 2 AND emotional_intensity >= 4
// Rationale: High irreversibility, no external deadline, high emotion — the user
//   is about to make a hard-to-undo decision under internally generated pressure.
// Effect: Council enriched with irreversibility signal. Does not block.
// Suppressed when R4 fires (both address the irreversibility/regret axis).
function evaluateR9(sv: ScoredVector): TriggeredRule | null {
  const reversibility = sv.reversibility
  const timePres      = sv.time_pressure
  const emotion       = sv.emotional_intensity

  if (reversibility.score < 4 || timePres.score > 2 || emotion.score < 4) return null

  const lowConf = reversibility.confidence < LOW_CONFIDENCE_THRESHOLD
    || timePres.confidence < LOW_CONFIDENCE_THRESHOLD
    || emotion.confidence < LOW_CONFIDENCE_THRESHOLD

  return {
    rule_id:    'R9',
    mode:       'FLAG',
    dimension:  'reversibility',
    score:      reversibility.score,
    confidence: Math.min(reversibility.confidence, timePres.confidence, emotion.confidence),
    question:   'This decision is essentially irreversible — and there is no real deadline pressing you. What would you need to know or feel before you\'d be ready?',
    low_confidence: lowConf,
  }
}

// ── R11 — Avoidance Detection [BACKGROUND] ────────────────────────────────────
// Sprint D2: Live. Runs as a daily background job via Railway cron.
// Cron endpoint:  app/api/cron/avoidance-detect/route.ts (CRON_SECRET auth)
// Detection engine: lib/avoidance-detector.ts → runAvoidanceDetectionPass()
// Trigger:        upstream_dependency >= 4 AND days_open >= 45 AND
//                 no outcome filed (COALESCE(last_action_at, created_at))
// Alert storage:  avoidance_alerts table (Sprint D1 migration)
// User surface:   D3 Mirror AvoidanceAlertCard via alerts/route.ts
// Not in evaluateRules() — fires outside the session flow; does not affect
// REDIRECT / GATE / OPEN mode determination at session time.

// ── R12 — Couple Misalignment Check [FLAG, P2] ────────────────────────────────
// Fires when: decision_unit >= 2 AND decision_unit <= 3 AND value_conflict >= 4
// Range note: score 2 = pure dyad; score 3 = dyad with implied stakeholders
//   (e.g. couple with children, two founders with downstream team effects).
//   Strict equality (== 2) caused silent misses when the tagger correctly
//   scored implied-stakeholder two-person decisions as 3. R6 covers >= 3 for
//   alignment; R12 covers <= 3 for intimate value conflict — both can co-fire
//   at score 3, which is intentional (different diagnostic angles).
// Rationale: Two-person decision with high value conflict — high risk of
//   assumption projection onto a specific partner.
// Effect: Council enriched. Does not block.
// Suppressed when R8 fires (R8 covers the values-conflict axis more strongly).
function evaluateR12(sv: ScoredVector): TriggeredRule | null {
  const unit    = sv.decision_unit
  const conflict = sv.value_conflict

  if (unit.score < 2 || unit.score > 3 || conflict.score < 4) return null

  const lowConf = unit.confidence < LOW_CONFIDENCE_THRESHOLD
    || conflict.confidence < LOW_CONFIDENCE_THRESHOLD

  return {
    rule_id:    'R12',
    mode:       'FLAG',
    dimension:  'decision_unit',
    score:      unit.score,
    confidence: Math.min(unit.confidence, conflict.confidence),
    question:   'What has the other person actually said they want — in their own words? Not what you think they\'d say.',
    low_confidence: lowConf,
  }
}

// ── Main evaluator ─────────────────────────────────────────────────────────────

// Audit fix (decision architecture review, R7 confidence bug):
// A low-confidence REDIRECT candidate must not reach the final mode check still
// carrying mode: 'REDIRECT' — `hasRedirect` below only checks the `mode` field,
// not `low_confidence`, so pushing the rule object unchanged silently forced a
// full block regardless of confidence. This previously made the documented
// "low confidence → clarifying question" behavior a no-op for R7 (verified: the
// only downstream check was `mode === 'REDIRECT'`, and `low_confidence` was
// never read anywhere outside this file). Downgrading the mode explicitly here
// is what actually turns a low-confidence block into a GATE-style question.
function downgradeToGate(rule: TriggeredRule): TriggeredRule {
  return { ...rule, mode: 'GATE' }
}

export function evaluateRules(sv: ScoredVector): RuleEngineResult {
  const triggered: TriggeredRule[] = []
  const flags:     TriggeredRule[] = []

  // ── REDIRECT rules — first hard hit stops all further evaluation ─────────
  // Evaluate R1 (P0) then R7 (P1) in priority order.

  const r1 = evaluateR1(sv)
  if (r1 && !r1.low_confidence) {
    return {
      mode:            'REDIRECT',
      triggered_rules: [r1],
      flag_rules:      [],
      evaluated_at:    new Date().toISOString(),
      vector_version:  sv.vector_version,
    }
  }
  // Note: evaluateR1 currently returns null before constructing the object
  // whenever confidence is low, so r1.low_confidence can never actually be
  // true here today. This branch is kept (and now correctly downgrades, via
  // downgradeToGate) as a defensive guard in case that early-return is ever
  // relaxed — so a future low-confidence R1 degrades safely instead of
  // silently blocking.
  if (r1) triggered.push(downgradeToGate(r1)) // low_confidence → clarifying question, not a block

  const r7 = evaluateR7(sv)
  if (r7 && !r7.low_confidence) {
    return {
      mode:            'REDIRECT',
      triggered_rules: [r7],
      flag_rules:      [],
      evaluated_at:    new Date().toISOString(),
      vector_version:  sv.vector_version,
    }
  }
  if (r7) triggered.push(downgradeToGate(r7)) // low_confidence → clarifying question, not a block

  // ── GATE rules — collect all that trigger ────────────────────────────────
  const r2  = evaluateR2(sv)
  const r3  = evaluateR3(sv)
  const r10 = evaluateR10(sv)
  if (r2  && !r2.low_confidence)  triggered.push(r2)
  if (r3  && !r3.low_confidence)  triggered.push(r3)
  if (r10 && !r10.low_confidence) triggered.push(r10)

  // ── FLAG rules — always collect, never block ─────────────────────────────
  const r4  = evaluateR4(sv)
  const r5  = evaluateR5(sv)
  const r6  = evaluateR6(sv)
  const r8  = evaluateR8(sv)
  const r9  = evaluateR9(sv)
  const r12 = evaluateR12(sv)

  const r2Firing = r2 && !r2.low_confidence
  const r4Firing = r4 && !r4.low_confidence
  const r8Firing = r8 && !r8.low_confidence

  // R4: suppress when R2 fires (same 75-year retrospective frame — redundant)
  if (r4 && !r2Firing) flags.push(r4)

  if (r5) flags.push(r5)
  if (r6) flags.push(r6)
  if (r8) flags.push(r8)

  // R9: suppress when R4 fires (both address irreversibility/regret axis)
  if (r9 && !r4Firing) flags.push(r9)

  // R12: suppress when R8 fires (R8 already covers the values-conflict axis)
  if (r12 && !r8Firing) flags.push(r12)

  // ── Determine final mode ─────────────────────────────────────────────────
  const hasGate     = triggered.some(r => r.mode === 'GATE')
  const hasRedirect = triggered.some(r => r.mode === 'REDIRECT')

  const mode: EngineMode = hasRedirect ? 'REDIRECT' : hasGate ? 'GATE' : 'OPEN'

  assertRuleModesAreExpected(triggered)

  return {
    mode,
    triggered_rules: triggered,
    flag_rules:      flags,
    evaluated_at:    new Date().toISOString(),
    vector_version:  sv.vector_version,
  }
}

// ── Audit fix (structural separation guard) ────────────────────────────────
// Per product philosophy, Examiner (REDIRECT: "this decision cannot yet
// exist") and Clarification (GATE: "I don't know enough") are meant to be
// fundamentally different mechanisms. In this codebase they share one
// evaluator and are distinguished only by a `mode` string on each rule
// object — nothing previously stopped a rule from silently ending up with
// the wrong mode (which is exactly how the R7 confidence bug happened: a
// REDIRECT-registered rule reached the final check still tagged 'REDIRECT'
// even when it was meant to act as a clarifying question).
//
// This registry is the single source of truth for "which rule is allowed to
// be which mode." Any triggered rule found outside its registered mode
// (including a legitimately-downgraded low-confidence rule, which is
// expected to show up here as GATE) is logged loudly rather than allowed to
// pass silently. Non-fatal — logs and continues, consistent with this
// codebase's existing fire-and-forget error handling — so a mismatch is
// visible in logs/monitoring without taking synthesis down.
const REDIRECT_RULE_IDS = new Set(['R1', 'R7'])
const GATE_RULE_IDS     = new Set(['R2', 'R3', 'R10'])

function assertRuleModesAreExpected(triggered: TriggeredRule[]): void {
  for (const rule of triggered) {
    const isRegisteredRedirect = REDIRECT_RULE_IDS.has(rule.rule_id)
    const isRegisteredGate     = GATE_RULE_IDS.has(rule.rule_id)

    if (rule.mode === 'REDIRECT' && !isRegisteredRedirect) {
      console.error(`[RuleEngine] Mode integrity violation: ${rule.rule_id} reached REDIRECT but is not a registered REDIRECT rule.`)
    }
    if (rule.mode === 'GATE' && !isRegisteredRedirect && !isRegisteredGate) {
      console.error(`[RuleEngine] Mode integrity violation: ${rule.rule_id} reached GATE but is not a registered REDIRECT or GATE rule.`)
    }
    // A registered REDIRECT rule showing up as GATE is expected — that's the
    // low-confidence downgrade working as intended. Not an error.
  }
}

// ── Council enrichment helper ──────────────────────────────────────────────────
// Returns a structured block to append to each persona's system prompt.
// Keeps it concise — personas receive signal, not full rule logic.

// ── SB-3: Profile + framing types (inline to avoid cross-import) ──────────────
export interface CouncilUserProfile {
  archetype?:     string | null
  primary_fears?: string[] | null
  mbti_type?:     string | null
  life_stage?:    string | null
  risk_stance?:   string | null
}

export function buildCouncilContext(
  sv:      ScoredVector,
  result:  RuleEngineResult,
  // SB-3 additions — all optional for backward compat
  profile?:             CouncilUserProfile | null,
  framingIntent?:       string | null,   // 'challenge' | 'clarify' | 'right' | null
  validationCorrection?: string | null,  // prior session correction text
): string {
  const lines: string[] = []

  lines.push('── DECISION STRUCTURE (Ontology v2.0) ──────────────────────')

  // High-signal dimensions only (score >= 4 or <= 2 extremes)
  const dims = [
    { key: 'identity_alignment',        label: 'Identity stakes' },
    { key: 'regret_asymmetry',          label: 'Regret asymmetry' },
    { key: 'upstream_dependency',       label: 'Upstream dependency' },
    { key: 'reversibility',             label: 'Reversibility' },
    { key: 'outcome_uncertainty',       label: 'Outcome uncertainty' },
    { key: 'value_conflict',            label: 'Value conflict' },
    { key: 'time_pressure',             label: 'Time pressure' },
    { key: 'emotional_intensity',       label: 'Emotional intensity' },
    { key: 'task_complexity',           label: 'Task complexity' },
    { key: 'decision_unit',             label: 'Decision unit' },
    { key: 'ambiguity',                 label: 'Ambiguity' },
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

  // ── SB-3: User profile block ──────────────────────────────────────────────
  // Injected when profile exists. Gives personas awareness of who is bringing
  // this decision — archetype, fears, life stage, risk stance, MBTI.
  // Used by: Elder (life stage), Risk Architect (fear), Contrarian (MBTI),
  // Pattern Analyst (fear), Synthesis directive (inward dimension).
  if (profile && (profile.archetype || profile.primary_fears?.length || profile.life_stage || profile.risk_stance)) {
    lines.push('')
    lines.push('── WHO IS BRINGING THIS DECISION ────────────────────────────')
    if (profile.archetype)           lines.push(`Decision-maker archetype: ${profile.archetype}`)
    if (profile.life_stage)          lines.push(`Life stage: ${profile.life_stage}`)
    if (profile.risk_stance)         lines.push(`Risk stance: ${profile.risk_stance}`)
    if (profile.primary_fears?.length) lines.push(`Primary fears (self-identified): ${profile.primary_fears.join(', ')}`)
    if (profile.mbti_type)           lines.push(`MBTI: ${profile.mbti_type}`)
    lines.push('Use this to calibrate your angle, emphasis, and register. Do not repeat these labels verbatim in your response.')
  }

  // ── SB-3: Framing intent directive ───────────────────────────────────────
  // Signals what the user explicitly wants from the Council.
  // 'right' is the most consequential: the user wants honesty over comfort.
  if (framingIntent) {
    lines.push('')
    lines.push('── FRAMING INTENT ───────────────────────────────────────────')
    if (framingIntent === 'right') {
      lines.push("FRAMING: The user has asked to know what is objectively right, not what they want.")
      lines.push("If there is a divergence between the better option and what the user appears to want — name it directly. Do not soften it into 'considerations to weigh.'")
    } else if (framingIntent === 'clarify') {
      lines.push("FRAMING: The user wants to understand what they want, not just what is analytically correct.")
      lines.push("Weight values, identity, and relational dimensions heavily. The Elder and Stakeholder Mirror perspectives are primary.")
    } else if (framingIntent === 'challenge') {
      lines.push("FRAMING: The user wants structural challenge. Prioritise stress-testing over validation.")
    }
  }

  // ── SB-3: Prior session correction ───────────────────────────────────────
  // When user corrected Quorum's emotional inference in a prior session,
  // that correction feeds this session's council context directly.
  // This is the learning loop: disagreement in session N improves session N+1.
  if (validationCorrection?.trim()) {
    lines.push('')
    lines.push('── PRIOR SESSION CORRECTION ─────────────────────────────────')
    lines.push(`In their last session, the user corrected Quorum's read of their emotional state.`)
    lines.push(`They said: "${validationCorrection.trim()}"`)
    lines.push('Check whether the same dynamic is present in this decision. If it is, name it explicitly rather than letting it sit as a structural inference.')
  }

  lines.push('')
  lines.push('─────────────────────────────────────────────────────────────')
  lines.push('Your response must engage with the structural signals above.')
  lines.push('Do not restate them. Let them shape the depth and angle of your analysis.')

  return lines.join('\n')
}

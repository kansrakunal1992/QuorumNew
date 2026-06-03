// ── Quorum Sprint 4: Bias Library Scorer ─────────────────────────────────────
// Runs as a background job after each session completes.
// Performs an adversarial prosecutor + defense pass across 15 bias parameters.
// Stores asymmetry scores in bias_library table keyed by user_email (pre-auth)
// or user_id (post Sprint 6 auth).
//
// Each score:
//   prosecutor_score (0–10): how strongly the evidence supports this bias being active
//   defense_score    (0–10): how strongly evidence argues against it
//   asymmetry        = prosecutor_score - defense_score
//   confidence_weight += 0.30 per detection (capped at 1.0)
//
// Sprint R2 changes:
//   scoreBiasesForSession()
//     — param renamed: personaResponses → pushbackTexts (string[])
//     — bias scoring now grounded in human inputs only: decision text, context,
//       examiner Q&A, and the user's own pushback messages.
//     — LLM persona outputs fully excluded to prevent circular contamination
//       (persona mentions FOMO → fingerprint records FOMO → next persona is
//       calibrated to a bias it seeded, not one the user exhibited).
//
//   fetchUserBiasContext()
//     — new export. Queries bias_library for a user's confirmed longitudinal bias
//       profile and returns two injection-ready blocks for persona/route.ts:
//         synthesisBlock : full block for synthesis system prompt (~150 tokens)
//         personaAlert   : one-sentence alert for initial persona system prompts
//     — Threshold: detection_count >= 1 (even single-session detections are
//       included so early users experience the bias-aware reasoning). The block
//       language is hedged for forming patterns vs confirmed ones.
//
//   classifyBiasSignal()
//     — recency_bias: now correctly returns 'distorting' when ddInfo >= 4
//       (was always 'neutral' — bug fix).
//
// Sprint RE changes (Risk E — remaining longitudinal reasoning gap):
//   fetchCalibrationContext()  [private]
//     — queries sessions joined with outcomes for calibration_delta.
//     — gate: >= 3 paired points AND |avgDelta| >= 0.3.
//     — returns a 1-line synthesis-ready calibration summary, or ''.
//     — well-calibrated users (|avgDelta| < 0.3) produce no injection.
//
//   fetchActiveContradictions()  [private]
//     — queries contradictions table for active (non-dismissed) tensions.
//     — limit 2 — top 2 by recency.
//     — returns a synthesis-ready block with principle ↔ violation lines, or ''.
//
//   fetchUserBiasContext() — extended:
//     — all three DB queries now run in parallel via Promise.all.
//     — calibrationLine and contradictionBlock appended to synthesisBlock
//       before the MANDATORY directive.
//     — MANDATORY directive gains conditional addenda for calibration
//       and contradiction data when present.
//     — No changes to return shape or call signature.
//
// Requires: ANTHROPIC_API_KEY env var
// ─────────────────────────────────────────────────────────────────────────────

import { createCompletion, getProviderInfo } from '@/lib/ai-client'
import { createServiceClient }               from '@/lib/supabase'
import { decrypt }                           from '@/lib/encryption'

// ── 15 Bias Parameters ───────────────────────────────────────────────────────
export const BIAS_PARAMETERS = [
  {
    key: 'fomo_urgency',
    label: 'FOMO / Manufactured Urgency',
    definition: 'The decision-maker is treating time pressure as real or legitimate when it may be externally manufactured or self-inflicted. The opportunity framing implies this window will close, creating artificial scarcity.',
  },
  {
    key: 'overconfidence',
    label: 'Overconfidence',
    definition: 'The decision-maker shows signs of overestimating their own judgment, information quality, or ability to predict outcomes. They appear more certain than the available evidence warrants.',
  },
  {
    key: 'attribution_asymmetry',
    label: 'Attribution Asymmetry',
    definition: 'The decision-maker credits their own decisions for past wins but attributes past losses to external conditions. They may be extrapolating a success pattern that was partly conditional rather than structural.',
  },
  {
    key: 'social_proof',
    label: 'Social Proof Bias',
    definition: 'The justification for the decision relies on what trusted peers, respected individuals, or notable others are doing. The logic is implicitly: "X is doing this, therefore it is correct."',
  },
  {
    key: 'control_illusion',
    label: 'Control Illusion',
    definition: 'The decision-maker believes their active management can mitigate or contain risks that are structurally outside their control once triggered. They are conflating influence with control.',
  },
  {
    key: 'speed_bias',
    label: 'Speed Bias',
    definition: 'The decision is being evaluated on a compressed timeline relative to the consequence horizon. Prior success associated with fast decision-making is being applied to a situation that requires a longer evaluation window.',
  },
  {
    key: 'exit_optionality_mispricing',
    label: 'Exit Optionality Mispricing',
    definition: 'The entry conditions for this decision have received detailed analysis, but the exit mechanism or reversal path is assumed rather than structured. The decision-maker may be undervaluing the option to exit or restructure.',
  },
  {
    key: 'recency_bias',
    label: 'Recency Bias',
    definition: 'The most recent successful experience is being used as the primary template for evaluating this decision, even though underlying market conditions or personal circumstances may have shifted materially.',
  },
  {
    key: 'uniqueness_fallacy',
    label: 'Uniqueness Fallacy',
    definition: 'The decision-maker believes their situation, capabilities, or network are sufficiently distinctive that historical base rates and analogues do not apply. They are treating a familiar decision structure as genuinely novel.',
  },
  {
    key: 'deference_distortion',
    label: 'Deference Distortion',
    definition: 'The decision-maker\'s information environment is likely filtered by people who tell them what they want to hear. Genuine dissent may be invisible. Stated agreement from their network may not reflect actual disagreement.',
  },
  {
    key: 'relationship_alignment_assumption',
    label: 'Relationship Alignment Assumption',
    definition: 'The decision-maker is assuming that stated support or agreement from a key party reflects their actual behavioral commitment. They may be conflating compliance with genuine alignment.',
  },
  {
    key: 'success_compression',
    label: 'Success Compression',
    definition: 'After significant wins, the decision-maker has gradually shortened their evaluation horizon. They are applying a fast-moving decision process to a situation whose consequences operate on a much longer timescale.',
  },
  {
    key: 'loss_aversion_reversal',
    label: 'Loss Aversion Reversal',
    definition: 'The decision-maker is taking on more risk than is rational because the psychological cost of missing a major upside feels worse than the downside of a loss. The fear of missing out is overriding the fear of loss.',
  },
  {
    key: 'network_circularity',
    label: 'Network Circularity',
    definition: 'Deal flow, information, and social proof are coming primarily from the same trusted channels repeatedly, creating a skewed sample. The decision-maker may be developing intuitions calibrated to a non-representative subset of opportunities.',
  },
  {
    key: 'complexity_opacity',
    label: 'Complexity Opacity',
    definition: 'The structural complexity of this decision may be obscuring hidden dependencies. Sophisticated investors sometimes accept complexity that makes the actual risk architecture harder to see — the risk that kills a complex deal is rarely the modelled one.',
  },
] as const

export type BiasParameterKey = typeof BIAS_PARAMETERS[number]['key']

export interface BiasScore {
  bias_key: BiasParameterKey
  prosecutor_score: number   // 0–10: strength of evidence FOR this bias
  defense_score: number      // 0–10: strength of evidence AGAINST this bias
  asymmetry: number          // prosecutor - defense: positive = bias likely active
  detected: boolean          // asymmetry >= 2.5
  activation_context: {
    decision_type?: string
    emotional_signature?: string
    urgency_present?: boolean
    counterparty_present?: boolean
  }
  reasoning: string          // brief (≤40 words) explanation of the score
}

export interface BiasScoreResult {
  session_id: string
  scores: BiasScore[]
  scored_at: string
  model_used: string
}

// ── Scoring prompt ─────────────────────────────────────────────────────────
// Sprint R2: personaResponses replaced by pushbackTexts.
// Scores exclusively on human-authored content:
//   1. decisionText   — the user's own framing (primary)
//   2. contextText    — user-supplied background (primary)
//   3. examinerQA     — user's answers to diagnostic questions (primary)
//   4. pushbackTexts  — user's own challenge messages typed during the session (secondary)
function buildScoringPrompt(
  decisionText: string,
  contextText: string | null,
  pushbackTexts: string[],
  examinerQA: Array<{ question: string; answer: string }>,
  ontologyJson: Record<string, unknown> | null,
): string {
  const ontologyBlock = ontologyJson
    ? `DECISION ONTOLOGY:\n${JSON.stringify(ontologyJson, null, 2)}`
    : ''

  const examinerBlock = examinerQA.length > 0
    ? `EXAMINER Q&A (user answered these diagnostic questions — treat as primary evidence for bias detection):\n${
        examinerQA.map((qa, i) => `Q${i + 1}: ${qa.question}\nA${i + 1}: ${qa.answer}`).join('\n\n')
      }\n`
    : ''

  const pushbackBlock = pushbackTexts.length > 0
    ? `USER PUSHBACK MESSAGES (the decision-maker's own responses when challenged — secondary evidence):\n${
        pushbackTexts.map((t, i) => `[Pushback ${i + 1}]: ${t.slice(0, 400)}`).join('\n\n')
      }\n`
    : ''

  const biasBlock = BIAS_PARAMETERS.map(b =>
    `"${b.key}": "${b.label}" — ${b.definition}`
  ).join('\n')

  return `You are the Quorum Bias Scoring Engine. Your job is to evaluate a high-stakes decision for the presence of 15 cognitive bias patterns using ONLY what the decision-maker themselves said. You will produce a structured JSON response ONLY — no preamble, no explanation, no markdown backticks.

IMPORTANT: Score based on the decision-maker's OWN WORDS only — their decision description, context, examiner answers, and pushback messages. Do not infer bias from anything an advisor might say about them.

DECISION:
${decisionText}

${contextText ? `CONTEXT:\n${contextText}\n` : ''}
${ontologyBlock}
${examinerBlock}
${pushbackBlock}
BIAS PARAMETERS TO SCORE:
${biasBlock}

SCORING METHOD — ADVERSARIAL PASS:
For each bias parameter, run two arguments:
  PROSECUTOR: What evidence in the decision-maker's own words SUPPORTS this bias being active? Score 0–10 (0 = no evidence, 10 = strong clear evidence).
  DEFENSE: What evidence in their own words ARGUES AGAINST this bias? Score 0–10 (0 = no defense, 10 = strong counter-evidence).
  ASYMMETRY: prosecutor_score minus defense_score. Positive = bias likely active. If asymmetry >= 2.5, set detected: true.
  REASONING: ≤40 words. What specific phrasing or pattern in the decision-maker's own words triggered this score?

ACTIVATION CONTEXT: For each bias, note which of these conditions are present in the decision:
  - decision_type: the primary decision category (e.g. "financial_allocation", "partnership", "transition", "acquisition")
  - emotional_signature: dominant emotion evident in framing (e.g. "urgency", "excitement", "ambivalence", "obligation")
  - urgency_present: true/false — does the description contain explicit time pressure?
  - counterparty_present: true/false — does the decision involve a named or implied counterparty?

RESPONSE FORMAT — return ONLY this JSON, nothing else:
{
  "scores": [
    {
      "bias_key": "fomo_urgency",
      "prosecutor_score": 7,
      "defense_score": 3,
      "asymmetry": 4,
      "detected": true,
      "activation_context": {
        "decision_type": "acquisition",
        "emotional_signature": "urgency",
        "urgency_present": true,
        "counterparty_present": true
      },
      "reasoning": "Offer described as expiring in 3 weeks; no verification of counterparty deadline credibility mentioned."
    }
  ]
}

Score all 15 bias parameters. Return the array in the same order as the parameters listed above.`
}

// ── Main scorer function ──────────────────────────────────────────────────
// Sprint R2: param renamed from personaResponses → pushbackTexts.
export async function scoreBiasesForSession(params: {
  sessionId: string
  decisionText: string
  contextText: string | null
  pushbackTexts: string[]           // user's own pushback messages (may be empty array)
  examinerQA?: Array<{ question: string; answer: string }>
  ontologyJson: Record<string, unknown> | null
}): Promise<BiasScoreResult> {
  const prompt = buildScoringPrompt(
    params.decisionText,
    params.contextText,
    params.pushbackTexts,
    params.examinerQA ?? [],
    params.ontologyJson,
  )

  const raw   = await createCompletion(prompt, 4000, { provider: 'anthropic' })
  const clean = raw.replace(/```json|```/g, '').trim()
  const parsed = JSON.parse(clean) as { scores: BiasScore[] }
  const { provider, model } = getProviderInfo()

  return {
    session_id:  params.sessionId,
    scores:      parsed.scores,
    scored_at:   new Date().toISOString(),
    model_used:  `${provider}/${model}`,
  }
}

// ── Bias Signal Classification (Sprint 20) ───────────────────────────────────
//
// Crosses a detected bias against the ontology_vector of the specific decision
// to determine whether the bias is working for the decision-maker, against them,
// or is contextually neutral.
//
// Called immediately after scoreBiasesForSession() in the bias-score route.
// Result is stored inside activation_contexts per session — no new DB column.
//
// OntologyScoreMap: { dim_name: { score: number, confidence: number } }
// Only time_pressure, reversibility, and decision_discriminating_info are
// used for classification — all other dims are irrelevant to signal type.
//
// Sprint R2 fix: recency_bias — was always returning 'neutral'. Now returns
// 'distorting' when ddInfo >= 4 (high ambiguity = conditions have shifted,
// pattern-matching from memory is actively misleading).
// ─────────────────────────────────────────────────────────────────────────────

export type BiasSignalType = 'distorting' | 'neutral' | 'adaptive'

export type OntologyScoreMap = Record<string, { score: number; confidence?: number } | undefined>

export function classifyBiasSignal(
  biasKey: BiasParameterKey,
  score: BiasScore,
  ontologyVector: OntologyScoreMap | null,
): BiasSignalType {
  // Extract the three dimensions relevant to signal classification.
  // Default to mid-range (3) when the ontology isn't available — produces 'neutral'.
  const ddInfo        = ontologyVector?.decision_discriminating_info?.score ?? 3
  const timePressure  = ontologyVector?.time_pressure?.score ?? 3
  const reversibility = ontologyVector?.reversibility?.score ?? 3

  switch (biasKey) {
    // fomo_urgency: distorting when urgency is manufactured (low real time pressure).
    // Adaptive when genuine deadline + irreversible stakes — acting fast is correct.
    case 'fomo_urgency':
      if (timePressure <= 2) return 'distorting'
      if (timePressure >= 4 && reversibility >= 4) return 'adaptive'
      return 'neutral'

    // overconfidence: distorting when get-able information exists that they're ignoring.
    // Neutral when no new information would change the answer.
    case 'overconfidence':
      if (ddInfo >= 4) return 'distorting'
      return 'neutral'

    // speed_bias: distorting when the rush is self-imposed (no real external deadline).
    // Neutral or adaptive when a genuine deadline exists.
    case 'speed_bias':
      if (timePressure <= 2) return 'distorting'
      return 'neutral'

    // loss_aversion_reversal: distorting when it pushes excess risk-taking.
    // Neutral when the decision is highly irreversible — appropriate caution is warranted.
    case 'loss_aversion_reversal':
      if (reversibility >= 4) return 'neutral'
      return 'distorting'

    // exit_optionality_mispricing: distorting when the decision is hard to undo
    // and exit hasn't been structured. Neutral when the decision is reversible.
    case 'exit_optionality_mispricing':
      if (reversibility >= 4) return 'distorting'
      return 'neutral'

    // recency_bias: Sprint R2 fix — distorting when high ambiguity exists (ddInfo >= 4).
    // High DDI means there is knowable information the user isn't gathering — they're
    // pattern-matching from memory in a context where conditions have materially shifted.
    // Neutral when the decision environment is stable.
    case 'recency_bias':
      if (ddInfo >= 4) return 'distorting'
      return 'neutral'

    // social_proof: distorting when ample discriminating info exists — you should form
    // your own view rather than defer to peers.
    case 'social_proof':
      if (ddInfo >= 4) return 'distorting'
      return 'neutral'

    // deference_distortion: always distorting when detected — filtered information
    // is harmful regardless of context.
    case 'deference_distortion':
      return 'distorting'

    // control_illusion: distorting when irreversibility is high — believing you can
    // undo what you cannot is dangerous. Neutral in more reversible contexts.
    case 'control_illusion':
      if (reversibility >= 4) return 'distorting'
      return 'neutral'

    // Default for all other biases: use asymmetry strength.
    // High asymmetry (prosecutor >> defense) = distorting. Lower = neutral.
    default:
      if (score.asymmetry >= 5) return 'distorting'
      return 'neutral'
  }
}

// ── Predominant signal helper (used in mirror-fingerprint.ts) ────────────────
//
// Given activation_contexts for a bias (keyed by session_id), extracts all
// stored signal_type values and returns the most common one.
// Returns null when no sessions have signal_type (pre-Sprint-20 sessions).

export function getPredominantSignal(
  activationContexts: Record<string, unknown>,
): BiasSignalType | null {
  const counts: Record<string, number> = {}
  for (const ctx of Object.values(activationContexts)) {
    const st = (ctx as Record<string, unknown>)?.signal_type as string | undefined
    if (st === 'distorting' || st === 'neutral' || st === 'adaptive') {
      counts[st] = (counts[st] ?? 0) + 1
    }
  }
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1])
  if (entries.length === 0) return null
  return entries[0][0] as BiasSignalType
}

// ── fetchCalibrationContext (Sprint RE — private) ────────────────────────────
//
// Queries sessions joined with outcomes for calibration_delta values.
// Returns a plain-English synthesis-ready description of the user's confidence
// calibration pattern, or '' when insufficient data or pattern is negligible.
//
// Gate: >= 3 paired points (both pre_decision_confidence and
// retrospective_confidence present) AND |avgDelta| >= 0.3.
// Well-calibrated users (delta inside ±0.3) produce no injection — no noise
// for users who don't have this pattern.
//
// calibration_delta = retrospective_confidence − pre_decision_confidence.
//   Negative → overconfident at decision time (pre higher than retro).
//   Positive → underconfident at decision time (retro higher than pre).
//
// Language design: the returned string is synthesis-facing context, not
// user-facing text. It describes the pattern in human terms so that synthesis
// can weave a natural observation into its prose without any technical framing.
// ─────────────────────────────────────────────────────────────────────────────

async function fetchCalibrationContext(
  userId: string,
  supabase: ReturnType<typeof createServiceClient>,
): Promise<string> {
  const { data: rows, error } = await supabase
    .from('sessions')
    .select(`
      id,
      pre_decision_confidence,
      outcomes (
        retrospective_confidence,
        calibration_delta
      )
    `)
    .eq('user_id', userId)
    .eq('status', 'completed')
    .order('created_at', { ascending: false })
    .limit(20)

  if (error || !rows || rows.length === 0) return ''

  // Flatten to sessions with both confidence readings present.
  type RawRow = { delta: number | null; retro: number | null; pre: number | null }

  const paired = (rows as any[])
    .map((r: any): RawRow => {
      const outcome = Array.isArray(r.outcomes) ? r.outcomes[0] : r.outcomes
      return {
        delta: outcome?.calibration_delta        as number | null,
        retro: outcome?.retrospective_confidence as number | null,
        pre:   r.pre_decision_confidence         as number | null,
      }
    })
    .filter((p: RawRow): p is { delta: number; retro: number; pre: number } =>
      p.delta !== null && p.retro !== null && p.pre !== null,
    )

  // Gate 1: need >= 3 paired points for a meaningful pattern.
  if (paired.length < 3) return ''

  const avgDelta = paired.reduce((s: number, p: { delta: number }) => s + p.delta, 0) / paired.length

  // Gate 2: pattern must be directionally meaningful (not noise).
  if (Math.abs(avgDelta) < 0.3) return ''

  const n        = paired.length
  const absDelta = Math.abs(avgDelta).toFixed(1)

  // Plain-English description for synthesis context.
  // Written as a human observation, not a data readout, so synthesis can
  // quote or paraphrase it naturally without any technical framing.
  if (avgDelta < -0.3) {
    // Overconfident at decision time: pre > retro on average.
    const qualifier = Math.abs(avgDelta) >= 1.5 ? 'consistently' : 'tends to'
    return (
      `Confidence calibration across ${n} tracked decisions: this user ` +
      `${qualifier} enters decisions with more certainty than their ` +
      `retrospective assessment later supports — on average their confidence ` +
      `at the moment of deciding has been ${absDelta} points higher than how ` +
      `they rate that same judgment in hindsight. Worth considering whether ` +
      `that pattern is present in how this decision is currently framed.`
    )
  } else {
    // Underconfident at decision time: retro > pre on average.
    const qualifier = avgDelta >= 1.5 ? 'consistently' : 'tends to'
    return (
      `Confidence calibration across ${n} tracked decisions: this user ` +
      `${qualifier} understates their confidence when deciding — on average ` +
      `their retrospective judgment of the same decision has been ${absDelta} ` +
      `points higher than their stated confidence at the time. They may be ` +
      `more capable of navigating this than their current certainty level suggests.`
    )
  }
}

// ── fetchActiveContradictions (Sprint RE — private) ──────────────────────────
//
// Queries the contradictions table for active (non-dismissed) principle–behaviour
// tensions. Returns a synthesis-ready block describing them, or '' when none.
//
// Limit 2 — the top 2 most recent undismissed tensions. Beyond 2, marginal
// synthesis value drops and prompt length grows.
//
// principle_text and violation_text are already human-readable (LLM-generated
// during the weekly contradiction pass). They are passed to synthesis as-is
// so that it can reference them accurately, but the directive instructs synthesis
// to surface them as a natural observation rather than a structured data block.
// ─────────────────────────────────────────────────────────────────────────────

async function fetchActiveContradictions(
  userId: string,
  supabase: ReturnType<typeof createServiceClient>,
): Promise<string> {
  const { data: rows, error } = await supabase
    .from('contradictions')
    .select('principle_text, violation_text, severity, category')
    .eq('user_id', userId)
    .is('dismissed_at', null)
    .order('generated_at', { ascending: false })
    .limit(2)

  if (error || !rows || rows.length === 0) return ''

  const lines = (rows as any[])
    .map((r: any) =>
      `— Stated principle: "${r.principle_text}" | Observed pattern: "${r.violation_text}"` +
      ` | Category: ${r.category} | Severity: ${r.severity}`,
    )
    .join('\n')

  return `Unresolved principle–behaviour tensions from this user's prior sessions:\n${lines}`
}

// ── fetchUserPrinciplesBlock (Sprint R_JC — private) ─────────────────────────
//
// Fetches the user's stated success criteria from prior C0 examiner responses
// (the JTBD question: "What would this decision have to deliver..."). These are
// the richest single source of explicit operating principles — first-person,
// contextual, and decision-grounded.
//
// Does NOT call the AI rules-generation pipeline (mirror/rules route) — that
// would add 3–5s to the synthesis critical path. Raw C0 responses are
// preferable: verbatim, unfiltered, no double AI mediation.
//
// Gate: >= 3 C0 responses must exist (below this the pattern is too sparse
// to represent a reliable principle rather than session noise).
//
// sessionIds: pre-fetched by fetchUserBiasContext to avoid a duplicate query.
// ─────────────────────────────────────────────────────────────────────────────

async function fetchUserPrinciplesBlock(
  sessionIds: string[],
  supabase:   ReturnType<typeof createServiceClient>,
): Promise<string> {
  if (sessionIds.length < 3) return ''

  const { data: c0Rows } = await supabase
    .from('examiner_responses')
    .select('response_text')
    .in('session_id', sessionIds)
    .eq('rule_id', 'C0')
    .not('response_text', 'is', null)
    .order('created_at', { ascending: false })
    .limit(5)

  const principles = (c0Rows ?? [])
    .map((r: { response_text: string | null }) => decrypt(r.response_text)?.trim() ?? '')
    .filter((p): p is string => p.length > 10)

  if (principles.length < 3) return ''

  const lines = principles.map(p => `— "${p}"`).join('\n')

  return (
    `STATED SUCCESS CRITERIA — from this user's prior examiner sessions ` +
    `(C0 responses — what they said each decision had to deliver to feel genuinely right):\n${lines}`
  )
}

// ── fetchRecurringRegretBlock (Sprint R_JC — private) ────────────────────────
//
// Identifies recurring regret structures: prior decisions that shared the
// current session's dominant structural profile AND resulted in a
// worse_than_expected outcome.
//
// Match logic (dimensional overlap, not cosine similarity):
//   — Extract high-scoring dims from the current session (score >= 4)
//   — For each bad-outcome session, count shared dims that also score >= 4
//   — A session "matches" if it shares >= OVERLAP_THRESHOLD dims
//   — A regret pattern fires if >= MIN_MATCHES bad-outcome sessions match
//
// Errs toward specificity: only exact high-dimension overlap across multiple
// sessions qualifies. No false positives from loose structural similarity.
//
// Gates: >= 5 sessions in history; >= 2 worse_than_expected outcomes sharing
// the current structural profile.
//
// sessionIds: pre-fetched by fetchUserBiasContext. currentVector: current session's.
// ─────────────────────────────────────────────────────────────────────────────

const REGRET_DIM_LABELS: Record<string, string> = {
  reversibility:                'irreversibility',
  time_pressure:                'time pressure',
  regret_asymmetry:             'regret asymmetry',
  emotional_intensity:          'emotional intensity',
  value_conflict:               'value conflict',
  stakes_magnitude:             'high stakes',
  outcome_uncertainty:          'outcome uncertainty',
  identity_alignment:           'identity alignment',
  upstream_dependency:          'upstream dependency',
  decision_discriminating_info: 'information gaps',
}

async function fetchRecurringRegretBlock(
  sessionIds:    string[],
  currentVector: OntologyScoreMap | null,
  supabase:      ReturnType<typeof createServiceClient>,
): Promise<string> {
  if (!currentVector || sessionIds.length < 5) return ''

  // High-scoring dims in the current session (score >= 4 on 1–5 scale)
  const highDims = Object.entries(currentVector)
    .filter(([, v]) => {
      if (!v || typeof v !== 'object') return false
      return (v as { score?: number }).score !== undefined &&
             (v as { score: number }).score >= 4
    })
    .map(([dim]) => dim)

  if (highDims.length === 0) return ''

  // Fetch bad outcomes + ontology vectors in parallel (both need sessionIds)
  const [badOutcomesResult, ontologyResult] = await Promise.all([
    supabase
      .from('outcomes')
      .select('session_id')
      .in('session_id', sessionIds)
      .eq('outcome_quality', 'worse_than_expected'),
    supabase
      .from('sessions_ontology')
      .select('session_id, ontology_vector')
      .in('session_id', sessionIds)
      .eq('tagger_version', 'v2.0')
      .not('ontology_vector', 'is', null),
  ])

  const badSessionIds = new Set(
    (badOutcomesResult.data ?? []).map((r: { session_id: string }) => r.session_id),
  )

  if (badSessionIds.size < 2) return ''

  const badOntologies = (ontologyResult.data ?? [])
    .filter((r: { session_id: string }) => badSessionIds.has(r.session_id))

  if (badOntologies.length < 2) return ''

  const OVERLAP_THRESHOLD = 2
  const MIN_MATCHES        = 2

  const dimMatchCounts: Record<string, number> = {}
  let matchCount = 0

  for (const row of badOntologies as Array<{ session_id: string; ontology_vector: unknown }>) {
    const vec = row.ontology_vector as OntologyScoreMap | null
    if (!vec) continue

    const sharedHighDims = highDims.filter(dim => {
      const d = vec[dim]
      if (!d || typeof d !== 'object') return false
      return (d as { score?: number }).score !== undefined &&
             (d as { score: number }).score >= 4
    })

    if (sharedHighDims.length >= OVERLAP_THRESHOLD) {
      matchCount++
      for (const dim of sharedHighDims) {
        dimMatchCounts[dim] = (dimMatchCounts[dim] ?? 0) + 1
      }
    }
  }

  if (matchCount < MIN_MATCHES) return ''

  const recurringDims = Object.entries(dimMatchCounts)
    .filter(([, count]) => count >= MIN_MATCHES)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([dim]) => REGRET_DIM_LABELS[dim] ?? dim.replace(/_/g, ' '))

  if (recurringDims.length === 0) return ''

  return (
    `Recurring regret signal — ${matchCount} of this user's prior decisions sharing ` +
    `a similar structural profile (high ${recurringDims.join(', ')}) ended with a ` +
    `worse-than-expected outcome. The current decision carries the same structural signature.`
  )
}

// ── fetchExaminerBiasHint (Sprint R_JC — exported) ───────────────────────────
//
// Returns a compact string of the user's top confirmed distorting biases
// (detection_count >= 3) for injection into Examiner question personalisation.
//
// Used in app/api/examiner/route.ts so the Examiner's diagnostic questions
// are sharper for users with documented blind spots — e.g. a user with confirmed
// fomo_urgency gets a harder push on any time-pressure question.
//
// Exported (not private) so examiner/route.ts can import it directly.
// Returns '' when no confirmed biases exist. Always resolves — non-fatal.
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchExaminerBiasHint(userId: string): Promise<string> {
  if (!userId) return ''
  try {
    const supabase = createServiceClient()
    const { data: rows } = await supabase
      .from('bias_library')
      .select('bias_parameter, detection_count, asymmetry_score_avg')
      .eq('user_id', userId)
      .gte('detection_count', 3)
      .order('asymmetry_score_avg', { ascending: false })
      .limit(2)

    if (!rows || rows.length === 0) return ''

    return (rows as Array<{ bias_parameter: string; detection_count: number; asymmetry_score_avg: number }>)
      .map(r =>
        `${r.bias_parameter} (${r.detection_count} prior detections, severity ${r.asymmetry_score_avg.toFixed(1)}/10)`,
      )
      .join('; ')
  } catch {
    return ''
  }
}

// ── fetchUserBiasContext (Sprint R2, extended Sprint RE) ─────────────────────
//
// Queries bias_library for a user's confirmed + forming longitudinal bias profile
// and returns two injection-ready blocks for persona/route.ts:
//
//   synthesisBlock  — full block injected into the synthesis system prompt.
//                     Includes all bias rows (detection_count >= 1) with all
//                     scores: bias_key, detection_count, severity (asymmetry avg),
//                     confidence_weight, and current signal classification
//                     re-run against this session's ontology vector.
//                     Sprint RE: also appends calibration context and active
//                     contradiction tensions when present.
//                     Ends with a MANDATORY assessment directive covering all
//                     three data sources with explicit plain-language instructions.
//
//   personaAlert    — single sentence injected into each initial persona's
//                     system prompt. Only fires when ≥1 bias is DISTORTING.
//                     Kept terse to avoid overloading 6 parallel persona calls.
//
//   hasAnyBiases    — true if user has any bias row at all (detection_count >= 1).
//
// Sprint RE: all three DB queries (bias_library, sessions+outcomes, contradictions)
//   run in parallel via Promise.all. Return shape and call signature unchanged.
//
// Early-user threshold design:
//   Detection count >= 1 is included (not >= 2) so that users with 1–3 sessions
//   still experience bias-aware reasoning. Language in the blocks is calibrated:
//   - detection_count = 1 → labelled "FORMING (1 detection)" — signals provisional
//   - detection_count >= 2 → labelled "CONFIRMED (N detections)" — full authority
//   The synthesis directive uses "may be active" for forming vs "is present" for confirmed.
//
// Signal re-classification:
//   Each bias signal is re-classified against the CURRENT session's ontology vector,
//   not the historical average. This ensures "DISTORTING" reflects whether the bias
//   is actively harmful in THIS decision's structural context.
//
// User-facing language contract (enforced via MANDATORY directive):
//   Synthesis MUST describe all findings — bias patterns, calibration history,
//   and principle tensions — in plain natural language woven into existing prose.
//   No section headers, no field names, no technical labels. The directive gives
//   synthesis concrete example phrasings for each data type to prevent any
//   mechanical or label-first output reaching the user.
//
// Non-fatal: always returns empty blocks on error — never throws to caller.
// ─────────────────────────────────────────────────────────────────────────────

export interface UserBiasContext {
  synthesisBlock:  string        // full block for synthesis system prompt
  personaAlert:    string | null // one-sentence alert for initial persona system prompts
  hasAnyBiases:    boolean
}

export async function fetchUserBiasContext(
  userId: string,
  ontologyVector: OntologyScoreMap | null,
): Promise<UserBiasContext> {
  const empty: UserBiasContext = { synthesisBlock: '', personaAlert: null, hasAnyBiases: false }
  if (!userId) return empty

  try {
    const supabase = createServiceClient()

    // ── Sprint RE + R_JC: bias/calibration/contradiction + session IDs in parallel
    const [biasResult, calibrationLine, contradictionBlock, sessionIdsResult] = await Promise.all([
      supabase
        .from('bias_library')
        .select('bias_parameter, detection_count, confidence_weight, asymmetry_score_avg, activation_contexts')
        .eq('user_id', userId)
        .gte('detection_count', 1)
        .order('asymmetry_score_avg', { ascending: false })
        .limit(6),
      fetchCalibrationContext(userId, supabase),
      fetchActiveContradictions(userId, supabase),
      // R_JC: session IDs fetched once here, shared by principles + regret queries
      supabase
        .from('sessions')
        .select('id')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(30),
    ])

    const sessionIds = (
      (sessionIdsResult as { data: Array<{ id: string }> | null }).data ?? []
    ).map(s => s.id)

    // R_JC: principles + regret run in parallel (both depend on sessionIds)
    const [principlesBlock, regretBlock] = await Promise.all([
      fetchUserPrinciplesBlock(sessionIds, supabase),
      fetchRecurringRegretBlock(sessionIds, ontologyVector, supabase),
    ])

    const { data: biases, error } = biasResult

    if (error || !biases || biases.length === 0) return empty

    // Re-classify each bias signal against the current session's ontology vector.
    // A minimal BiasScore is constructed — only asymmetry is used by the default
    // branch; specific cases read only from ontologyVector.
    const classified = biases.map(b => {
      const minimalScore: BiasScore = {
        bias_key:           b.bias_parameter as BiasParameterKey,
        prosecutor_score:   0,
        defense_score:      0,
        asymmetry:          b.asymmetry_score_avg as number,
        detected:           true,
        activation_context: {},
        reasoning:          '',
      }
      const signal = classifyBiasSignal(
        b.bias_parameter as BiasParameterKey,
        minimalScore,
        ontologyVector,
      )
      // R9 fix: confirmed raised to >= 3 (was >= 2). Aligns with mirror-fingerprint.ts.
      // synthesis directive uses "may be active" for forming (<3) vs "is present" for confirmed (3+).
      const isConfirmed = (b.detection_count as number) >= 3
      return {
        biasKey:          b.bias_parameter as string,
        detectionCount:   b.detection_count as number,
        confidenceWeight: b.confidence_weight as number,
        asymmetryAvg:     b.asymmetry_score_avg as number,
        isConfirmed,
        signal,
      }
    })

    // ── Build synthesisBlock ──────────────────────────────────────────────
    // All scores included: detection_count + status label, severity (asymmetry avg),
    // confidence_weight, and current signal classification for this decision.
    const biasLines = classified.map(b => {
      const statusLabel = b.isConfirmed
        ? `CONFIRMED (${b.detectionCount} detections)`
        : `FORMING (${b.detectionCount} detection${b.detectionCount !== 1 ? 's' : ''})`
      return `— ${b.biasKey} | ${statusLabel} | severity: ${b.asymmetryAvg.toFixed(1)} | confidence: ${Math.round(b.confidenceWeight * 100)}% | signal: ${b.signal.toUpperCase()}`
    }).join('\n')

    const hasDistorting = classified.some(b => b.signal === 'distorting' && b.isConfirmed)
    const hasForming    = classified.some(b => !b.isConfirmed)

    // ── Bias directive ────────────────────────────────────────────────────
    const biasDirective = hasDistorting
      ? 'Your synthesis MUST assess whether any DISTORTING confirmed pattern from this record appears active in this decision, based on the Council outputs and the decision\'s structural profile. If one is active, name it — but in plain user-facing language only. Do NOT use the bias key name (e.g. "loss_aversion_reversal") verbatim — translate it into a human description the user would immediately understand, such as "a tendency to weigh the regret of missing out more heavily than the risk of a concrete loss." Weave this observation into your existing prose naturally — do NOT create a separate section header like "LONGITUDINAL BIAS ASSESSMENT:" or any similar label. If none are active, say so in a single plain sentence. Omission without acknowledgment is not acceptable.'
      : hasForming
        ? 'Your synthesis should note whether any of these emerging patterns — even the FORMING ones — may be influencing the framing of this decision. Use hedged language ("there may be an early pattern of...") for FORMING entries, translated into plain language — never use the raw bias key name. Weave this into your existing prose; do NOT create a separate section header. Silence on this record is not acceptable.'
        : 'Your synthesis should assess whether any of these patterns appears active in the current decision based on the Council outputs. Describe any pattern in plain language — do not reproduce the bias key names.'

    // ── Calibration directive (Sprint RE) ─────────────────────────────────
    // Only appended when calibration data exists. Instructs synthesis to surface
    // the pattern as a natural human observation — never a labelled data point.
    // Example phrasings are given so synthesis has a concrete template to follow.
    const calibrationDirective = calibrationLine
      ? ' If the confidence calibration history above is relevant to what the Council raised — for example, if the analysis touches on certainty, risk appetite, or how the user is framing their own judgment — surface it as a plain, natural observation woven into your existing prose. Example phrasings: "your track record suggests you tend to be more certain at the moment of deciding than you give yourself credit for in hindsight" or "one thing worth naming is that you\'ve historically entered decisions with a higher degree of certainty than your retrospective view has supported." Do NOT label it as \'calibration data\', do NOT create a separate section for it, and do NOT quote numbers unless they add genuine human meaning in context.'
      : ''

    // ── Contradiction directive (Sprint RE) ───────────────────────────────
    // Only appended when active contradictions exist. Instructs synthesis to
    // surface any relevant tension as a natural conversational reference —
    // never as a structured log entry or section header.
    const contradictionDirective = contradictionBlock
      ? ' If any documented principle–behaviour tension above is directly relevant to this specific decision — meaning this decision touches the same domain or type of commitment — weave a brief, plain reference into your existing prose. Example phrasings: "this sits in some tension with something you\'ve articulated before — a commitment to [x] that hasn\'t always matched the pattern in subsequent decisions" or "worth flagging that you\'ve navigated something similar before, and the gap between what you intended and what happened is worth holding in mind here." Do NOT call it a \'contradiction\', do NOT reproduce the field values verbatim as a list, and do NOT surface it if it is not genuinely applicable to this decision.'
      : ''

    // ── Principles directive (Sprint R_JC) ────────────────────────────────
    // Only appended when C0 principle data exists. Instructs synthesis to check
    // the current framing against the user's own stated success criteria —
    // surfacing alignment or tension as a natural human observation.
    const principlesDirective = principlesBlock
      ? ' If any of the stated success criteria above are relevant to the current decision — either aligned with the framing or in tension with it — weave a brief reference into your existing prose. Example phrasing: \"One thing worth checking against your own stated criteria here: you\'ve said decisions like this need to [paraphrase the criterion] — the current framing [does/does not] seem to honour that.\" Do NOT reproduce the criteria verbatim in full, do NOT create a separate section header, and omit this entirely if genuinely not applicable to what the Council raised.'
      : ''

    // ── Regret directive (Sprint R_JC) ────────────────────────────────────
    // Only appended when a recurring regret pattern exists. Instructs synthesis
    // to surface the track record as a plain human observation — never a
    // prediction or a statistical readout.
    const regretDirective = regretBlock
      ? ' The recurring regret signal above is factual context about this user\'s track record in structurally similar decisions. If the Council\'s analysis touches on the same structural dimensions (irreversibility, urgency, stakes, value conflict), weave a brief, plain observation into your existing prose. Example phrasing: \"Worth naming: a few decisions you\'ve faced with this structural profile haven\'t landed as expected — not from bad analysis, but because [name the mechanism the Council identified]. That pattern is worth holding in mind before this one closes.\" Do NOT frame it as a prediction of failure. Do NOT surface it if the Council analysis does not connect to those structural dimensions. Do NOT create a separate section header.'
      : ''

    // ── Assemble full synthesisBlock ───────────────────────────────────────
    // Structure: bias record → calibration (if present) → contradictions (if present)
    //            → principles (if present) → regret signal (if present) → MANDATORY directive.
    const longitudinalContext = [
      calibrationLine,
      contradictionBlock,
      principlesBlock,
      regretBlock,
    ].filter(Boolean).join('\n\n')

    const synthesisBlock =
`LONGITUDINAL BIAS RECORD — patterns from this user's prior sessions:
${biasLines}

Columns: bias_key | status (CONFIRMED = 3+ detections, FORMING = 1–2 detections) | severity (avg prosecutor–defense asymmetry, 0–10 scale) | confidence (evidence weight: 30% per detection, capped at 100%) | signal (re-classified against THIS decision's structural profile: DISTORTING / NEUTRAL / ADAPTIVE).
${longitudinalContext ? `\n${longitudinalContext}\n` : ''}
MANDATORY SYNTHESIS REQUIREMENT — NON-NEGOTIABLE:
${biasDirective}${calibrationDirective}${contradictionDirective}${principlesDirective}${regretDirective}`

    // ── Build personaAlert ────────────────────────────────────────────────
    // Only the single highest-severity DISTORTING bias fires here, and only if confirmed.
    // Forming patterns are excluded from persona alerts — insufficient evidence to
    // direct advisor reasoning.
    const topDistorting = classified.find(b => b.signal === 'distorting' && b.isConfirmed)
    const personaAlert = topDistorting
      ? `DOCUMENTED BIAS ALERT: This user has a confirmed longitudinal pattern of ${topDistorting.biasKey} (${topDistorting.detectionCount} prior detections, severity ${topDistorting.asymmetryAvg.toFixed(1)}/10, currently DISTORTING for this decision's structural profile). Factor this into your analysis where the evidence supports it.`
      : null

    return { synthesisBlock, personaAlert, hasAnyBiases: true }

  } catch (err) {
    console.error('[BiasContext] fetchUserBiasContext failed:', err)
    return empty
  }
}

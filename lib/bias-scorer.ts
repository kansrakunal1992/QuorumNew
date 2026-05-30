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
// Requires: ANTHROPIC_API_KEY env var
// ─────────────────────────────────────────────────────────────────────────────

import { createCompletion, getProviderInfo } from '@/lib/ai-client'
import { createServiceClient }               from '@/lib/supabase'

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

  const raw   = await createCompletion(prompt, 4000)
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

// ── fetchUserBiasContext (Sprint R2) ─────────────────────────────────────────
//
// Queries bias_library for a user's confirmed + forming longitudinal bias profile
// and returns two injection-ready blocks for persona/route.ts:
//
//   synthesisBlock  — full block injected into the synthesis system prompt.
//                     Includes all bias rows (detection_count >= 1) with all
//                     scores: bias_key, detection_count, severity (asymmetry avg),
//                     confidence_weight, and current signal classification
//                     re-run against this session's ontology vector.
//                     Ends with a MANDATORY assessment directive.
//
//   personaAlert    — single sentence injected into each initial persona's
//                     system prompt. Only fires when ≥1 bias is DISTORTING.
//                     Kept terse to avoid overloading 6 parallel persona calls.
//
//   hasAnyBiases    — true if user has any bias row at all (detection_count >= 1).
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

    // Fetch all bias rows with at least 1 detection, ordered by severity descending.
    // Limit 6 — beyond the top 6 patterns, marginal prompt value drops sharply.
    const { data: biases, error } = await supabase
      .from('bias_library')
      .select('bias_parameter, detection_count, confidence_weight, asymmetry_score_avg, activation_contexts')
      .eq('user_id', userId)
      .gte('detection_count', 1)
      .order('asymmetry_score_avg', { ascending: false })
      .limit(6)

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
      const isConfirmed = (b.detection_count as number) >= 2
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
        : `FORMING (${b.detectionCount} detection)`
      return `— ${b.biasKey} | ${statusLabel} | severity: ${b.asymmetryAvg.toFixed(1)} | confidence: ${Math.round(b.confidenceWeight * 100)}% | signal: ${b.signal.toUpperCase()}`
    }).join('\n')

    const hasDistorting  = classified.some(b => b.signal === 'distorting' && b.isConfirmed)
    const hasForming     = classified.some(b => !b.isConfirmed)

    const directiveBody = hasDistorting
      ? 'Your synthesis MUST assess whether any DISTORTING confirmed pattern from this record appears active in this decision, based on the Council outputs and the decision\'s structural profile. If one is active, name it — but in plain user-facing language only. Do NOT use the bias key name (e.g. "loss_aversion_reversal") verbatim — translate it into a human description the user would immediately understand, such as "a tendency to weigh the regret of missing out more heavily than the risk of a concrete loss." Weave this observation into your existing prose naturally — do NOT create a separate section header like "LONGITUDINAL BIAS ASSESSMENT:" or any similar label. If none are active, say so in a single plain sentence. Omission without acknowledgment is not acceptable.'
      : hasForming
        ? 'Your synthesis should note whether any of these emerging patterns — even the FORMING ones — may be influencing the framing of this decision. Use hedged language ("there may be an early pattern of...") for FORMING entries, translated into plain language — never use the raw bias key name. Weave this into your existing prose; do NOT create a separate section header. Silence on this record is not acceptable.'
        : 'Your synthesis should assess whether any of these patterns appears active in the current decision based on the Council outputs. Describe any pattern in plain language — do not reproduce the bias key names.'

    const synthesisBlock =
`LONGITUDINAL BIAS RECORD — patterns from this user's prior sessions:
${biasLines}

Columns: bias_key | status (CONFIRMED = 2+ detections, FORMING = 1 detection) | severity (avg prosecutor–defense asymmetry, 0–10 scale) | confidence (evidence weight: 30% per detection, capped at 100%) | signal (re-classified against THIS decision's structural profile: DISTORTING / NEUTRAL / ADAPTIVE).

MANDATORY SYNTHESIS REQUIREMENT — NON-NEGOTIABLE:
${directiveBody}`

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

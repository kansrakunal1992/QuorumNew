// lib/structural-retrieval.ts
// ── Sprint 5: Structural Retrieval Engine ────────────────────────────────────
// ── Sprint 15c: Upgraded to 14-dim ontology vector scoring ───────────────────
// ── Sprint R1: Tiered scoring · full sub-scores · 5-persona injection ────────
//
// SCORING MODES
// ─────────────
// V2.0 path (both sessions have ontology_vector from tagger v2.0):
//   Confidence-weighted cosine similarity across 14 dimensions with
//   differential weights for the three ⭐ research-priority dimensions.
//
//   Why cosine, not Euclidean:
//   The cross-domain detection moat (PE deal ↔ career pivot sharing the same
//   structural architecture) requires measuring profile SHAPE — the pattern of
//   which dimensions are high vs low relative to each other — not absolute
//   magnitude gaps. Euclidean penalises magnitude differences that are
//   irrelevant to structural similarity. Cosine is correct here.
//
//   Confidence weighting:
//   effective[i] = score[i] × confidence[i] × dim_weight[i]
//   Dimensions the tagger was uncertain about contribute less to the match.
//
//   ⭐ Differential weights (research doc v0.10 — highest product leverage):
//   identity_alignment:  1.5× (D12 — "who do I want to be?" decisions)
//   regret_asymmetry:    1.5× (D13 — one type of mistake structurally worse)
//   upstream_dependency: 1.5× (D14 — prior question blocks this one)
//   All other dimensions: 1.0×
//
//   Score mapping:
//   Cosine similarity is always in [0, 1] for positive-valued vectors.
//   Realistic range for real decisions: ~[0.65, 1.0].
//   Map [0.65, 1.0] → [0, 100]:
//     total = max(0, round((cos_sim − 0.65) / 0.35 × 100))
//   Threshold: ≥ 45/100 → cos_sim ≥ 0.808
//
// V1.0 path (either session lacks ontology_vector):
//   Original 5-dimension categorical scoring (100 pts). Unchanged.
//   Mixed comparisons (current v2.0 vs past v1.0) also use this path —
//   categorical fields are retained on all sessions regardless of tagger version.
//
// CORPUS NOTE (research doc v0.10):
//   "Target: 80+ cases before live retrieval." Currently at ~60.
//   Implementation proceeds; threshold set conservatively (≥ 45/100).
//   Vector weights (1.5× for ⭐ dims) to be validated as corpus grows.
//   "Stage 5 dimension weights cannot be tested until retrieval uses the
//   scored vector." — This implementation unblocks that research validation.
//
// MINIMUM SESSIONS: 5 past complete-tagged sessions required to activate.
//
// Sprint R1 changes:
//
//   getMatchTier(score, pastSessionCount)
//     Corpus-adaptive tiering. Below 250 past sessions → 3 tiers. At 250+ → 5 tiers.
//     3 tiers: HIGH-CONFIDENCE ≥80 · MODERATE 60–79 · BORDERLINE 45–59
//     5 tiers: STRONG ≥88 · HIGH 75–87 · MODERATE 60–74 · BORDERLINE 50–59 · WEAK 45–49
//     Each tier carries a label + LLM directive calibrated to match quality.
//     Rationale for 250 threshold: below it, cosine-to-100 mapping lacks
//     distributional resolution to distinguish a 63 from a 71. Above it,
//     five boundary points map to roughly equal expected population per tier.
//     A 6th tier would add a MARGINAL band (45–49) with identical advisory
//     treatment to WEAK — no differentiated instruction is possible.
//
//   buildContextBlock(matches, pastSessionCount)
//     New pastSessionCount param drives getMatchTier() tier selection.
//     Injects ALL structural sub-scores per match:
//       Vector path: top_matching_dims mapped to DIM_LABELS (human-readable)
//                    + raw cosine percentage.
//       Categorical: all 5 sub-scores with their max values.
//     Appends NON-NEGOTIABLE enforcement block when max score ≥ 80.
//     Falls back to soft instruction for lower scores.
//
//   getPersonaStructuralDirective(personaKey)
//     New export. Returns a persona-specific 1-sentence instruction for
//     each of the 5 personas receiving structural context. Called from
//     persona/route.ts at structuralBlock assembly — appended after the
//     shared context block so each persona gets a tailored usage mandate.
//     Returns '' for personas not in PERSONAS_WITH_STRUCTURAL_CONTEXT.
//
//   PERSONAS_WITH_STRUCTURAL_CONTEXT
//     Expanded from 3 → 5: contrarian + stakeholder_mirror added.
//     contrarian:       past failures under same structure = strongest attack surface.
//     stakeholder_mirror: recurring relationship patterns visible in structural record.
//     competitor excluded: mandate is external market landscape; personal history
//     adds noise. synthesis/decision_brief excluded: receive council outputs, not
//     structural pre-briefing.
//
//   retrieveStructuralMatches()
//     Passes pastSnapshots.length to buildContextBlock(). No other changes.
// ─────────────────────────────────────────────────────────────────────────────

import { createCompletion } from '@/lib/ai-client'
import { DIM_WEIGHTS }      from '@/lib/similarity'   // Additional Risk C: shared weight config

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

// ⭐ Dimension weights imported from lib/similarity.ts (Additional Risk C).
// DIM_WEIGHTS is the single source of truth shared with benchmark/route.ts.
// Defining it locally here previously caused mathematical inconsistency between
// structural retrieval (which used weights) and peer benchmark (which did not).

// Human-readable labels for annotation prompt and context block injection
const DIM_LABELS: Record<VectorDimName, string> = {
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

// ── OntologySnapshot ──────────────────────────────────────────────────────────

export interface OntologySnapshot {
  session_id:    string
  decision_text: string
  created_at:    string
  // V1.0 categorical fields (retained on all sessions including v2.0)
  decision_type_primary:   string
  decision_type_secondary: string[]
  stakes_reversibility:    string
  stakes_bearer:           string
  stakes_timeline:         string
  has_stated_deadline:     boolean
  deadline_source:         string
  deadline_credibility:    string
  counterparty_present:    boolean
  counterparty_alignment:  string
  relationship_type:       string
  instrumental_weight:     number
  constitutive_weight:     number
  dominant_emotion:        string
  // V2.0 additions — present when tagger_version = 'v2.0'
  tagger_version?:  string              // 'v1.0' | 'v2.0'; defaults to 'v1.0'
  ontology_vector?: OntologyVector | null
  // Joined from sessions/outcomes
  outcome?: {
    what_decided:   string
    council_helped: string
  } | null
}

// ── ScoreBreakdown ────────────────────────────────────────────────────────────

export interface ScoreBreakdown {
  // V1.0 categorical dimensions (0 when scoring_mode = 'vector')
  decision_type: number   // 0–30
  register:      number   // 0–25
  stakes:        number   // 0–20
  counterparty:  number   // 0–15
  time_pressure: number   // 0–10
  // Unified 0–100 score in both modes
  total:         number
  // V2.0 additions
  scoring_mode:        'vector' | 'categorical'
  vector_similarity?:  number      // raw cosine (0–1); v2.0 only
  top_matching_dims?:  string[]    // top 3 dims by weighted contribution; v2.0 only
}

export interface StructuralMatch {
  session_id:       string
  decision_text:    string
  created_at:       string
  structural_score: number
  score_breakdown:  ScoreBreakdown
  annotation:       string
  outcome?: {
    what_decided:   string
    council_helped: string
  } | null
}

export interface StructuralRetrievalResult {
  matches:            StructuralMatch[]
  context_block:      string
  session_count_used: number
  threshold_met:      boolean
}

// ── V2.0 Vector Scorer ────────────────────────────────────────────────────────
// Confidence-weighted cosine similarity with ⭐ dimension multipliers.

function scoreVectorSimilarity(
  aVec: OntologyVector,
  bVec: OntologyVector,
): { similarity: number; total: number; top_dims: VectorDimName[] } {
  // effective[i] = score[i] × confidence[i] × dim_weight[i]
  // Missing dims default to score=3 (midpoint), confidence=0.3 (low trust)
  const aEff = VECTOR_DIMS.map(d => {
    const dim = aVec[d]
    return (dim ? dim.score * dim.confidence : 3 * 0.3) * DIM_WEIGHTS[d]
  })
  const bEff = VECTOR_DIMS.map(d => {
    const dim = bVec[d]
    return (dim ? dim.score * dim.confidence : 3 * 0.3) * DIM_WEIGHTS[d]
  })

  // Cosine similarity
  let dot = 0, magA = 0, magB = 0
  const contributions: number[] = []
  for (let i = 0; i < VECTOR_DIMS.length; i++) {
    const c = aEff[i] * bEff[i]
    contributions.push(c)
    dot  += c
    magA += aEff[i] * aEff[i]
    magB += bEff[i] * bEff[i]
  }
  const similarity = (magA === 0 || magB === 0)
    ? 0
    : dot / (Math.sqrt(magA) * Math.sqrt(magB))

  // Map [0.65, 1.0] → [0, 100]
  const total = Math.max(0, Math.round((similarity - 0.65) / 0.35 * 100))

  // Top 3 contributing dimensions
  const ranked = contributions
    .map((c, i) => ({ dim: VECTOR_DIMS[i], c }))
    .sort((a, b) => b.c - a.c)
  const top_dims = ranked.slice(0, 3).map(x => x.dim)

  return { similarity, total, top_dims }
}

// ── V1.0 Categorical Scorer ───────────────────────────────────────────────────
// Original logic (100 pts, 5 dimensions). Not modified.

function scoreCategorical(
  current: OntologySnapshot,
  past:    OntologySnapshot,
): Omit<ScoreBreakdown, 'scoring_mode'> {

  // 1. Decision Type (0–30)
  let decision_type = 0
  const pastSecondary = past.decision_type_secondary ?? []
  const currSecondary = current.decision_type_secondary ?? []
  if (current.decision_type_primary === past.decision_type_primary) {
    decision_type = 30
  } else if (pastSecondary.includes(current.decision_type_primary)) {
    decision_type = 18
  } else if (currSecondary.includes(past.decision_type_primary)) {
    decision_type = 12
  } else {
    const transitionFamily  = ['transition', 'delegation', 'renunciation']
    const acquisitionFamily = ['acquisition', 'commitment', 'allocation']
    const governanceFamily  = ['governance', 'commitment', 'delegation']
    for (const family of [transitionFamily, acquisitionFamily, governanceFamily]) {
      if (family.includes(current.decision_type_primary) && family.includes(past.decision_type_primary)) {
        decision_type = 6
        break
      }
    }
  }

  // 2. Register Proximity (0–25)
  let register = 0
  const regDist = Math.abs(
    (current.instrumental_weight ?? 0.5) - (past.instrumental_weight ?? 0.5)
  )
  if      (regDist < 0.08) register = 25
  else if (regDist < 0.15) register = 20
  else if (regDist < 0.22) register = 14
  else if (regDist < 0.30) register = 8

  // 3. Stakes Architecture (0–20)
  let stakes = 0
  if (current.stakes_reversibility === past.stakes_reversibility) stakes += 8
  if (current.stakes_bearer        === past.stakes_bearer)        stakes += 6
  if (current.stakes_timeline      === past.stakes_timeline)      stakes += 6

  // 4. Counterparty Structure (0–15)
  let counterparty = 0
  if (current.counterparty_present === past.counterparty_present) counterparty += 5
  if (current.counterparty_present && past.counterparty_present) {
    if (current.counterparty_alignment === past.counterparty_alignment) counterparty += 5
    if (current.relationship_type      === past.relationship_type)      counterparty += 5
  }

  // 5. Time Pressure Pattern (0–10)
  let time_pressure = 0
  if (current.has_stated_deadline === past.has_stated_deadline) time_pressure += 2
  if (current.has_stated_deadline && past.has_stated_deadline) {
    if (current.deadline_source      === past.deadline_source)      time_pressure += 5
    if (current.deadline_credibility === past.deadline_credibility) time_pressure += 3
  }

  return {
    decision_type, register, stakes, counterparty, time_pressure,
    total: decision_type + register + stakes + counterparty + time_pressure,
  }
}

// ── Routing scorer (public export) ───────────────────────────────────────────
// Both sessions must have ontology_vector to use the v2.0 path.
// Mixed comparisons (current v2.0 vs past v1.0) fall back to categorical.

export function scoreStructuralSimilarity(
  current: OntologySnapshot,
  past:    OntologySnapshot,
): ScoreBreakdown {
  const bothV2 = (
    current.tagger_version === 'v2.0' &&
    past.tagger_version    === 'v2.0' &&
    current.ontology_vector != null   &&
    past.ontology_vector    != null
  )

  if (bothV2) {
    const { similarity, total, top_dims } = scoreVectorSimilarity(
      current.ontology_vector as OntologyVector,
      past.ontology_vector    as OntologyVector,
    )
    return {
      decision_type: 0, register: 0, stakes: 0, counterparty: 0, time_pressure: 0,
      total,
      scoring_mode:       'vector',
      vector_similarity:  Math.round(similarity * 1000) / 1000,
      top_matching_dims:  top_dims,
    }
  }

  // V1.0 or mixed → categorical
  const cat = scoreCategorical(current, past)
  return { ...cat, scoring_mode: 'categorical' }
}

// ── Annotation Engine ─────────────────────────────────────────────────────────
// Explains WHY two decisions are structurally similar in plain language.
// Prompt adapts based on scoring mode — v2.0 surfaces the top matching dims.

async function annotateMatch(
  currentDecision: string,
  pastDecision:    string,
  breakdown:       ScoreBreakdown,
  pastCreatedAt:   string,
): Promise<string> {
  const dateLabel = new Date(pastCreatedAt).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'long', year: 'numeric',
  })

  let scoringContext: string
  if (breakdown.scoring_mode === 'vector' && breakdown.top_matching_dims?.length) {
    const dimLines = breakdown.top_matching_dims
      .map(d => `- ${DIM_LABELS[d as VectorDimName] ?? d}`)
      .join('\n')
    scoringContext = `STRUCTURAL DIMENSIONS DRIVING THE MATCH (14-dim ontology vector, ⭐ weighted):
Cosine similarity: ${((breakdown.vector_similarity ?? 0) * 100).toFixed(1)}% → ${breakdown.total}/100
Top 3 matching dimensions:
${dimLines}`
  } else {
    scoringContext = `STRUCTURAL MATCH SCORES (out of max):
- Decision type alignment: ${breakdown.decision_type}/30
- Register (instrumental/constitutive) proximity: ${breakdown.register}/25
- Stakes architecture: ${breakdown.stakes}/20
- Counterparty structure: ${breakdown.counterparty}/15
- Time pressure pattern: ${breakdown.time_pressure}/10
- Total: ${breakdown.total}/100`
  }

  const prompt = `You are the Quorum Structural Memory system. Your job is to write a precise 2-3 sentence explanation of why two decisions share structural similarity — not surface similarity, but the same underlying decision architecture.

CURRENT DECISION:
"${currentDecision.slice(0, 400)}"

PAST DECISION (from ${dateLabel}):
"${pastDecision.slice(0, 400)}"

${scoringContext}

Write 2-3 sentences that explain what is structurally similar about these two decisions. Focus on the underlying mechanism — not the surface topic. Use precise language. Do not begin with "Both decisions" or "These decisions". Start with what the structure reveals about the decision-maker's situation. Keep it under 80 words.`

  try {
    const text = await createCompletion(prompt, 200, { provider: 'anthropic' })
    return text.trim()
  } catch (err) {
    console.error('[StructuralRetrieval] Annotation failed:', err)
    if (breakdown.scoring_mode === 'vector' && breakdown.top_matching_dims?.length) {
      const topDim = DIM_LABELS[breakdown.top_matching_dims[0] as VectorDimName] ?? 'structural profile'
      return `This past decision shares a structurally similar ${topDim} with the current one. The vector similarity of ${((breakdown.vector_similarity ?? 0) * 100).toFixed(0)}% indicates the same underlying decision architecture, not surface topic overlap.`
    }
    const dominant = breakdown.decision_type >= 25
      ? 'the same type of decision architecture'
      : breakdown.register >= 20
        ? 'the same balance of instrumental and values-based reasoning'
        : 'similar stakes structure and counterparty dynamics'
    return `This past decision shares ${dominant} with the current one. The structural match score of ${breakdown.total}/100 indicates meaningful overlap in how the decision is organised, not just what it is about.`
  }
}

// ── Match Tier System (Sprint R1) ─────────────────────────────────────────────
//
// Corpus-adaptive: 3 tiers below 250 past sessions, 5 tiers at 250+.
//
// 3-tier mode (< 250 sessions):
//   At small corpus, cosine-to-100 lacks distributional resolution to
//   meaningfully distinguish a 63 from a 71. Three authority levels
//   (near-certain / reference / cautious) map cleanly onto how an advisor
//   should weight the historical data point.
//
// 5-tier mode (≥ 250 sessions):
//   At corpus maturity, scores span the full 45–100 range empirically.
//   A 91/100 match (near-identical across all 14 dims) is qualitatively
//   different from a 76/100 (same class, different sub-structure).
//   Five tiers provide actionable precision without false granularity.
//   Boundary points calibrated to ~equal expected population per tier.
//   A 6th tier at 45–49 would carry identical advisory treatment to WEAK
//   — no differentiated instruction is possible at that resolution.

interface MatchTier {
  label:     string  // injected into the context block header
  directive: string  // tells the LLM how to weight this match
}

function getMatchTier(score: number, pastSessionCount: number): MatchTier {
  if (pastSessionCount >= 250) {
    // ── 5-tier mode ──────────────────────────────────────────────────────────
    if (score >= 88) return {
      label:     'STRONG MATCH',
      directive: 'Exceptionally close structural architecture — the closest analogue in this user\'s record. Treat as the primary comparable for your analysis. Weight it heavily.',
    }
    if (score >= 75) return {
      label:     'HIGH MATCH',
      directive: 'Strong structural overlap with meaningful alignment across multiple dimensions. Weight as a near-direct comparable, noting any specific divergences.',
    }
    if (score >= 60) return {
      label:     'MODERATE MATCH',
      directive: 'Meaningful structural similarity with partial dimensional overlap. Use as a reference point — explicitly note where the current decision diverges before drawing parallels.',
    }
    if (score >= 50) return {
      label:     'BORDERLINE MATCH',
      directive: 'Partial structural overlap — some architecture shared, not the same configuration. Reference with caution. Name what is similar and what differs before drawing any parallel.',
    }
    return {
      label:     'WEAK MATCH',
      directive: 'Faint structural echo only. Use only if no stronger match exists and the specific overlap is directly relevant to your analytical angle. Do not force the parallel.',
    }
  }

  // ── 3-tier mode (default, < 250 sessions) ────────────────────────────────
  if (score >= 80) return {
    label:     'HIGH-CONFIDENCE MATCH',
    directive: 'Near-identical structural architecture. Weight this historical pattern heavily — treat it as a direct comparable, not merely a reference.',
  }
  if (score >= 60) return {
    label:     'MODERATE MATCH',
    directive: 'Structurally similar with meaningful overlap. Use as a reference point — note where the current situation diverges before drawing the parallel.',
  }
  return {
    label:     'BORDERLINE MATCH',
    directive: 'Loose structural echo — some architecture in common, not identical. Reference cautiously, and explicitly name what differs before drawing any conclusion.',
  }
}

// ── Main retrieval function ───────────────────────────────────────────────────

export async function retrieveStructuralMatches(
  currentSnapshot: OntologySnapshot,
  pastSnapshots:   OntologySnapshot[],
): Promise<StructuralRetrievalResult> {
  // R11 fix: configurable via Railway env vars (no deploy needed to tune).
  // Defaults match the original heuristic values. Re-evaluate at 100 + 250 sessions.
  const MATCH_THRESHOLD = Number(process.env.MATCH_THRESHOLD ?? '45')
  const MIN_SESSIONS    = Number(process.env.MIN_SESSIONS    ?? '5')
  const MAX_MATCHES     = 2

  if (pastSnapshots.length < MIN_SESSIONS) {
    return {
      matches:            [],
      context_block:      '',
      session_count_used: pastSnapshots.length,
      threshold_met:      false,
    }
  }

  const scored = pastSnapshots
    .map(past => ({
      past,
      breakdown: scoreStructuralSimilarity(currentSnapshot, past),
    }))
    .filter(s => s.breakdown.total >= MATCH_THRESHOLD)
    .sort((a, b) => b.breakdown.total - a.breakdown.total)
    .slice(0, MAX_MATCHES)

  if (scored.length === 0) {
    return {
      matches:            [],
      context_block:      '',
      session_count_used: pastSnapshots.length,
      threshold_met:      false,
    }
  }

  // Annotate matches in parallel
  const annotated = await Promise.all(
    scored.map(async ({ past, breakdown }) => {
      const annotation = await annotateMatch(
        currentSnapshot.decision_text,
        past.decision_text,
        breakdown,
        past.created_at,
      )
      return {
        session_id:       past.session_id,
        decision_text:    past.decision_text,
        created_at:       past.created_at,
        structural_score: breakdown.total,
        score_breakdown:  breakdown,
        annotation,
        outcome:          past.outcome ?? null,
      } as StructuralMatch
    })
  )

  return {
    matches:            annotated,
    // Sprint R1: pastSnapshots.length passed so buildContextBlock selects tier mode
    context_block:      buildContextBlock(annotated, pastSnapshots.length),
    session_count_used: pastSnapshots.length,
    threshold_met:      true,
  }
}

// ── Context block builder (Sprint R1) ────────────────────────────────────────
//
// Changes from original buildContextBlock():
//   1. pastSessionCount param → drives getMatchTier() tier mode selection.
//   2. Tier label + per-match directive replace the generic modeLabel string.
//   3. ALL structural sub-scores injected per match:
//        Vector: top_matching_dims → DIM_LABELS (human-readable) + cosine %.
//        Categorical: all 5 sub-scores with max values.
//   4. NON-NEGOTIABLE enforcement block when max score ≥ 80.
//      Mirrors the pushback protocol pattern — named, consequence-framed.
//      Soft instruction retained for scores < 80.

function buildContextBlock(matches: StructuralMatch[], pastSessionCount: number): string {
  if (matches.length === 0) return ''

  const maxScore = Math.max(...matches.map(m => m.structural_score))

  const blocks = matches.map((m, i) => {
    const dateLabel = new Date(m.created_at).toLocaleDateString('en-IN', {
      day: 'numeric', month: 'long', year: 'numeric',
    })
    const snippet = m.decision_text.length > 250
      ? m.decision_text.slice(0, 250) + '…'
      : m.decision_text

    const outcomeBlock = m.outcome?.what_decided
      ? `\nWhat was decided: "${m.outcome.what_decided}"`
      : '\nOutcome: Not yet logged.'

    // Sprint R1: corpus-adaptive tier label + per-match directive
    const tier = getMatchTier(m.structural_score, pastSessionCount)

    // Sprint R1: full sub-score block — all scores always fed in
    let subScoreBlock: string
    if (m.score_breakdown.scoring_mode === 'vector') {
      const dimLines = (m.score_breakdown.top_matching_dims ?? [])
        .map(d => DIM_LABELS[d as VectorDimName] ?? d)
        .join(' · ')
      const cosSim = m.score_breakdown.vector_similarity != null
        ? ` (cosine ${(m.score_breakdown.vector_similarity * 100).toFixed(1)}%)`
        : ''
      subScoreBlock = dimLines
        ? `\nTop matching dimensions${cosSim}: ${dimLines}`
        : ''
    } else {
      const b = m.score_breakdown
      subScoreBlock = `\nSub-scores: decision type ${b.decision_type}/30 · register ${b.register}/25 · stakes ${b.stakes}/20 · counterparty ${b.counterparty}/15 · time pressure ${b.time_pressure}/10`
    }

    return `STRUCTURAL MATCH ${i + 1} — ${tier.label} (${m.structural_score}/100 · ${dateLabel}):
${tier.directive}

"${snippet}"
${outcomeBlock}${subScoreBlock}
Why this is structurally relevant: ${m.annotation}`
  }).join('\n\n---\n\n')

  // Sprint R1: non-negotiable enforcement for HIGH-CONFIDENCE / STRONG / HIGH (≥ 80)
  const enforcementBlock = maxScore >= 80
    ? `\n\nNON-NEGOTIABLE — STRUCTURAL ENGAGEMENT REQUIRED:
The match above is scored ≥80/100. Your response must explicitly engage with this structural record. Acceptable: confirm the parallel and its implication for this decision, name specifically where the current decision diverges from the historical pattern, or draw the direct consequence for your analytical angle. Producing a response that could have been written without this record is a protocol violation.`
    : `\n\nINSTRUCTION: Use this structural memory if it genuinely illuminates your analysis. Reference it as "you have faced a structurally similar decision before" rather than repeating the past decision's details verbatim. Do not force the parallel if it does not apply to your angle. If it does apply, use it as one specific data point — not the entire frame.`

  return `STRUCTURAL MEMORY — PATTERN CONTEXT:
The Quorum system has identified ${matches.length === 1 ? 'a past decision' : 'past decisions'} by this user that share structural architecture with the current decision. This is not surface similarity — it is the same underlying decision type, register, and stakes pattern.

${blocks}
${enforcementBlock}`
}

// ── Persona-specific structural directive (Sprint R1) ─────────────────────────
//
// Returns a one-sentence instruction telling each persona HOW to use the
// structural memory block relative to their specific analytical mandate.
//
// Design: buildContextBlock() produces one shared block reused across personas.
// Persona-specific directives are appended at injection time in persona/route.ts
// — after the shared block is received, before it hits the system prompt.
// This avoids building N separate blocks and keeps structural-retrieval.ts clean.
//
// Returns '' for any persona not in PERSONAS_WITH_STRUCTURAL_CONTEXT — safe to
// call for any personaKey without an existence check at the call site.

export function getPersonaStructuralDirective(personaKey: string): string {
  const directives: Record<string, string> = {
    pattern_analyst:
      'Use this structural memory to identify the recurring pattern architecture — what configuration repeats across these decisions, and what does its recurrence reveal about this person\'s decision-making?',
    risk_architect:
      'If this structural record contains a prior failure, near-failure, or regret under this configuration, treat it as your primary pre-mortem input — the most specific failure data available for this structural type.',
    elder:
      'Use this structural recurrence to ground your temporal framing — this configuration has appeared before in this person\'s arc, and that repetition is itself the signal worth naming.',
    contrarian:
      'If this record shows a prior decision that went wrong or produced regret under structurally similar conditions, make it your sharpest line of challenge — past failure under the same structure is your strongest adversarial evidence.',
    stakeholder_mirror:
      'If this record shows a recurring stakeholder dynamic, relationship pattern, or interpersonal architecture, use it to sharpen your analysis — recurring relational structures often indicate a deeper pattern the decision-maker hasn\'t yet named.',
  }
  return directives[personaKey] ?? ''
}

// ── Personas that receive structural context (Sprint R1 expansion) ────────────
//
// Original (Sprint 5): pattern_analyst, risk_architect, elder
//
// Sprint R1 additions:
//   contrarian        — past failures under same structure = strongest attack surface.
//   stakeholder_mirror — recurring relationship patterns visible in structural record.
//
// Intentionally excluded:
//   competitor        — mandate is external market landscape; personal decision
//                       history adds noise, not signal.
//   synthesis         — receives council outputs, not structural pre-briefing.
//   decision_brief    — summary format; structural context would distort brevity.

export const PERSONAS_WITH_STRUCTURAL_CONTEXT = new Set([
  'pattern_analyst',
  'risk_architect',
  'elder',
  'contrarian',         // Sprint R1
  'stakeholder_mirror', // Sprint R1
])

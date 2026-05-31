// lib/mirror-fingerprint.ts
// ── Mirror Module: Fingerprint Data Layer (Sprint 7b, updated Sprint 20 / R2) ──
//
// Sprint 20 additions:
//   - signalType: BiasSignalType | null  — predominant signal across all sessions
//     for this bias (distorting / neutral / adaptive). Derived from signal_type
//     stored inside activation_contexts per session by bias-score route.
//     Uses getPredominantSignal() from bias-scorer.ts — no new DB column.
//   - sessionIds: string[]  — passed through from bias_library.session_ids
//     for the source-decision drawer in BiasFingerprint.tsx / PatternTile.tsx.
//
// Sprint R2 additions:
//   - Forming tiles (detection_count = 1) now receive AI-generated content.
//     Previously they returned activationSummary: null and a static fallback
//     interpretation. Early users (1–3 sessions) would see empty tiles.
//     Fix: generateFingerprintContent() now runs for both confirmed AND forming
//     rows, using appropriately hedged language for single-detection entries.
//   - generateFingerprintContent() receives a new `formingBiasRows` param.
//     The prompt distinguishes forming from confirmed so the AI uses hedged
//     language ("may reflect an emerging tendency") for 1-detection patterns.
// ─────────────────────────────────────────────────────────────────────────────

import { createServiceClient } from '@/lib/supabase'
import { createCompletion }    from '@/lib/ai-client'
import { MIRROR_FINGERPRINT_NARRATIVE } from '@/lib/personas'
import { BIAS_PARAMETERS, getPredominantSignal } from '@/lib/bias-scorer'
import type { FingerprintTile, FingerprintData } from '@/lib/types'

// ── Bias label lookup ─────────────────────────────────────────────────────────

function getBiasLabel(key: string): string {
  const found = BIAS_PARAMETERS.find(b => b.key === key)
  if (found) return found.label
  return key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

// ── Confidence dots mapping ───────────────────────────────────────────────────

function getConfidenceDots(detectionCount: number): 1 | 2 | 3 {
  if (detectionCount >= 3) return 3
  if (detectionCount >= 2) return 2
  return 1
}

// ── Plain-English label maps ──────────────────────────────────────────────────

const DECISION_TYPE_LABELS: Record<string, string> = {
  commitment:   'when committing to something hard to reverse',
  allocation:   'when deciding how to allocate money or resources',
  transition:   'when considering a major life or career change',
  relationship: "when the decision involves people you're close to",
  hiring:       'when making a people or team decision',
  investment:   'when evaluating a financial investment',
  negotiation:  'when negotiating terms with another party',
  exit:         'when considering leaving or unwinding something',
  partnership:  'when entering or exiting a partnership',
}

const EMOTION_LABELS: Record<string, string> = {
  ambivalence:  'you feel torn or uncertain about the direction',
  urgency:      'you feel pressure to decide quickly',
  obligation:   'you feel a duty to someone else',
  fear:         'there is a fear of getting it wrong',
  excitement:   'the upside is emotionally compelling',
  regret:       'past decisions are weighing on the current one',
  anxiety:      'the stakes feel personally threatening',
  confidence:   'you feel unusually certain about the outcome',
  resignation:  'you feel like the decision has already been made for you',
}

function humanizeActivationSummary(
  activationContexts: Record<string, unknown>,
  detectionCount: number,
): string | null {
  if (!activationContexts || typeof activationContexts !== 'object') return null

  const entries = Object.values(activationContexts) as Array<Record<string, unknown>>
  if (entries.length === 0) return null

  const typeCounts:    Record<string, number> = {}
  const emotionCounts: Record<string, number> = {}
  let urgencyCount      = 0
  let counterpartyCount = 0

  for (const ctx of entries) {
    const dt = ctx.decision_type as string | null
    const em = ctx.emotional_signature as string | null
    if (dt) typeCounts[dt]    = (typeCounts[dt]    ?? 0) + 1
    if (em) emotionCounts[em] = (emotionCounts[em] ?? 0) + 1
    if (ctx.urgency_present)      urgencyCount++
    if (ctx.counterparty_present) counterpartyCount++
  }

  const topType    = Object.entries(typeCounts).sort((a, b) => b[1] - a[1])[0]?.[0]
  const topEmotion = Object.entries(emotionCounts).sort((a, b) => b[1] - a[1])[0]?.[0]

  const conditions: string[] = []

  if (topType) {
    conditions.push(
      DECISION_TYPE_LABELS[topType]
        ?? `when facing a ${topType.replace(/_/g, ' ')} decision`,
    )
  }
  if (topEmotion) {
    conditions.push(
      EMOTION_LABELS[topEmotion]
        ?? `when ${topEmotion.replace(/_/g, ' ')} is present`,
    )
  }
  if (!topEmotion && urgencyCount > entries.length / 2) {
    conditions.push('you feel pressure to decide quickly')
  }
  if (!topType && counterpartyCount > entries.length / 2) {
    conditions.push('another party is setting the terms')
  }

  if (detectionCount < 3 || conditions.length === 0) return null

  if (conditions.length === 1) {
    return `Most active ${conditions[0]}`
  }
  return `Most active ${conditions[0]} and ${conditions[1]}`
}

// ── AI narrative + interpretation generation ──────────────────────────────────
//
// Sprint R2: generateFingerprintContent() now accepts both confirmed and forming
// bias rows. The prompt template distinguishes them so the AI uses appropriately
// hedged language for 1-detection entries.
//
// This ensures users with 1–3 sessions (where all or most biases are "forming")
// still receive AI-generated activation summaries and interpretations rather
// than empty tiles with null summaries.

interface AIFingerprintResponse {
  narrative: string | null
  tile_interpretations: Array<{
    bias_key: string
    interpretation: string
    activation_summary: string
  }>
}

async function generateFingerprintContent(
  confirmedBiasRows: Array<{
    biasKey: string
    biasLabel: string
    detectionCount: number
    asymmetryAvg: number
    activationContexts: Record<string, unknown>
  }>,
  formingBiasRows: Array<{
    biasKey: string
    biasLabel: string
    detectionCount: number
    asymmetryAvg: number
    activationContexts: Record<string, unknown>
  }>,
  decisionTypeDistribution: string,
  sessionCount: number,
  emotionPatterns: string,
): Promise<AIFingerprintResponse> {
  const confirmedBiasesJson = confirmedBiasRows.map(b => ({
    bias_key:        b.biasKey,
    label:           b.biasLabel,
    detections:      b.detectionCount,
    asymmetry_avg:   b.asymmetryAvg,
    status:          'confirmed',
    sample_contexts: Object.values(b.activationContexts).slice(0, 3),
  }))

  // Sprint R2: forming biases included with 'forming' status so AI generates
  // hedged content ("may reflect an emerging tendency") instead of silence.
  const formingBiasesJson = formingBiasRows.map(b => ({
    bias_key:        b.biasKey,
    label:           b.biasLabel,
    detections:      b.detectionCount,
    asymmetry_avg:   b.asymmetryAvg,
    status:          'forming',
    sample_contexts: Object.values(b.activationContexts).slice(0, 1),
  }))

  const allBiasesJson = [...confirmedBiasesJson, ...formingBiasesJson]

  // Build the prompt from the existing MIRROR_FINGERPRINT_NARRATIVE template,
  // then append the forming-tile instruction so the AI knows how to handle them.
  const basePrompt = MIRROR_FINGERPRINT_NARRATIVE
    .replace('{{CONFIRMED_BIASES}}',  JSON.stringify(allBiasesJson, null, 2))
    .replace('{{DECISION_TYPES}}',    decisionTypeDistribution)
    .replace('{{SESSION_COUNT}}',     String(sessionCount))
    .replace('{{EMOTION_PATTERNS}}',  emotionPatterns)

  // Append forming-tile guidance after the base prompt.
  // This supplements the existing template without altering the stored prompt.
  const formingGuidance = formingBiasesJson.length > 0
    ? `\n\nADDITIONAL INSTRUCTION FOR FORMING PATTERNS (status: "forming"):
Entries marked status: "forming" have been detected only once. For these entries:
- interpretation: use hedged, provisional language — "This may reflect an emerging tendency to..." or "An early signal suggests..." (25–35 words, second person, specific to the activation context)
- activation_summary: same format as confirmed ("Most active when...") but derived from the single available activation context. Keep it honest and specific — do not fabricate conditions not present in the data.
- narrative: if ALL entries are forming (no confirmed patterns), set narrative to null — a portrait requires more than one data point.
- If some entries are confirmed and some forming, include only confirmed patterns in the narrative paragraph.`
    : ''

  const prompt = basePrompt + formingGuidance

  const raw   = await createCompletion(prompt, 2000)
  const clean = raw.replace(/```json|```/g, '').trim()

  try {
    return JSON.parse(clean) as AIFingerprintResponse
  } catch {
    return { narrative: null, tile_interpretations: [] }
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function buildFingerprint(userId: string): Promise<FingerprintData> {
  const supabase = createServiceClient()

  // ── 1. Fetch all bias rows for this user ──────────────────────────────────
  const { data: biasRows } = await supabase
    .from('bias_library')
    .select('bias_parameter, detection_count, confidence_weight, asymmetry_score_avg, activation_contexts, session_ids')
    .eq('user_id', userId)
    .order('detection_count', { ascending: false })

  if (!biasRows || biasRows.length === 0) {
    return {
      narrative:      null,
      confirmedTiles: [],
      formingTiles:   [],
      sessionCount:   0,
      generatedAt:    new Date().toISOString(),
    }
  }

  // ── 2. Fetch session count ────────────────────────────────────────────────
  const { count: sessionCount } = await supabase
    .from('sessions')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)

  // ── 3. Fetch decision type distribution from sessions_ontology ────────────
  const { data: ontologyRows } = await supabase
    .from('sessions_ontology')
    .select('decision_type_primary, dominant_emotion')
    .in(
      'session_id',
      biasRows.flatMap(b => (b.session_ids as string[] | null) ?? []).slice(0, 20),
    )

  const typeCounts: Record<string, number> = {}
  const emotionCounts: Record<string, number> = {}

  for (const row of ontologyRows ?? []) {
    if (row.decision_type_primary) {
      typeCounts[row.decision_type_primary] = (typeCounts[row.decision_type_primary] ?? 0) + 1
    }
    if (row.dominant_emotion) {
      emotionCounts[row.dominant_emotion] = (emotionCounts[row.dominant_emotion] ?? 0) + 1
    }
  }

  const decisionTypeDistribution = Object.entries(typeCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => `${type} (${count})`)
    .join(', ') || 'mixed'

  const emotionPatterns = Object.entries(emotionCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([emotion]) => emotion)
    .join(', ') || 'varied'

  // ── 4. Split into confirmed vs forming ────────────────────────────────────
  // R9 fix: confirmed raised to >= 3 (was >= 2). Two detections is not enough
  // to establish a reliable pattern — one unusual decision can produce two
  // correlated signals. Three detections across distinct sessions is the minimum
  // for a stable fingerprint. Forming = 1 or 2 detections.
  const confirmedRows = biasRows.filter(b => b.detection_count >= 3)
  const formingRows   = biasRows.filter(b => b.detection_count < 3)

  // ── 5. Generate AI content ────────────────────────────────────────────────
  // Sprint R2: generateFingerprintContent() now always runs when there are ANY
  // bias rows — confirmed or forming. Previously it only ran for confirmedRows.
  // This ensures early users (1–3 sessions, mostly forming patterns) receive
  // AI-generated activation_summary and interpretation for their tiles.
  let aiContent: AIFingerprintResponse = { narrative: null, tile_interpretations: [] }

  const hasBiasesToGenerate = confirmedRows.length >= 1 || formingRows.length >= 1

  if (hasBiasesToGenerate) {
    const confirmedForAI = confirmedRows.slice(0, 6).map(b => ({
      biasKey:            b.bias_parameter as string,
      biasLabel:          getBiasLabel(b.bias_parameter as string),
      detectionCount:     b.detection_count as number,
      asymmetryAvg:       b.asymmetry_score_avg as number,
      activationContexts: (b.activation_contexts as Record<string, unknown>) ?? {},
    }))

    // Sprint R2: pass forming rows to AI as well, capped at 4 to manage token budget.
    // Forming rows are already ordered by detection_count desc (all = 1) so we take
    // highest asymmetry entries first by virtue of the outer query ordering.
    const formingForAI = formingRows.slice(0, 4).map(b => ({
      biasKey:            b.bias_parameter as string,
      biasLabel:          getBiasLabel(b.bias_parameter as string),
      detectionCount:     b.detection_count as number,
      asymmetryAvg:       b.asymmetry_score_avg as number,
      activationContexts: (b.activation_contexts as Record<string, unknown>) ?? {},
    }))

    aiContent = await generateFingerprintContent(
      confirmedForAI,
      formingForAI,
      decisionTypeDistribution,
      sessionCount ?? 0,
      emotionPatterns,
    )
  }

  const interpLookup: Record<string, { interpretation: string; activation_summary: string }> = {}
  for (const tile of aiContent.tile_interpretations) {
    interpLookup[tile.bias_key] = {
      interpretation:    tile.interpretation,
      activation_summary: tile.activation_summary,
    }
  }

  // ── 6. Build confirmed tiles ──────────────────────────────────────────────
  const confirmedTiles: FingerprintTile[] = confirmedRows.map(b => {
    const biasKey    = b.bias_parameter as string
    const aiTile     = interpLookup[biasKey]
    const activCtx   = (b.activation_contexts as Record<string, unknown>) ?? {}
    const detections = b.detection_count as number
    const sessionIds = (b.session_ids as string[] | null) ?? []

    const activationSummary =
      aiTile?.activation_summary || humanizeActivationSummary(activCtx, detections)

    const signalType = getPredominantSignal(activCtx)

    return {
      biasKey,
      biasLabel:         getBiasLabel(biasKey),
      detectionCount:    detections,
      confidenceWeight:  b.confidence_weight as number,
      confidenceDots:    getConfidenceDots(detections),
      asymmetryAvg:      b.asymmetry_score_avg as number,
      activationSummary,
      interpretation:    aiTile?.interpretation
        ?? (activationSummary
          ? `This pattern has appeared consistently across ${detections} of your sessions. ${activationSummary}.`
          : `A recurring pattern detected across ${detections} of your sessions — the data shows consistent activation under similar decision conditions.`),
      isTeaser:          false,
      signalType,        // Sprint 20
      sessionIds,        // Sprint 20
    }
  })

  // ── 7. Build forming tiles ────────────────────────────────────────────────
  // Sprint R2: forming tiles now use AI-generated content when available.
  // R9 fix: forming now covers detection_count 1–2. detectionCount,
  // confidenceWeight, and confidenceDots are now dynamic (were hardcoded to 1 /
  // 0.30 / 1 when forming = detection_count === 1 only). humanizeActivationSummary
  // is added as a fallback for detection_count = 2 entries (returns null for 1).
  const formingTiles: FingerprintTile[] = formingRows.map(b => {
    const biasKey    = b.bias_parameter as string
    const aiTile     = interpLookup[biasKey]   // populated by R2 AI call
    const activCtx   = (b.activation_contexts as Record<string, unknown>) ?? {}
    const detections = b.detection_count as number
    const sessionIds = (b.session_ids as string[] | null) ?? []

    return {
      biasKey,
      biasLabel:         getBiasLabel(biasKey),
      detectionCount:    detections,
      confidenceWeight:  b.confidence_weight as number,
      confidenceDots:    getConfidenceDots(detections),
      asymmetryAvg:      b.asymmetry_score_avg as number,
      // AI summary first; for detection_count = 2, humanize as fallback;
      // for detection_count = 1, humanize returns null (insufficient data)
      activationSummary: aiTile?.activation_summary
        ?? humanizeActivationSummary(activCtx, detections)
        ?? null,
      // AI interpretation first; static fallback varies by detection count
      interpretation:    aiTile?.interpretation
        ?? (detections >= 2
          ? `Pattern building — ${3 - detections} more session to confirm.`
          : 'Pattern forming — one more session to confirm.'),
      isTeaser:          true,
      signalType:        null,   // Sprint 20
      sessionIds,                // Sprint 20
    }
  })

  return {
    narrative:      aiContent.narrative,
    confirmedTiles,
    formingTiles,
    sessionCount:   sessionCount ?? 0,
    generatedAt:    new Date().toISOString(),
  }
}

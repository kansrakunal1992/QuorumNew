// lib/mirror-fingerprint.ts
// ── Mirror Module: Fingerprint Data Layer (Sprint 7b) ─────────────────────────
//
// Pulls from bias_library for a given user_id, applies confidence gating,
// derives activation summaries from activation_contexts, then generates
// the narrative + tile interpretations via a single AI call.
//
// Confidence tiers:
//   detection_count == 1  → formingTile (isTeaser: true) — label shown, content blurred
//   detection_count >= 2  → confirmedTile — full tile rendered
//   detection_count >= 3  → conditional pattern added to activation_summary
//
// Narrative is generated only when >= 2 confirmed tiles exist.
// If no confirmed tiles: narrative = null, page shows "Pattern forming" copy.
//
// One AI call generates: narrative + all tile interpretations + activation summaries.
// This is intentional — avoids N calls per tile and keeps latency acceptable.
//
// Cached at the route level for 60s (Next.js fetch cache) to prevent
// re-generating on every Mirror page visit.
// ─────────────────────────────────────────────────────────────────────────────

import { createServiceClient } from '@/lib/supabase'
import { createCompletion }    from '@/lib/ai-client'
import { MIRROR_FINGERPRINT_NARRATIVE } from '@/lib/personas'
import { BIAS_PARAMETERS }     from '@/lib/bias-scorer'
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

// ── Derive activation summary from activation_contexts ───────────────────────
//
// activation_contexts is JSONB keyed by session_id:
// {
//   "session-uuid": {
//     decision_type, emotional_signature, urgency_present, counterparty_present,
//     reasoning, prosecutor_score, defense_score
//   }
// }
//
// ── Plain-English label maps ──────────────────────────────────────────────────
// Maps raw ontology values (decision_type, emotional_signature) to
// conversational phrases a non-technical user would recognize.

const DECISION_TYPE_LABELS: Record<string, string> = {
  commitment:   'when committing to something hard to reverse',
  allocation:   'when deciding how to allocate money or resources',
  transition:   'when considering a major life or career change',
  relationship: 'when the decision involves people you're close to',
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

  // Count frequencies
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

  // Prefer mapped labels; fall back to a generic but still readable phrase
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

  if (detectionCount < 2 || conditions.length === 0) return null

  // Compose as a readable sentence, not a tag list
  if (conditions.length === 1) {
    return `Most active ${conditions[0]}`
  }
  return `Most active ${conditions[0]} and ${conditions[1]}`
}

// ── AI narrative + interpretation generation ──────────────────────────────────

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
  decisionTypeDistribution: string,
  sessionCount: number,
  emotionPatterns: string,
): Promise<AIFingerprintResponse> {
  // Build context for the AI prompt
  const confirmedBiasesJson = confirmedBiasRows.map(b => ({
    bias_key:      b.biasKey,
    label:         b.biasLabel,
    detections:    b.detectionCount,
    asymmetry_avg: b.asymmetryAvg,
    // Send a condensed version of activation_contexts — top 3 sessions only
    sample_contexts: Object.values(b.activationContexts).slice(0, 3),
  }))

  const prompt = MIRROR_FINGERPRINT_NARRATIVE
    .replace('{{CONFIRMED_BIASES}}',  JSON.stringify(confirmedBiasesJson, null, 2))
    .replace('{{DECISION_TYPES}}',    decisionTypeDistribution)
    .replace('{{SESSION_COUNT}}',     String(sessionCount))
    .replace('{{EMOTION_PATTERNS}}',  emotionPatterns)

  const raw   = await createCompletion(prompt, 2000)
  const clean = raw.replace(/```json|```/g, '').trim()

  try {
    return JSON.parse(clean) as AIFingerprintResponse
  } catch {
    // Graceful degradation — return null narrative, empty interpretations
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

  // Build decision type distribution string
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
  const confirmedRows = biasRows.filter(b => b.detection_count >= 2)
  const formingRows   = biasRows.filter(b => b.detection_count === 1)

  // ── 5. Generate AI content if we have confirmed patterns ──────────────────
  let aiContent: AIFingerprintResponse = { narrative: null, tile_interpretations: [] }

  if (confirmedRows.length >= 1) {
    const allConfirmed = confirmedRows.slice(0, 6).map(b => ({
      biasKey:            b.bias_parameter as string,
      biasLabel:          getBiasLabel(b.bias_parameter as string),
      detectionCount:     b.detection_count as number,
      asymmetryAvg:       b.asymmetry_score_avg as number,
      activationContexts: (b.activation_contexts as Record<string, unknown>) ?? {},
    }))

    aiContent = await generateFingerprintContent(
      allConfirmed,
      decisionTypeDistribution,
      sessionCount ?? 0,
      emotionPatterns,
    )
  }

  // Build an interpretation lookup from AI response
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

    // Activation summary: prefer AI-derived, fallback to rule-based
    const activationSummary =
      aiTile?.activation_summary || humanizeActivationSummary(activCtx, detections)

    return {
      biasKey,
      biasLabel:         getBiasLabel(biasKey),
      detectionCount:    detections,
      confidenceWeight:  b.confidence_weight as number,
      confidenceDots:    getConfidenceDots(detections),
      asymmetryAvg:      b.asymmetry_score_avg as number,
      activationSummary,
      // Fallback if AI didn't generate interpretation for this tile:
      // Use activation context to produce a minimal but meaningful string
      interpretation:    aiTile?.interpretation
        ?? (activationSummary
          ? `This pattern has appeared consistently across ${detections} of your sessions. ${activationSummary}.`
          : `A recurring pattern detected across ${detections} of your sessions — the data shows consistent activation under similar decision conditions.`),
      isTeaser:          false,
    }
  })

  // ── 7. Build forming tiles (teasers) ─────────────────────────────────────
  const formingTiles: FingerprintTile[] = formingRows.map(b => {
    const biasKey = b.bias_parameter as string
    return {
      biasKey,
      biasLabel:         getBiasLabel(biasKey),
      detectionCount:    1,
      confidenceWeight:  0.30,
      confidenceDots:    1,
      asymmetryAvg:      b.asymmetry_score_avg as number,
      activationSummary: null,
      interpretation:    'Pattern forming — one more session to confirm.',
      isTeaser:          true,
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

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
// We find the most frequent decision_type and emotional_signature across
// all sessions where this bias was detected, then compose a short condition string.

function deriveActivationSummary(
  activationContexts: Record<string, unknown>,
  detectionCount: number,
): string | null {
  if (!activationContexts || typeof activationContexts !== 'object') return null

  const entries = Object.values(activationContexts) as Array<Record<string, unknown>>
  if (entries.length === 0) return null

  // Count frequencies
  const typeCounts:     Record<string, number> = {}
  const emotionCounts:  Record<string, number> = {}
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

  const topType   = Object.entries(typeCounts).sort((a, b) => b[1] - a[1])[0]?.[0]
  const topEmotion = Object.entries(emotionCounts).sort((a, b) => b[1] - a[1])[0]?.[0]

  const conditions: string[] = []

  if (topType)    conditions.push(topType.replace(/_/g, ' ') + ' decisions')
  if (topEmotion) conditions.push(topEmotion + ' framing')
  if (urgencyCount > entries.length / 2)      conditions.push('time pressure present')
  if (counterpartyCount > entries.length / 2) conditions.push('counterparty involved')

  // Only show activation summary when we have >= 2 sessions confirming the pattern
  if (detectionCount < 2 || conditions.length === 0) return null

  return `Activates when: ${conditions.slice(0, 2).join(' + ')}`
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
    const top3Confirmed = confirmedRows.slice(0, 3).map(b => ({
      biasKey:            b.bias_parameter as string,
      biasLabel:          getBiasLabel(b.bias_parameter as string),
      detectionCount:     b.detection_count as number,
      asymmetryAvg:       b.asymmetry_score_avg as number,
      activationContexts: (b.activation_contexts as Record<string, unknown>) ?? {},
    }))

    aiContent = await generateFingerprintContent(
      top3Confirmed,
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
      aiTile?.activation_summary || deriveActivationSummary(activCtx, detections)

    return {
      biasKey,
      biasLabel:         getBiasLabel(biasKey),
      detectionCount:    detections,
      confidenceWeight:  b.confidence_weight as number,
      confidenceDots:    getConfidenceDots(detections),
      asymmetryAvg:      b.asymmetry_score_avg as number,
      activationSummary,
      interpretation:    aiTile?.interpretation ?? `Detected in ${detections} of your sessions.`,
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

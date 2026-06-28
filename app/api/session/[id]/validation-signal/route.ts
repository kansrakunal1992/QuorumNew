// app/api/session/[id]/validation-signal/route.ts
// SB-1 → Enrichment Sprint: Tiered ValidationCard signal.
// Session count drives enrichment tier — no wasted DB calls for tier 0 users.
//
//  Tier 0   1–2 sessions   single-session read only (archetype + emotion + type)
//  Tier 1   3–9 sessions   + top bias pattern from bias_library
//  Tier 2  10–24 sessions  + calibration direction + decision-type frequency
//  Tier 3  25+  sessions   confirmed patterns, precise counts, full fingerprint

import { createServiceClient, createClient } from '@/lib/supabase'
import { NextResponse } from 'next/server'

// ── Helpers ─────────────────────────────────────────────────────────────────

const LOW_SIGNAL_EMOTIONS = new Set(['ambivalence', 'resignation'])

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function ordinal(n: number): string {
  const v = n % 100
  const suffixes = ['th', 'st', 'nd', 'rd']
  return n + (suffixes[(v - 20) % 10] || suffixes[v] || suffixes[0])
}

// ── Label maps ───────────────────────────────────────────────────────────────

// Signal line: verb-phrase form ("working through X")
const DECISION_TYPE_LABELS: Record<string, string> = {
  commitment:   'a commitment you\'re locking yourself into',
  allocation:   'a resource allocation call — deciding where to put your chips',
  transition:   'a major transition — one chapter closing, another opening',
  acquisition:  'an acquisition — taking something new into your world',
  renunciation: 'a letting-go decision',
  governance:   'a governance question — how control or authority gets structured',
  delegation:   'a question of trust — who gets the wheel',
}

// Context lines: noun form ("X of your decisions were allocation calls")
const DECISION_TYPE_NOUNS: Record<string, string> = {
  commitment:   'commitment',
  allocation:   'resource allocation',
  transition:   'transition',
  acquisition:  'acquisition',
  renunciation: 'letting-go',
  governance:   'governance',
  delegation:   'delegation',
}

// Human-readable bias descriptions for context lines (no raw keys shown to user)
const BIAS_LABELS: Record<string, string> = {
  fomo_urgency:                      'FOMO-driven urgency — letting manufactured time pressure accelerate the call',
  overconfidence:                    'overconfidence in incomplete information',
  speed_bias:                        'speed bias — compressing evaluation on decisions that need more runway',
  loss_aversion_reversal:            'loss aversion reversal — weighting missed upside more than real downside',
  exit_optionality_mispricing:       'undervaluing exit options — entry is analysed, exit is assumed',
  recency_bias:                      'recency bias — applying recent wins to a materially different context',
  social_proof:                      'social proof reliance — deferring to peer consensus over independent analysis',
  uniqueness_fallacy:                'uniqueness fallacy — treating a familiar pattern as genuinely novel',
  deference_distortion:              'deference distortion — operating inside a filtered information environment',
  relationship_alignment_assumption: 'alignment assumption — conflating stated support with genuine commitment',
  success_compression:               'success compression — shortening evaluation horizon on the back of wins',
  loss_aversion:                     'loss aversion — weighting downside over equivalent upside',
  network_circularity:               'network circularity — skewed signal from the same trusted channels',
  complexity_opacity:                'complexity opacity — structural risk hidden inside deal complexity',
}

// ── Signal line builder (unchanged from SB-1) ────────────────────────────────

function buildValidationLine(
  dominantEmotion: string | null,
  archetype:       string | null,
  decisionType:    string | null,
  reversibility:   string | null,
): string | null {
  const emotion = dominantEmotion && !LOW_SIGNAL_EMOTIONS.has(dominantEmotion)
    ? dominantEmotion : null
  const dtLabel = decisionType ? (DECISION_TYPE_LABELS[decisionType] ?? decisionType) : null
  const arc     = archetype ? capitalize(archetype) : null

  if (arc && emotion)                             return `Quorum read you as a ${arc} making this call through a lens of ${emotion}. Does that track?`
  if (arc && reversibility?.includes('irrevers')) return `Quorum read you as a ${arc} standing at a one-way door. What you choose here doesn't easily reverse.`
  if (arc && dtLabel)                             return `Quorum read you as a ${arc} working through ${dtLabel}.`
  if (arc)                                        return `Quorum read this as a ${arc} move — a decision shaped by who you are, not just what's in front of you.`
  if (emotion && reversibility?.includes('irrevers')) return `Quorum read this as ${emotion}-driven — and one of those calls you can't easily undo. Once you move, there's no neutral gear.`
  if (emotion)                                    return `Quorum read ${emotion} as the real undercurrent here. Was that what you were actually feeling going into this?`
  if (reversibility?.includes('irrevers'))        return `Quorum read this as a one-way door. The real weight here isn't the trade-offs — it's what you're permanently closing off.`
  if (dtLabel)                                    return `Quorum read this at its core as ${dtLabel}.`
  return null
}

// ── Enrichment data fetchers ─────────────────────────────────────────────────

type SB = ReturnType<typeof createServiceClient>

async function countSessions(
  userId:    string | null,
  userEmail: string | null,
  deviceId:  string | null,
  sb:        SB,
): Promise<number> {
  if (!userId && !userEmail && !deviceId) return 1
  let q = sb.from('sessions').select('id', { count: 'exact', head: true })
  if (userId)         q = q.eq('user_id',    userId)
  else if (userEmail) q = q.eq('user_email', userEmail)
  else                q = q.eq('device_id',  deviceId!)
  const { count } = await q
  return Math.max(count ?? 1, 1)
}

async function fetchPriorSessionIds(
  userId:    string | null,
  userEmail: string | null,
  deviceId:  string | null,
  excludeId: string,
  limit:     number,
  sb:        SB,
): Promise<string[]> {
  if (!userId && !userEmail && !deviceId) return []
  let q = sb.from('sessions').select('id').neq('id', excludeId)
    .order('created_at', { ascending: false }).limit(limit)
  if (userId)         q = q.eq('user_id',    userId)
  else if (userEmail) q = q.eq('user_email', userEmail)
  else                q = q.eq('device_id',  deviceId!)
  const { data } = await q
  return (data ?? []).map((r: { id: string }) => r.id)
}

async function fetchTopBias(
  userId:    string | null,
  userEmail: string | null,
  deviceId:  string | null,
  sb:        SB,
): Promise<{ bias_parameter: string; detection_count: number } | null> {
  if (!userId && !userEmail && !deviceId) return null
  let q = sb.from('bias_library')
    .select('bias_parameter, detection_count')
    .order('detection_count',     { ascending: false })
    .order('asymmetry_score_avg', { ascending: false })
    .limit(1)
  if (userId)         q = q.eq('user_id',    userId)
  else if (userEmail) q = q.eq('user_email', userEmail)
  else                q = q.eq('device_id',  deviceId!)
  const { data } = await q
  return (data?.[0] as { bias_parameter: string; detection_count: number } | undefined) ?? null
}

async function fetchDecisionTypeFrequency(
  sessionIds:  string[],
  currentType: string | null,
  sb:          SB,
): Promise<{ sameCount: number; totalCount: number }> {
  if (!currentType || sessionIds.length === 0) return { sameCount: 0, totalCount: 0 }
  const { data } = await sb
    .from('sessions_ontology')
    .select('decision_type_primary')
    .in('session_id', sessionIds)
    .not('decision_type_primary', 'is', null)
  const rows       = (data ?? []) as Array<{ decision_type_primary: string | null }>
  const totalCount = rows.length
  const sameCount  = rows.filter(r => r.decision_type_primary === currentType).length
  return { sameCount, totalCount }
}

async function fetchCalibrationDirection(
  sessionIds: string[],
  sb:         SB,
): Promise<'over' | 'under' | null> {
  if (sessionIds.length < 3) return null
  const { data } = await sb
    .from('sessions')
    .select('id, outcomes(calibration_delta)')
    .in('id', sessionIds)
  type Row = { outcomes: { calibration_delta: number | null }[] | null }
  const deltas = (data as Row[] ?? [])
    .map(r => {
      const o = Array.isArray(r.outcomes) ? r.outcomes[0] : (r.outcomes ?? null)
      return (o as { calibration_delta: number | null } | null)?.calibration_delta ?? null
    })
    .filter((d): d is number => d !== null)
  if (deltas.length < 3) return null
  const avg = deltas.reduce((s, d) => s + d, 0) / deltas.length
  if (Math.abs(avg) < 0.3) return null
  return avg < 0 ? 'over' : 'under'
}

// ── Context line builder ─────────────────────────────────────────────────────
// Returns up to 3 strings (cross-session observations, shown below the signal
// line as supporting context for the confirm/correct decision).

function buildContextLines({
  tier, topBias, dtFrequency, calibrationDir, currentDecisionType,
}: {
  tier:                0 | 1 | 2 | 3
  topBias:             { bias_parameter: string; detection_count: number } | null
  dtFrequency:         { sameCount: number; totalCount: number }
  calibrationDir:      'over' | 'under' | null
  currentDecisionType: string | null
}): string[] {
  if (tier < 1) return []
  const lines: string[] = []

  // ── Bias pattern ─────────────────────────────────────────────────────────
  if (topBias) {
    const label = BIAS_LABELS[topBias.bias_parameter]
      ?? topBias.bias_parameter.replace(/_/g, ' ')
    const k = topBias.detection_count
    if (tier >= 3 && k >= 3) {
      lines.push(`Your most documented blind spot: ${label} — confirmed across ${k} sessions and now part of how the Council reads you.`)
    } else if (tier >= 2 && k >= 3) {
      lines.push(`Confirmed pattern: ${label} — flagged in ${k} of your sessions. The Council factors this in.`)
    } else if (k >= 3) {
      lines.push(`Pattern confirmed: ${label} has shown up across ${k} of your decisions. It may be shaping how this one is framed too.`)
    } else {
      lines.push(`Quorum has flagged ${label} in your recent sessions — it may be in play here too.`)
    }
  }

  // ── Calibration direction (tier 2+) ──────────────────────────────────────
  if (tier >= 2) {
    if (calibrationDir === 'over') {
      lines.push('Your tracked decisions show you tend to rate your confidence higher at decision-time than in hindsight — worth holding that in mind here.')
    } else if (calibrationDir === 'under') {
      lines.push("Your track record shows you tend to understate your confidence when deciding — you've generally been more capable than your certainty in the moment suggested.")
    }
  }

  // ── Decision-type frequency (when a clear pattern exists) ─────────────────
  if (currentDecisionType) {
    const typeNoun = DECISION_TYPE_NOUNS[currentDecisionType]
      ?? currentDecisionType.replace(/_/g, ' ')
    const { sameCount, totalCount } = dtFrequency

    if (tier >= 2 && sameCount >= 3 && totalCount > 0) {
      const pct = Math.round((sameCount / totalCount) * 100)
      if (pct >= 25) {
        lines.push(`${sameCount} of your ${totalCount} prior decisions were ${typeNoun} calls — this is a familiar move for you.`)
      }
    } else if (tier === 1 && sameCount >= 2) {
      lines.push(`This is your ${ordinal(sameCount + 1)} ${typeNoun} decision — a pattern is starting to form here.`)
    }
  }

  return lines.slice(0, 3)
}

// ── Route handler ────────────────────────────────────────────────────────────

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: sessionId } = await params
  if (!sessionId) return NextResponse.json({ signal: null })

  const sb = createServiceClient()

  // Resolve auth header → callerId
  let callerId: string | null = null
  const auth = req.headers.get('Authorization')
  if (auth?.startsWith('Bearer ')) {
    try {
      const anon = createClient()
      const { data: { user } } = await anon.auth.getUser(auth.slice(7).trim())
      callerId = user?.id ?? null
    } catch { callerId = null }
  }

  // ── Base fetches (always run, parallel) ──────────────────────────────────
  const [ontologyResult, sessionResult] = await Promise.all([
    sb.from('sessions_ontology')
      .select('dominant_emotion, decision_type_primary, stakes_reversibility')
      .eq('session_id', sessionId)
      .single(),
    sb.from('sessions')
      .select('user_id, user_email, device_id, validation_state')
      .eq('id', sessionId)
      .single(),
  ])

  if (sessionResult.error || !sessionResult.data) return NextResponse.json({ signal: null })

  const session = sessionResult.data as {
    user_id: string | null; user_email: string | null
    device_id: string | null; validation_state: string | null
  }

  if (session.validation_state !== 'pending') {
    return NextResponse.json({ signal: null, already_validated: true })
  }

  // ── Identity ─────────────────────────────────────────────────────────────
  const userId    = callerId ?? session.user_id    ?? null
  const userEmail = session.user_email ?? null
  const deviceId  = session.device_id  ?? null

  // ── Session count → tier ─────────────────────────────────────────────────
  const sessionCount = await countSessions(userId, userEmail, deviceId, sb)
  const tier: 0 | 1 | 2 | 3 =
    sessionCount >= 25 ? 3 :
    sessionCount >= 10 ? 2 :
    sessionCount >= 3  ? 1 : 0

  // ── Tier-gated enrichment (parallel block 1) ─────────────────────────────
  // archetype always; bias + priorIds only at tier 1+
  const [archetype, topBias, priorIds] = await Promise.all([
    userId
      ? sb.from('user_profiles').select('archetype').eq('user_id', userId).single()
          .then(r => (r.data as { archetype: string | null } | null)?.archetype ?? null)
      : Promise.resolve<string | null>(null),
    tier >= 1
      ? fetchTopBias(userId, userEmail, deviceId, sb)
      : Promise.resolve<{ bias_parameter: string; detection_count: number } | null>(null),
    tier >= 1
      ? fetchPriorSessionIds(userId, userEmail, deviceId, sessionId, 50, sb)
      : Promise.resolve<string[]>([]),
  ])

  // ── Tier-gated enrichment (parallel block 2, tier 2 only) ────────────────
  let calibrationDir: 'over' | 'under' | null           = null
  let dtFrequency:    { sameCount: number; totalCount: number } = { sameCount: 0, totalCount: 0 }

  if (priorIds.length > 0) {
    const currentType = (ontologyResult.data as { decision_type_primary: string | null } | null)
      ?.decision_type_primary ?? null

    if (tier >= 2) {
      const [cal, dtf] = await Promise.all([
        fetchCalibrationDirection(priorIds, sb),
        fetchDecisionTypeFrequency(priorIds, currentType, sb),
      ])
      calibrationDir = cal
      dtFrequency    = dtf
    } else {
      // tier 1: decision-type frequency only (no calibration data needed yet)
      dtFrequency = await fetchDecisionTypeFrequency(priorIds, currentType, sb)
    }
  }

  // ── Build signal ─────────────────────────────────────────────────────────
  const ont = ontologyResult.data as {
    dominant_emotion: string | null
    decision_type_primary: string | null
    stakes_reversibility: string | null
  } | null

  const signalLine = buildValidationLine(
    ont?.dominant_emotion     ?? null,
    archetype,
    ont?.decision_type_primary ?? null,
    ont?.stakes_reversibility  ?? null,
  )

  if (!signalLine) return NextResponse.json({ signal: null })

  const contextLines = buildContextLines({
    tier,
    topBias,
    dtFrequency,
    calibrationDir,
    currentDecisionType: ont?.decision_type_primary ?? null,
  })

  return NextResponse.json({
    signal: {
      line:         signalLine,
      archetype:    archetype ?? null,
      contextLines,            // [] at tier 0, up to 3 at tier 3
      tier,                    // 0–3 for UI decisions in ValidationCard
      sessionCount,            // authoritative count from DB
    },
  })
}

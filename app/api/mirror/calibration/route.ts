// app/api/mirror/calibration/route.ts
// ── Mirror: Calibration Sparkline Data (Sprint 15) ────────────────────────────
//
// Returns chronological calibration data points for the authenticated user.
// Each point pairs a session's pre_decision_confidence (recorded at submission)
// with its retrospective_confidence (recorded via OutcomeTracker after the fact).
// The delta is pre-computed on upsert by /api/outcome and stored in outcomes.calibration_delta.
//
// Auth: same Bearer token pattern as all other mirror routes.
//
// Minimum data threshold: 3 points with both pre + retro filled to be
// considered "data ready" for chart rendering. Below that, the component
// renders a progress state.
//
// Response shape:
//   {
//     points: CalibrationPoint[]
//     summary: {
//       avg_delta: number | null        // mean of calibration_delta across all points
//       avg_pre: number | null          // mean pre_decision_confidence
//       avg_retro: number | null        // mean retrospective_confidence
//       trend: 'improving' | 'declining' | 'stable' | 'insufficient_data'
//       pattern: string | null          // human-readable pattern label
//       dataReady: boolean              // true when >= 3 paired points exist
//       pairedCount: number             // count of sessions with both pre + retro
//     }
//   }
//
// Trend is computed from a simple linear regression slope over calibration_delta
// values ordered by date. Trend labels:
//   slope > +0.3/session → improving (deltas are getting more positive over time)
//   slope < -0.3/session → declining
//   otherwise            → stable
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse }         from 'next/server'
import { createServiceClient }  from '@/lib/supabase'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

export interface CalibrationPoint {
  session_id:               string
  decision_text:            string   // first 80 chars — tooltip label
  created_at:               string
  pre_decision_confidence:  number | null
  retrospective_confidence: number | null
  calibration_delta:        number | null
  outcome_quality:          string | null
}

export interface CalibrationSummary {
  avg_delta:   number | null
  avg_pre:     number | null
  avg_retro:   number | null
  trend:       'improving' | 'declining' | 'stable' | 'insufficient_data'
  pattern:     string | null
  dataReady:   boolean
  pairedCount: number
}

export interface CalibrationResponse {
  points:  CalibrationPoint[]
  summary: CalibrationSummary
}

// ── Trend slope ────────────────────────────────────────────────────────────────
// Computes the slope of calibration_delta over time using OLS on (index, delta).
// Returns null when fewer than 3 paired points exist.
function computeTrendSlope(deltas: number[]): number | null {
  const n = deltas.length
  if (n < 3) return null

  const xs = deltas.map((_, i) => i)
  const meanX = (n - 1) / 2
  const meanY = deltas.reduce((s, d) => s + d, 0) / n

  let num = 0, den = 0
  for (let i = 0; i < n; i++) {
    num += (xs[i] - meanX) * (deltas[i] - meanY)
    den += (xs[i] - meanX) ** 2
  }
  return den === 0 ? 0 : num / den
}

function deriveTrend(slope: number | null): CalibrationSummary['trend'] {
  if (slope === null) return 'insufficient_data'
  if (slope >  0.3)  return 'improving'
  if (slope < -0.3)  return 'declining'
  return 'stable'
}

// ── Pattern label ─────────────────────────────────────────────────────────────
// Returns a plain-language pattern label based on avg_delta and trend.
function derivePattern(avgDelta: number | null, trend: CalibrationSummary['trend']): string | null {
  if (avgDelta === null) return null

  if (avgDelta > 1.5) {
    return trend === 'improving'
      ? 'Growing confidence in your own judgment over time'
      : 'Consistently more confident in hindsight than at decision time'
  }
  if (avgDelta < -1.5) {
    return trend === 'improving'
      ? 'Improving calibration — overconfidence bias declining'
      : 'Persistent overconfidence — entering decisions more certain than the outcomes warrant'
  }
  if (Math.abs(avgDelta) <= 0.5) {
    return 'Well-calibrated — confidence at decision time closely matches hindsight'
  }
  if (avgDelta > 0) {
    return 'Moderate hindsight confidence lift — typical of analytical decision-makers'
  }
  return 'Slight overconfidence pattern — entering decisions with marginally more certainty than warranted'
}

// ── Route handler ─────────────────────────────────────────────────────────────
export async function GET(req: Request) {
  const supabase = createServiceClient()

  // ── 1. Resolve user_id from Bearer token ──────────────────────────────────
  let userId: string | null = null
  const authHeader = req.headers.get('authorization')
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7)
    try {
      const anonClient = createSupabaseClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      )
      const { data: { user } } = await anonClient.auth.getUser(token)
      userId = user?.id ?? null
    } catch {
      // invalid token — fall through as unauthenticated
    }
  }

  if (!userId) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  // ── 2. Fetch sessions with pre_decision_confidence ─────────────────────────
  // Join with outcomes to get retro confidence and delta.
  // Ordered oldest-first so the sparkline reads left-to-right chronologically.
  const { data: rows, error } = await supabase
    .from('sessions')
    .select(`
      id,
      decision_text,
      created_at,
      pre_decision_confidence,
      outcomes (
        retrospective_confidence,
        calibration_delta,
        outcome_quality
      )
    `)
    .eq('user_id', userId)
    .eq('status', 'completed')
    .order('created_at', { ascending: true })

  if (error) {
    console.error('Calibration fetch error:', error)
    return NextResponse.json({ error: 'DB error' }, { status: 500 })
  }

  // ── 3. Flatten into CalibrationPoints ─────────────────────────────────────
  const points: CalibrationPoint[] = (rows ?? []).map(row => {
    // Supabase returns the joined outcomes row as an object or null
    const outcome = Array.isArray(row.outcomes) ? row.outcomes[0] : row.outcomes

    return {
      session_id:               row.id,
      decision_text:            (row.decision_text ?? '').slice(0, 80),
      created_at:               row.created_at,
      pre_decision_confidence:  row.pre_decision_confidence ?? null,
      retrospective_confidence: outcome?.retrospective_confidence ?? null,
      calibration_delta:        outcome?.calibration_delta ?? null,
      outcome_quality:          outcome?.outcome_quality ?? null,
    }
  })

  // ── 4. Compute summary ─────────────────────────────────────────────────────
  // Only sessions that have BOTH pre + retro count as "paired" for analytics.
  const paired = points.filter(
    p => p.pre_decision_confidence !== null && p.retrospective_confidence !== null,
  )
  const pairedCount = paired.length
  const dataReady   = pairedCount >= 3

  let avg_delta:  number | null = null
  let avg_pre:    number | null = null
  let avg_retro:  number | null = null
  let pattern:    string | null = null

  if (pairedCount > 0) {
    const deltas  = paired.map(p => p.calibration_delta!)
    const pres    = paired.map(p => p.pre_decision_confidence!)
    const retros  = paired.map(p => p.retrospective_confidence!)

    avg_delta = deltas.reduce((s, d) => s + d, 0) / pairedCount
    avg_pre   = pres.reduce((s, d) => s + d, 0) / pairedCount
    avg_retro = retros.reduce((s, d) => s + d, 0) / pairedCount

    const slope = computeTrendSlope(deltas)
    const trend = deriveTrend(slope)
    pattern     = derivePattern(avg_delta, trend)

    const summary: CalibrationSummary = {
      avg_delta:   Math.round(avg_delta  * 10) / 10,
      avg_pre:     Math.round(avg_pre    * 10) / 10,
      avg_retro:   Math.round(avg_retro  * 10) / 10,
      trend,
      pattern,
      dataReady,
      pairedCount,
    }

    return NextResponse.json({ points, summary } satisfies CalibrationResponse)
  }

  // Insufficient data path
  const summary: CalibrationSummary = {
    avg_delta:   null,
    avg_pre:     null,
    avg_retro:   null,
    trend:       'insufficient_data',
    pattern:     null,
    dataReady:   false,
    pairedCount,
  }

  return NextResponse.json({ points, summary } satisfies CalibrationResponse)
}

import { createServiceClient } from '@/lib/supabase'
import { NextResponse } from 'next/server'

// Sprint D1 (R11 Avoidance Detection — foundation):
//   Filing an outcome = resolution signal. Stamp last_action_at so the D2
//   avoidance detector does not flag sessions the user has already resolved.
//   Also prevents a resolved session from re-triggering after dismissal.
//   Stamped AFTER successful outcomes upsert — non-blocking, logged on failure.

export async function POST(req: Request) {
  try {
    const {
      sessionId,
      what_decided,
      council_helped,
      notes,
      // Sprint 14 calibration fields
      outcome_quality,
      retrospective_confidence,
    } = await req.json()

    if (!sessionId || !what_decided || !council_helped) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const supabase = createServiceClient()

    // ── Sprint 14: fetch pre_decision_confidence to compute calibration_delta ─
    let calibrationDelta: number | null = null
    if (typeof retrospective_confidence === 'number') {
      const { data: sessionRow } = await supabase
        .from('sessions')
        .select('pre_decision_confidence')
        .eq('id', sessionId)
        .single()

      const pre = sessionRow?.pre_decision_confidence
      if (typeof pre === 'number') {
        // positive = grew more confident after the decision
        // negative = ended up less certain than you started
        calibrationDelta = retrospective_confidence - pre
      }
    }

    // Upsert so editing outcome works too
    const { error } = await supabase.from('outcomes').upsert({
      session_id:              sessionId,
      what_decided,
      council_helped,
      notes:                   notes ?? null,
      // Sprint 14
      outcome_quality:         outcome_quality ?? null,
      retrospective_confidence: (typeof retrospective_confidence === 'number') ? retrospective_confidence : null,
      calibration_delta:       calibrationDelta,
      updated_at:              new Date().toISOString(),
    }, { onConflict: 'session_id' })

    if (error) {
      console.error('Outcome upsert error:', error)
      return NextResponse.json({ error: 'Failed to save' }, { status: 500 })
    }

    // Sprint D1: outcome filed = resolution signal for avoidance detector.
    // Stamp last_action_at so D2 does not flag this session as avoided.
    // Fire-and-forget — non-fatal; D2 uses COALESCE(last_action_at, created_at).
    supabase
      .from('sessions')
      .update({ last_action_at: new Date().toISOString() })
      .eq('id', sessionId)
      .then(({ error: stampErr }) => {
        if (stampErr) {
          console.error(`[Outcome POST] last_action_at stamp failed for session ${sessionId}:`, stampErr)
        }
      })

    return NextResponse.json({ ok: true, calibration_delta: calibrationDelta })
  } catch (err) {
    console.error('Outcome route error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const sessionId = searchParams.get('sessionId')
  if (!sessionId) return NextResponse.json({ error: 'sessionId required' }, { status: 400 })
  const supabase = createServiceClient()
  const { data } = await supabase
    .from('outcomes')
    .select('*')
    .eq('session_id', sessionId)
    .single()
  return NextResponse.json({ outcome: data ?? null })
}

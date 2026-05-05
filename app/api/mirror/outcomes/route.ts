import { createServiceClient } from '@/lib/supabase'
import { NextResponse } from 'next/server'

/**
 * GET /api/mirror/outcomes
 *
 * Returns the authenticated user's outcome summary for the Mirror module.
 * User ownership resolves through sessions — outcomes has no user_id column;
 * the relationship is session_id → sessions.user_id.
 *
 * Identity resolution hierarchy (same as bias scorer / contradiction detector):
 *   userId (auth) → userEmail (pre-auth) → deviceId (anonymous)
 *
 * Query params:
 *   userId    – authenticated user UUID (preferred)
 *   userEmail – pre-auth email (fallback)
 *   deviceId  – anonymous device ID (last resort)
 *
 * Response:
 * {
 *   total:        number,   // sessions with outcomes recorded
 *   pending:      number,   // completed sessions ≥30 days, no outcome
 *   distribution: { yes, partially, no },
 *   recent:       OutcomeRow[],  // last 5
 *   causalReady:  boolean,       // ≥5 outcomes accumulated
 * }
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const userId    = searchParams.get('userId')
    const userEmail = searchParams.get('userEmail')
    const deviceId  = searchParams.get('deviceId')

    if (!userId && !userEmail && !deviceId) {
      return NextResponse.json({ error: 'Identity required' }, { status: 400 })
    }

    const supabase = createServiceClient()

    // ── Step 1: resolve all session IDs for this identity ────────
    // outcomes.session_id → sessions is the only ownership link.
    let sessionIds: string[] = []

    if (userId) {
      const { data } = await supabase
        .from('sessions')
        .select('id')
        .eq('user_id', userId)
      sessionIds = (data ?? []).map(r => r.id)
    } else if (userEmail) {
      const { data } = await supabase
        .from('sessions')
        .select('id')
        .eq('user_email', userEmail)
      sessionIds = (data ?? []).map(r => r.id)
    } else if (deviceId) {
      const { data } = await supabase
        .from('sessions')
        .select('id')
        .eq('device_id', deviceId)
      sessionIds = (data ?? []).map(r => r.id)
    }

    if (sessionIds.length === 0) return NextResponse.json(emptyResponse())

    // ── Step 2: fetch outcomes for those sessions ─────────────────
    const { data: outcomes, error } = await supabase
      .from('outcomes')
      .select('*')
      .in('session_id', sessionIds)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Mirror outcomes fetch error:', error)
      return NextResponse.json({ error: 'DB error' }, { status: 500 })
    }

    const rows = outcomes ?? []

    // ── Step 3: distribution ─────────────────────────────────────
    const distribution = { yes: 0, partially: 0, no: 0 }
    for (const r of rows) {
      if (r.council_helped in distribution) {
        distribution[r.council_helped as keyof typeof distribution]++
      }
    }

    // ── Step 4: pending count (completed sessions ≥30 days, no outcome)
    const outcomeSessions = new Set(rows.map(r => r.session_id))
    const { data: oldSessions } = await supabase
      .from('sessions')
      .select('id')
      .in('id', sessionIds)
      .eq('status', 'completed')
      .lt('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())

    const pending = (oldSessions ?? []).filter(s => !outcomeSessions.has(s.id)).length

    return NextResponse.json({
      total:       rows.length,
      pending,
      distribution,
      recent:      rows.slice(0, 5),
      causalReady: rows.length >= 5,
    })

  } catch (err) {
    console.error('Mirror outcomes route error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

function emptyResponse() {
  return {
    total:        0,
    pending:      0,
    distribution: { yes: 0, partially: 0, no: 0 },
    recent:       [],
    causalReady:  false,
  }
}

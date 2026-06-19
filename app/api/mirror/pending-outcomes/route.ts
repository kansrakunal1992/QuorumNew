// app/api/mirror/pending-outcomes/route.ts
// ── Mirror: Pending Outcome Sessions ─────────────────────────────────────────
//
// Returns the user's completed sessions that have no outcome logged yet,
// sorted oldest-first (the longest-outstanding ones surface first).
//
// Consumed by Mirror module CTAs — CalibrationSparkline's InsufficientState
// and BiasFingerprint's PersonalTriggerSection empty state — so they can link
// directly to the specific records that need a retrospective, rather than a
// generic "log outcomes somewhere" prompt with no destination.
//
// Auth: same Bearer-token-via-Supabase-auth pattern as every other Mirror
// route (see app/api/mirror/calibration/route.ts) — NOT a custom token
// lookup in mirror_access, which has no access_token column.
//
// Limit: capped at 5 — a CTA shouldn't surface a scrollable list of homework.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse }         from 'next/server'
import { createServiceClient }  from '@/lib/supabase'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { getMirrorAccessState } from '@/lib/mirror-access'
import { decrypt }              from '@/lib/encryption'

const LIMIT = 5

export interface PendingOutcomeSession {
  session_id:      string
  decision_text:   string   // decrypted, sliced to 90 chars
  created_at:       string
  days_ago:        number
}

export interface PendingOutcomesResponse {
  sessions:      PendingOutcomeSession[]
  totalPending:  number   // full count, even if sessions[] is capped at LIMIT
}

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

  // ── 2. Mirror access gate ─────────────────────────────────────────────────
  const accessState = await getMirrorAccessState(userId, supabase)
  if (accessState !== 'unlocked') {
    return NextResponse.json({ error: 'Mirror access required' }, { status: 403 })
  }

  try {
    // ── 3. All completed sessions for this user ──────────────────────────────
    const { data: allSessions } = await supabase
      .from('sessions')
      .select('id, decision_text, created_at')
      .eq('user_id', userId)
      .eq('status', 'completed')
      .order('created_at', { ascending: true })

    if (!allSessions || allSessions.length === 0) {
      return NextResponse.json({ sessions: [], totalPending: 0 } satisfies PendingOutcomesResponse)
    }

    // ── 4. Sessions that already have an outcome ─────────────────────────────
    const { data: outcomesRows } = await supabase
      .from('outcomes')
      .select('session_id')
      .in('session_id', allSessions.map(s => s.id))

    const withOutcome = new Set((outcomesRows ?? []).map(r => r.session_id as string))

    // ── 5. Filter to pending, oldest-first ────────────────────────────────────
    const nowMs   = Date.now()
    const pending = allSessions
      .filter(s => !withOutcome.has(s.id))
      .map(s => ({
        session_id:    s.id as string,
        decision_text: (decrypt(s.decision_text as string) ?? '').slice(0, 90),
        created_at:    s.created_at as string,
        days_ago:      Math.floor((nowMs - new Date(s.created_at as string).getTime()) / 86_400_000),
      }))

    return NextResponse.json({
      sessions:     pending.slice(0, LIMIT),
      totalPending: pending.length,
    } satisfies PendingOutcomesResponse)

  } catch (err) {
    console.error('[pending-outcomes] error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

// app/api/mirror/session-score/route.ts
// ── R4: Session Reliability Index — API route ─────────────────────────────────
//
// GET /api/mirror/session-score
//
// Auth-gated: requires valid Bearer token (resolves user_id).
// Access-gated: requires Mirror access (unlocked only — paid subscribers).
//
// Returns SessionScoreData[] — one entry per session (last 20), newest first.
// Each entry includes the composite score, four sub-scores, and a global
// action plan derived from the user's weakest average sub-score.
//
// Data sources (all existing tables — no schema migration needed):
//   sessions             — base list + decision_text preview
//   sessions_ontology    — matches_json (structural), rule_engine_result (council)
//   bias_library         — activation_contexts JSONB (bias clarity per session)
//   outcomes             — calibration_delta (calibration score)
//
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse }              from 'next/server'
import { createServiceClient }       from '@/lib/supabase'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { getMirrorAccessState }      from '@/lib/mirror-access'
import { computeUserSessionScores }  from '@/lib/session-score'

// ── Auth helper (same pattern as benchmark/route.ts) ─────────────────────────

async function resolveUserId(req: Request): Promise<string | null> {
  const authHeader = req.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) return null
  const token = authHeader.slice(7)
  try {
    const anonClient = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    )
    const { data: { user } } = await anonClient.auth.getUser(token)
    return user?.id ?? null
  } catch {
    return null
  }
}

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET(req: Request): Promise<Response> {
  // 1. Auth
  const userId = await resolveUserId(req)
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient()

  // 2. Mirror access gate — Session Reliability Index is unlocked-tier only
  const accessState = await getMirrorAccessState(userId, supabase)
  if (accessState !== 'unlocked') {
    return NextResponse.json({ error: 'Mirror access required' }, { status: 403 })
  }

  // 3. Compute + return
  try {
    const scores = await computeUserSessionScores(userId, supabase)
    return NextResponse.json({ scores })
  } catch (err) {
    console.error('[SessionScore] computation error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

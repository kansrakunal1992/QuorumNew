// app/api/graph/backfill/route.ts
// Sprint G1: Decision Graph — one-time backfill endpoint
//
// POST /api/graph/backfill
// Requires: Authorization: Bearer <INTERNAL_API_SECRET>
// Body: { "user_id": "<uuid>" }
//
// Materialises all 4 computed edge types (structural_similarity, contradiction,
// shared_bias_trigger, shared_decision_type) for a single user from data already
// computed and stored by the existing engines. No AI calls.
//
// Designed to be called once per user against the existing corpus after the
// graph_edges table is created (supabase/graph_sprint1.sql). Subsequent runs
// are idempotent — all upserts use onConflict: 'session_id_a,session_id_b,edge_type'.
//
// Going forward, structural_similarity edges are written live by the
// /api/structural-match route as new sessions are scored (Sprint G1 hook).
// The other three types (contradiction, bias, decision_type) are batch-only
// until a cron job is introduced in a later sprint.
//
// Access control: INTERNAL_API_SECRET (same pattern as /api/cron/* routes).
// Never expose user_ids in response bodies beyond what was sent in the request.

import { NextResponse }                   from 'next/server'
import { createServiceClient }            from '@/lib/supabase'
import { runFullBackfill }                from '@/lib/graph-engine'

export async function POST(req: Request): Promise<NextResponse> {
  try {
    // ── Auth: INTERNAL_API_SECRET ─────────────────────────────────────────────
    const authHeader = req.headers.get('authorization') ?? ''
    const token      = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
    const secret     = process.env.INTERNAL_API_SECRET ?? ''

    if (!secret) {
      console.error('[GraphBackfill] INTERNAL_API_SECRET not set — endpoint disabled')
      return NextResponse.json({ error: 'Endpoint not configured' }, { status: 503 })
    }
    if (!token || token !== secret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // ── Body: user_id (required) ──────────────────────────────────────────────
    let body: { user_id?: string }
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const userId = body.user_id?.trim()
    if (!userId) {
      return NextResponse.json({ error: 'user_id is required' }, { status: 400 })
    }

    // Basic UUID format guard (not an auth check — just prevents garbage DB queries)
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!UUID_RE.test(userId)) {
      return NextResponse.json({ error: 'user_id must be a valid UUID' }, { status: 400 })
    }

    const supabase = createServiceClient()

    // Confirm user exists — avoid silently writing graph rows for phantom user_ids
    const { data: user, error: userErr } = await supabase
      .from('sessions')
      .select('user_id')
      .eq('user_id', userId)
      .limit(1)
      .single()

    if (userErr || !user) {
      return NextResponse.json({ error: 'No sessions found for this user_id' }, { status: 404 })
    }

    // ── Run backfill ──────────────────────────────────────────────────────────
    console.log(`[GraphBackfill] Starting full backfill for user ${userId}`)
    const startMs = Date.now()

    const counts = await runFullBackfill(supabase, userId)

    const elapsed = Date.now() - startMs
    console.log(
      `[GraphBackfill] Done in ${elapsed}ms — ` +
      `structural: ${counts.structural}, contradiction: ${counts.contradiction}, ` +
      `bias: ${counts.bias}, decision_type: ${counts.decision_type}, total: ${counts.total}`
    )

    return NextResponse.json({
      success:   true,
      elapsed_ms: elapsed,
      edges_written: counts,
    })

  } catch (err) {
    console.error('[GraphBackfill] Unhandled error:', err)
    return NextResponse.json({ error: 'Internal server error', detail: String(err) }, { status: 500 })
  }
}

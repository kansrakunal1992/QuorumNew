import { createServiceClient } from '@/lib/supabase'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { decrypt } from '@/lib/encryption'

// ── Bias Library cleanup (Sprint RET-5) ─────────────────────────────────────
// bias_library aggregates signal across sessions via an array column
// (session_ids) + a JSONB map (activation_contexts) — neither can carry a
// real foreign key, so unlike contradictions/independence_score_log/
// structural_matches (now cleaned up via DB-level ON DELETE CASCADE, see
// supabase/sprint_ret5_cascade_cleanup.sql), this has to be handled here.
//
// Recomputes detection_count, confidence_weight, and asymmetry_score_avg from
// the surviving sessions only — not a blind decrement. Mirrors the exact
// formulas /api/bias-score uses when writing these rows: confidence_weight =
// min(0.30 * count, 1.0), asymmetry = prosecutor_score - defense_score
// (stored per-session inside activation_contexts), averaged across whatever's
// left.
//
// If a row's count reaches 0, the row is kept — not deleted — for backend
// analytics, and so a future detection on a new session builds back up from
// where it left off rather than starting a fresh row. It's made invisible to
// the user via detection_count filters in lib/mirror-fingerprint.ts and the
// teaserBiases queries (app/api/mirror/teaser/route.ts, app/api/mirror/status/route.ts).
async function cleanupBiasLibraryForSession(
  supabase: ReturnType<typeof createServiceClient>,
  sessionId: string,
) {
  const { data: rows } = await supabase
    .from('bias_library')
    .select('id, session_ids, activation_contexts')
    .contains('session_ids', [sessionId])

  for (const row of rows ?? []) {
    const ctx = (row.activation_contexts as Record<
      string,
      { prosecutor_score?: number; defense_score?: number }
    >) ?? {}

    const remainingIds = ((row.session_ids as string[] | null) ?? []).filter(id => id !== sessionId)
    const { [sessionId]: _removed, ...remainingCtx } = ctx
    const remainingEntries = Object.values(remainingCtx)

    const newCount  = remainingEntries.length
    const newWeight = Math.min(0.30 * newCount, 1.0)
    const newAvg    = newCount > 0
      ? Math.round(
          (remainingEntries.reduce(
            (sum, e) => sum + ((e.prosecutor_score ?? 0) - (e.defense_score ?? 0)),
            0,
          ) / newCount) * 100,
        ) / 100
      : 0

    await supabase
      .from('bias_library')
      .update({
        session_ids:         remainingIds,
        activation_contexts: remainingCtx,
        detection_count:     newCount,
        confidence_weight:   newWeight,
        asymmetry_score_avg: newAvg,
        updated_at:          new Date().toISOString(),
      })
      .eq('id', row.id as string)
  }
}

// DELETE — hard-delete a session and all its related rows (messages, outcomes cascade)
// Auth: user must own the session (user_id match) OR session must have no user_id (device-only)
export async function DELETE(req: Request) {
  try {
    const { sessionId } = await req.json()
    if (!sessionId) {
      return NextResponse.json({ error: 'sessionId is required' }, { status: 400 })
    }

    const supabase = createServiceClient()

    // Resolve caller identity from auth token (optional — device-only sessions have no user_id)
    let callerId: string | null = null
    const authHeader = req.headers.get('authorization')
    if (authHeader?.startsWith('Bearer ')) {
      try {
        const anonClient = createSupabaseClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        )
        const { data: { user } } = await anonClient.auth.getUser(authHeader.slice(7))
        callerId = user?.id ?? null
      } catch { /* invalid token — continue as anonymous */ }
    }

    // Fetch the session to verify ownership before deleting
    const { data: session, error: fetchError } = await supabase
      .from('sessions')
      .select('id, user_id')
      .eq('id', sessionId)
      .single()

    if (fetchError || !session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }

    // Ownership check:
    // - If session has a user_id, caller must match
    // - If session has no user_id (device-only), allow delete (no identity to verify against)
    if (session.user_id && session.user_id !== callerId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Delete session — messages, outcomes, examiner_responses, sessions_ontology,
    // structural_scores, contradictions, independence_score_log, and
    // structural_matches all cascade via ON DELETE CASCADE foreign keys
    // (Sprint RET-5: the last three were added in
    // supabase/sprint_ret5_cascade_cleanup.sql — previously orphaned).
    const { error: deleteError } = await supabase
      .from('sessions')
      .delete()
      .eq('id', sessionId)

    if (deleteError) {
      console.error('Session delete error:', deleteError)
      return NextResponse.json({ error: 'Failed to delete session' }, { status: 500 })
    }

    // bias_library can't be covered by a FK cascade (session_ids is an array
    // column) — recompute it here, synchronously. A handful of small queries
    // against a table with at most a few dozen rows per user; not worth the
    // complexity of making this fire-and-forget.
    try {
      await cleanupBiasLibraryForSession(supabase, sessionId)
    } catch (biasCleanupErr) {
      // Non-fatal: the session is already gone, which is the primary thing
      // the user asked for. Log loudly so a stale bias_library row can be
      // caught and fixed manually rather than silently lost.
      console.error('[Record DELETE] bias_library cleanup failed for session', sessionId, biasCleanupErr)
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('Record DELETE error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST — mark session as completed
export async function POST(req: Request) {
  try {
    const { sessionId } = await req.json()

    if (!sessionId) {
      return NextResponse.json({ error: 'sessionId is required' }, { status: 400 })
    }

    const supabase = createServiceClient()

    const { error } = await supabase
      .from('sessions')
      .update({ status: 'completed' })
      .eq('id', sessionId)

    if (error) {
      console.error('Record update error:', error)
      return NextResponse.json({ error: 'Failed to save record' }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('Record route error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// GET — fetch full decision record (session + all messages)
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const sessionId = searchParams.get('sessionId')

  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId is required' }, { status: 400 })
  }

  const supabase = createServiceClient()

  const [sessionResult, messagesResult] = await Promise.all([
    supabase.from('sessions').select('*').eq('id', sessionId).single(),
    supabase
      .from('messages')
      .select('*')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true }),
  ])

  if (sessionResult.error || !sessionResult.data) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }

  const session = sessionResult.data
  const messages = (messagesResult.data ?? []).map(m => ({
    ...m,
    content: decrypt(m.content),
  }))

  return NextResponse.json({
    session: {
      ...session,
      decision_text: decrypt(session.decision_text),
      context_text:  decrypt(session.context_text),
    },
    messages,
  })
}

// app/api/session/[id]/decide/route.ts
// ── Unified Session, Tier 2 ────────────────────────────────────────────────
// Records the user's final decision as its own explicit, timestamped moment
// — distinct from initial_instinct (locked before Quorum said anything) and
// distinct from the post-hoc "what happened" that OutcomeTracker/outcomes
// already capture (that's the real-world result, logged later; this is the
// choice itself, logged now). Computes whether it matched Quorum's
// prediction and a simple pattern-callback count for the Reveal screen.
//
// final_decision is raw user input → encrypted, same treatment as
// outcomes.what_decided (see sprint_prediction_layer.sql).
//
// Only reachable when the unified session flag is on.

import { NextResponse }            from 'next/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { createServiceClient }     from '@/lib/supabase'
import { encrypt, decrypt }        from '@/lib/encryption'
import { isUnifiedSessionEnabled } from '@/lib/feature-flags'
import { countMatchingPastPattern } from '@/lib/prediction-engine'

interface Params { params: Promise<{ id: string }> }

export async function POST(req: Request, { params }: Params) {
  if (!isUnifiedSessionEnabled()) {
    return NextResponse.json({ error: 'Not enabled' }, { status: 404 })
  }

  const { id: sessionId } = await params
  if (!sessionId) return NextResponse.json({ error: 'Missing session id' }, { status: 400 })

  let body: { finalDecision?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const finalDecision = (body.finalDecision ?? '').trim()
  if (!finalDecision) return NextResponse.json({ error: 'Missing finalDecision' }, { status: 400 })
  if (finalDecision.length > 2000) {
    return NextResponse.json({ error: 'finalDecision too long' }, { status: 400 })
  }

  const supabase = createServiceClient()

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
      // fall through
    }
  }

  const { data: session } = await supabase
    .from('sessions')
    .select('id, user_id, initial_instinct, optimization_priority, quorum_predicted_choice, final_decision')
    .eq('id', sessionId)
    .single()

  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  if (session.user_id && userId && session.user_id !== userId) {
    return NextResponse.json({ error: 'Not your session' }, { status: 403 })
  }

  // Final decision is locked once — same "don't let a refresh silently
  // rewrite history" principle as predict/route.ts's cache check.
  if (session.final_decision) {
    return NextResponse.json({ error: 'Final decision already recorded for this session' }, { status: 409 })
  }

  // ── Compute the match against Quorum's prediction ──
  // Simple, honest v1: case-insensitive substring/keyword overlap, not full
  // semantic comparison. Good enough to say "roughly matched" vs "diverged";
  // not precise enough to be shown as a hard percentage, so the UI (see
  // PredictionReveal.tsx) never presents this as a score — just a yes/no
  // framed as "Quorum predicted you" / "You surprised Quorum."
  const predicted = (session.quorum_predicted_choice ?? '').toLowerCase()
  const finalLower = finalDecision.toLowerCase()
  const predictionMatched = predicted.length > 0 && (
    finalLower.includes(predicted) ||
    predicted.split(/\s+/).filter((w: string) => w.length > 3).some((word: string) => finalLower.includes(word))
  )

  // ── Pattern callback ──
  const effectiveUserId = session.user_id ?? userId
  let patternCount = 0
  if (effectiveUserId && session.optimization_priority && session.initial_instinct) {
    const { data: pastRows } = await supabase
      .from('sessions')
      .select('optimization_priority, initial_instinct, final_decision')
      .eq('user_id', effectiveUserId)
      .not('final_decision', 'is', null)
      .neq('id', sessionId)
      .order('final_decision_locked_at', { ascending: false })
      .limit(12)

    if (pastRows) {
      const history = pastRows.map(r => ({
        optimization_priority: r.optimization_priority,
        initial_instinct:      r.initial_instinct,
        final_decision_plain:  decrypt(r.final_decision as string) ?? '',
      }))
      const trackedInitial = trackedInstinctLocal(session.initial_instinct, finalDecision)
      patternCount = countMatchingPastPattern(history, session.optimization_priority, trackedInitial)
    }
  }

  const { error } = await supabase
    .from('sessions')
    .update({
      final_decision:            encrypt(finalDecision),
      final_decision_locked_at:  new Date().toISOString(),
      prediction_matched_final:  predictionMatched,
    })
    .eq('id', sessionId)

  if (error) {
    console.error('[decide] save failed', error)
    return NextResponse.json({ error: 'Failed to save' }, { status: 500 })
  }

  return NextResponse.json({
    predictionMatched,
    patternCount,
    predictedChoice: session.quorum_predicted_choice ?? null,
  })
}

// Mirrors the private trackedInstinct() logic in lib/prediction-engine.ts —
// kept local here since it operates on plaintext just-submitted input, not
// a decrypted history row, and the two shapes aren't worth unifying for
// this small a function.
function trackedInstinctLocal(instinct: string, finalDecisionPlain: string): boolean {
  const finalLower = finalDecisionPlain.toLowerCase()
  if (instinct === 'accept') return !finalLower.startsWith('no') && !finalLower.includes('reject')
  if (instinct === 'reject') return finalLower.startsWith('no') || finalLower.includes('reject') || finalLower.includes('declin')
  return false
}

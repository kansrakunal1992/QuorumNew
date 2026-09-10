// app/api/persona/predict/route.ts
// ── Unified Session, Tier 2 ────────────────────────────────────────────────
// Generates Quorum's prediction of the eventual choice. Deliberately a
// separate route from app/api/persona/route.ts — see lib/prediction-engine.ts's
// doc comment for why. Called once initial_instinct + optimization_priority
// are saved (see instinct/route.ts), before Council/Synthesis are shown.
//
// Only reachable when the unified session flag is on.

import { NextResponse }            from 'next/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { createServiceClient }     from '@/lib/supabase'
import { decrypt }                 from '@/lib/encryption'
import { isUnifiedSessionEnabled } from '@/lib/feature-flags'
import { generatePrediction }      from '@/lib/prediction-engine'

interface Params { params: Promise<{ id: string }> }

export async function POST(req: Request, { params }: Params) {
  if (!isUnifiedSessionEnabled()) {
    return NextResponse.json({ error: 'Not enabled' }, { status: 404 })
  }

  // Note: this route is mounted at app/api/persona/predict, not under
  // app/api/session/[id] like instinct/decide — the session id is passed in
  // the body instead, matching how app/api/persona/route.ts itself takes it
  // (keeps this consistent with its sibling route rather than the
  // session/[id]/* family, since it lives in the same directory).
  let body: { sessionId?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const sessionId = body.sessionId
  if (!sessionId) return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 })

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
    .select('id, user_id, decision_text, initial_instinct, optimization_priority, quorum_predicted_choice, quorum_prediction_reasoning, quorum_prediction_used_search')
    .eq('id', sessionId)
    .single()

  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  if (session.user_id && userId && session.user_id !== userId) {
    return NextResponse.json({ error: 'Not your session' }, { status: 403 })
  }
  if (!session.initial_instinct || !session.optimization_priority) {
    return NextResponse.json({ error: 'Initial instinct not yet locked for this session' }, { status: 409 })
  }

  // Idempotent — a page refresh or re-mount shouldn't re-bill the LLM call
  // or risk generating a second, different prediction for the same session.
  if (session.quorum_predicted_choice) {
    return NextResponse.json({
      predictedChoice: session.quorum_predicted_choice,
      reasoning:        session.quorum_prediction_reasoning,
      usedSearch:       !!session.quorum_prediction_used_search,
      cached:           true,
    })
  }

  const decisionText = decrypt(session.decision_text) ?? ''
  if (!decisionText) return NextResponse.json({ error: 'Decision text unavailable' }, { status: 500 })

  // A device-local, pre-auth session has no user_id to fetch history for —
  // fetchPastDecisions inside generatePrediction simply returns [] for that
  // case (userId won't match any rows), which correctly routes to the
  // cold-start/search path rather than failing.
  const effectiveUserId = session.user_id ?? userId ?? sessionId

  let result
  try {
    result = await generatePrediction({
      userId:               effectiveUserId,
      decisionText,
      initialInstinct:      session.initial_instinct as 'accept' | 'reject' | 'unsure',
      optimizationPriority: session.optimization_priority,
    })
  } catch (err) {
    console.error('[predict] generation failed', err)
    // Degrade gracefully — a missing prediction should never block the rest
    // of the session (Council/Synthesis run independently of this route).
    return NextResponse.json({ error: 'Prediction generation failed' }, { status: 502 })
  }

  const { error: updateError } = await supabase
    .from('sessions')
    .update({
      quorum_predicted_choice:        result.predictedChoice,
      quorum_prediction_reasoning:    result.reasoning,
      quorum_prediction_used_search:  result.usedSearch,
      quorum_prediction_generated_at: new Date().toISOString(),
    })
    .eq('id', sessionId)

  if (updateError) {
    console.error('[predict] save failed', updateError)
    // Still return the prediction to the client even if the save failed —
    // better to show it once than to lose it entirely. It just won't be
    // available for the later Reveal comparison.
  }

  return NextResponse.json({
    predictedChoice: result.predictedChoice,
    reasoning:        result.reasoning,
    usedSearch:       result.usedSearch,
    historyCount:     result.historyCount,
    cached:           false,
  })
}

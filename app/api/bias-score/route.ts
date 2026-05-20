// app/api/bias-score/route.ts
// ── Sprint 4 / 4b: Bias Library — Background Scoring Endpoint ────────────────
// ── Sprint 20: Added signal_type classification per detection ─────────────────
//
// Called server-side from /api/examiner POST after examiner submit/skip.
//
// Sprint 20 change: after scoreBiasesForSession() returns, each detected bias
// is classified via classifyBiasSignal() against the session's ontology_vector.
// The signal_type ('distorting' | 'neutral' | 'adaptive') is stored inside
// activation_contexts per session — no new DB column required.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import {
  scoreBiasesForSession,
  classifyBiasSignal,
  BIAS_PARAMETERS,
} from '@/lib/bias-scorer'
import type { OntologyScoreMap } from '@/lib/bias-scorer'

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { sessionId } = body as { sessionId: string }

    if (!sessionId) {
      return NextResponse.json({ error: 'sessionId required' }, { status: 400 })
    }

    const supabase = createServiceClient()

    // ── 1. Idempotency check ───────────────────────────────────────────────
    const { data: existingRows } = await supabase
      .from('bias_library')
      .select('id')
      .contains('session_ids', [sessionId])
      .limit(1)

    if (existingRows && existingRows.length > 0) {
      console.log(`[BiasScore] Already scored session ${sessionId} — skipping`)
      return NextResponse.json({ status: 'ok', skipped: true })
    }

    // ── 2. Fetch session + full identity chain ─────────────────────────────
    const { data: session, error: sessionErr } = await supabase
      .from('sessions')
      .select('id, decision_text, context_text, user_id, user_email, device_id')
      .eq('id', sessionId)
      .single()

    if (sessionErr || !session) {
      console.error('[BiasScore] Session not found:', sessionId, sessionErr)
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }

    const resolvedUserId    = session.user_id    ?? null
    const resolvedUserEmail = session.user_email ?? null
    const resolvedDeviceId  = session.device_id  ?? null

    const identityTier =
      resolvedUserId    ? 'user_id'    :
      resolvedUserEmail ? 'user_email' :
      resolvedDeviceId  ? 'device_id'  : 'anonymous'

    console.log(`[BiasScore] Scoring session ${sessionId} (identity: ${identityTier})`)

    // ── 3. Read persona responses ──────────────────────────────────────────
    const { data: messages } = await supabase
      .from('messages')
      .select('persona, content, role')
      .eq('session_id', sessionId)
      .eq('role', 'assistant')
      .not('persona', 'in', '(synthesis,decision_brief)')
      .order('created_at', { ascending: true })

    if (!messages || messages.length === 0) {
      console.warn(`[BiasScore] No persona messages found for session ${sessionId} — aborting`)
      return NextResponse.json({ status: 'ok', skipped: true, reason: 'no_messages' })
    }

    const personaResponses: Record<string, string> = {}
    for (const msg of messages) {
      if (!personaResponses[msg.persona]) {
        personaResponses[msg.persona] = msg.content
      } else {
        personaResponses[msg.persona] += '\n\n' + msg.content
      }
    }

    // ── 4. Fetch examiner Q&A ─────────────────────────────────────────────
    const { data: examinerRows } = await supabase
      .from('examiner_responses')
      .select('question_text, response_text, question_order, unknown_unknown_gap')
      .eq('session_id', sessionId)
      .not('response_text', 'is', null)
      .order('question_order', { ascending: true })

    const examinerQA: Array<{ question: string; answer: string }> =
      (examinerRows ?? [])
        .filter(r => r.response_text?.trim())
        .map(r => ({ question: r.question_text, answer: r.response_text! }))

    // ── 5. Fetch ontology tag + vector ────────────────────────────────────
    // Sprint 20: also fetch ontology_vector for signal classification
    const { data: ontology } = await supabase
      .from('sessions_ontology')
      .select('raw_ontology_json, ontology_vector, decision_type_primary, instrumental_weight, constitutive_weight, dominant_emotion, has_stated_deadline, counterparty_present')
      .eq('session_id', sessionId)
      .maybeSingle()

    const ontologyJson = ontology?.raw_ontology_json as Record<string, unknown> | null ?? null

    // Build the OntologyScoreMap for signal classification.
    // ontology_vector is stored as { dim_name: { score, confidence } }
    const ontologyVector: OntologyScoreMap | null =
      (ontology?.ontology_vector as OntologyScoreMap | null) ?? null

    // ── 6. Score biases ───────────────────────────────────────────────────
    const result = await scoreBiasesForSession({
      sessionId,
      decisionText:     session.decision_text,
      contextText:      session.context_text ?? null,
      personaResponses,
      examinerQA,
      ontologyJson,
    })

    const detected = result.scores.filter(s => s.detected)
    console.log(`[BiasScore] Scored ${result.scores.length} parameters. Detected: ${detected.map(s => s.bias_key).join(', ') || 'none'}`)

    if (detected.length === 0) {
      return NextResponse.json({ status: 'ok', detected: 0 })
    }

    // ── 7. Upsert into bias_library ───────────────────────────────────────
    let upsertedCount = 0

    for (const score of detected) {
      const biasParam = BIAS_PARAMETERS.find(b => b.key === score.bias_key)
      if (!biasParam) continue

      // Sprint 20: classify signal type for this detection in this session's context
      const signalType = classifyBiasSignal(score.bias_key, score, ontologyVector)

      const newActivationContext = {
        ...score.activation_context,
        reasoning:        score.reasoning,
        prosecutor_score: score.prosecutor_score,
        defense_score:    score.defense_score,
        decision_type:    ontology?.decision_type_primary ?? score.activation_context?.decision_type ?? null,
        signal_type:      signalType,   // ← Sprint 20: stored per-session in JSONB
      }

      let existingBias: {
        id: string
        detection_count: number
        confidence_weight: number
        asymmetry_score_avg: number
        session_ids: string[]
        activation_contexts: Record<string, unknown>
      } | null = null

      if (resolvedUserId) {
        const { data } = await supabase
          .from('bias_library')
          .select('id, detection_count, confidence_weight, asymmetry_score_avg, session_ids, activation_contexts')
          .eq('bias_parameter', score.bias_key)
          .eq('user_id', resolvedUserId)
          .limit(1)
          .maybeSingle()
        existingBias = data
      } else if (resolvedUserEmail) {
        const { data } = await supabase
          .from('bias_library')
          .select('id, detection_count, confidence_weight, asymmetry_score_avg, session_ids, activation_contexts')
          .eq('bias_parameter', score.bias_key)
          .eq('user_email', resolvedUserEmail)
          .limit(1)
          .maybeSingle()
        existingBias = data
      } else if (resolvedDeviceId) {
        const { data } = await supabase
          .from('bias_library')
          .select('id, detection_count, confidence_weight, asymmetry_score_avg, session_ids, activation_contexts')
          .eq('bias_parameter', score.bias_key)
          .eq('device_id', resolvedDeviceId)
          .limit(1)
          .maybeSingle()
        existingBias = data
      }

      if (existingBias) {
        const newCount  = existingBias.detection_count + 1
        const newWeight = Math.min(existingBias.confidence_weight + 0.30, 1.0)
        const newAvg    = ((existingBias.asymmetry_score_avg ?? 0) * existingBias.detection_count + (score.asymmetry ?? 0)) / newCount
        const mergedIds = Array.from(new Set([...(existingBias.session_ids ?? []), sessionId]))
        const mergedCtx = {
          ...(existingBias.activation_contexts as Record<string, unknown> ?? {}),
          [sessionId]: newActivationContext,
        }

        await supabase
          .from('bias_library')
          .update({
            detection_count:     newCount,
            confidence_weight:   newWeight,
            asymmetry_score_avg: Math.round(newAvg * 100) / 100,
            session_ids:         mergedIds,
            activation_contexts: mergedCtx,
            updated_at:          new Date().toISOString(),
          })
          .eq('id', existingBias.id)
      } else {
        await supabase.from('bias_library').insert({
          user_id:             resolvedUserId,
          user_email:          resolvedUserEmail,
          device_id:           resolvedDeviceId,
          session_ids:         [sessionId],
          bias_parameter:      score.bias_key,
          detection_count:     1,
          confidence_weight:   0.30,
          asymmetry_score_avg: score.asymmetry,
          activation_contexts: {
            [sessionId]: newActivationContext,
          },
        })
      }

      upsertedCount++
    }

    console.log(`[BiasScore] Upserted ${upsertedCount} bias rows`)

    return NextResponse.json({
      status:          'ok',
      session_id:      sessionId,
      detected:        detected.length,
      biases_detected: detected.map(s => s.bias_key),
    })

  } catch (err) {
    console.error('[BiasScore] Error:', err)
    return NextResponse.json({ error: 'Scoring failed', detail: String(err) }, { status: 500 })
  }
}

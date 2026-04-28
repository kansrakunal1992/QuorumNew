// app/api/bias-score/route.ts
// ── Sprint 4: Bias Library — Background Scoring Endpoint ─────────────────────
//
// Called fire-and-forget from SynthesisCard once synthesis state === 'done'.
// Never blocks the UI. If this fails, the session still works.
//
// Flow:
//   1. Receive sessionId + personaResponses + optional userEmail
//   2. Fetch session decision text + context from Supabase
//   3. Fetch ontology tag if available
//   4. Run scoreBiasesForSession (adversarial 15-parameter pass)
//   5. Upsert results into bias_library (one row per bias_key per user_email)
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { scoreBiasesForSession, BIAS_PARAMETERS } from '@/lib/bias-scorer'

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { sessionId, personaResponses, userEmail } = body as {
      sessionId: string
      personaResponses: Record<string, string>
      userEmail?: string
    }

    if (!sessionId || !personaResponses || Object.keys(personaResponses).length === 0) {
      return NextResponse.json({ error: 'sessionId and personaResponses required' }, { status: 400 })
    }

    const supabase = createServiceClient()

    // ── 1. Fetch session ───────────────────────────────────────────────────
    const { data: session, error: sessionErr } = await supabase
      .from('sessions')
      .select('id, decision_text, context_text')
      .eq('id', sessionId)
      .single()

    if (sessionErr || !session) {
      console.error('[BiasScore] Session not found:', sessionId, sessionErr)
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }

    // ── 2. Fetch ontology tag ─────────────────────────────────────────────
    const { data: ontology } = await supabase
      .from('sessions_ontology')
      .select('raw_ontology_json, decision_type_primary, instrumental_weight, constitutive_weight, dominant_emotion, has_stated_deadline, counterparty_present')
      .eq('session_id', sessionId)
      .single()

    const ontologyJson = ontology?.raw_ontology_json as Record<string, unknown> | null ?? null

    // ── 3. Score biases ───────────────────────────────────────────────────
    console.log(`[BiasScore] Scoring session ${sessionId} — ${Object.keys(personaResponses).length} personas`)

    const result = await scoreBiasesForSession({
      sessionId,
      decisionText: session.decision_text,
      contextText: session.context_text ?? null,
      personaResponses,
      ontologyJson,
    })

    console.log(`[BiasScore] Scored ${result.scores.length} parameters. Detected: ${result.scores.filter(s => s.detected).map(s => s.bias_key).join(', ') || 'none'}`)

    // ── 4. Upsert into bias_library ───────────────────────────────────────
    // One row per (user_email, bias_parameter) — upsert to accumulate over time.
    const detectedScores = result.scores.filter(s => s.detected)

    if (detectedScores.length === 0) {
      console.log(`[BiasScore] No biases detected above threshold for session ${sessionId}`)
      return NextResponse.json({ status: 'ok', detected: 0 })
    }

    // Build upsert rows — one per detected bias
    const upsertRows = detectedScores.map(score => {
      const biasParam = BIAS_PARAMETERS.find(b => b.key === score.bias_key)
      return {
        user_email: userEmail ?? null,
        session_ids: [sessionId],             // will be merged on conflict
        bias_parameter: score.bias_key,
        detection_count: 1,                   // will be incremented on conflict
        confidence_weight: Math.min(0.3, 1.0),
        asymmetry_score_avg: score.asymmetry,
        activation_contexts: {
          [sessionId]: {
            ...score.activation_context,
            reasoning: score.reasoning,
            prosecutor_score: score.prosecutor_score,
            defense_score: score.defense_score,
            decision_type_primary: ontology?.decision_type_primary ?? null,
          }
        },
      }
    })

    // Upsert using ON CONFLICT: if row exists, increment detection_count and update scores
    for (const row of upsertRows) {
      // Check if row already exists
      const { data: existing } = await supabase
        .from('bias_library')
        .select('id, detection_count, confidence_weight, asymmetry_score_avg, session_ids, activation_contexts')
        .eq('user_email', row.user_email ?? '')
        .eq('bias_parameter', row.bias_parameter)
        .single()

      if (existing) {
        // Merge: update running stats
        const newCount    = existing.detection_count + 1
        const newWeight   = Math.min(existing.confidence_weight + 0.30, 1.0)
        const newAvg      = ((existing.asymmetry_score_avg ?? 0) * existing.detection_count + (row.asymmetry_score_avg ?? 0)) / newCount
        const mergedIds   = Array.from(new Set([...(existing.session_ids ?? []), sessionId]))
        const mergedCtx   = { ...(existing.activation_contexts as Record<string, unknown> ?? {}), ...row.activation_contexts }

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
          .eq('id', existing.id)
      } else {
        // Insert fresh row
        await supabase.from('bias_library').insert({
          user_email:          row.user_email,
          session_ids:         row.session_ids,
          bias_parameter:      row.bias_parameter,
          detection_count:     1,
          confidence_weight:   0.30,
          asymmetry_score_avg: row.asymmetry_score_avg,
          activation_contexts: row.activation_contexts,
        })
      }
    }

    console.log(`[BiasScore] Upserted ${detectedScores.length} bias rows for session ${sessionId}`)

    return NextResponse.json({
      status: 'ok',
      session_id: sessionId,
      detected: detectedScores.length,
      biases_detected: detectedScores.map(s => s.bias_key),
    })

  } catch (err) {
    console.error('[BiasScore] Error:', err)
    return NextResponse.json({ error: 'Scoring failed', detail: String(err) }, { status: 500 })
  }
}

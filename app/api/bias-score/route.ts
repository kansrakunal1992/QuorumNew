// app/api/bias-score/route.ts
// ── Sprint 4: Bias Library — Background Scoring Endpoint ─────────────────────
//
// Called server-side from /api/examiner POST after examiner submit/skip.
// Never called from the client — no client timeout risk.
//
// Reads everything it needs from Supabase:
//   - sessions table       → decision_text, context_text
//   - messages table       → persona responses (already saved by /api/persona)
//   - examiner_responses   → user's answers to diagnostic questions
//   - sessions_ontology    → ontology tag for enrichment
//
// Body: { sessionId: string }  ← that's all that's needed
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { scoreBiasesForSession, BIAS_PARAMETERS } from '@/lib/bias-scorer'

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { sessionId } = body as { sessionId: string }

    if (!sessionId) {
      return NextResponse.json({ error: 'sessionId required' }, { status: 400 })
    }

    const supabase = createServiceClient()

    // ── 1. Idempotency check ───────────────────────────────────────────────
    const { data: existing } = await supabase
      .from('bias_library')
      .select('id, detection_count')
      .eq('session_ids', [sessionId])
      .maybeSingle()

    // Check by session_id match in the session_ids array
    const { data: existingRows } = await supabase
      .from('bias_library')
      .select('id')
      .contains('session_ids', [sessionId])
      .limit(1)

    if (existingRows && existingRows.length > 0) {
      console.log(`[BiasScore] Already scored session ${sessionId} — skipping`)
      return NextResponse.json({ status: 'ok', skipped: true })
    }

    // ── 2. Fetch session ───────────────────────────────────────────────────
    const { data: session, error: sessionErr } = await supabase
      .from('sessions')
      .select('id, decision_text, context_text')
      .eq('id', sessionId)
      .single()

    if (sessionErr || !session) {
      console.error('[BiasScore] Session not found:', sessionId, sessionErr)
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }

    // ── 3. Read persona responses from messages table ──────────────────────
    // These are saved by /api/persona as each persona streams.
    // By the time /api/examiner POST fires, all 6 should be present.
    const { data: messages } = await supabase
      .from('messages')
      .select('persona, content, role')
      .eq('session_id', sessionId)
      .eq('role', 'assistant')
      .not('persona', 'in', '(synthesis,decision_brief)')  // exclude meta-personas
      .order('created_at', { ascending: true })

    if (!messages || messages.length === 0) {
      console.warn(`[BiasScore] No persona messages found for session ${sessionId} — aborting`)
      return NextResponse.json({ status: 'ok', skipped: true, reason: 'no_messages' })
    }

    // Collapse multiple messages per persona into one string (handles pushback rounds)
    const personaResponses: Record<string, string> = {}
    for (const msg of messages) {
      if (!personaResponses[msg.persona]) {
        personaResponses[msg.persona] = msg.content
      } else {
        personaResponses[msg.persona] += '\n\n' + msg.content
      }
    }

    console.log(`[BiasScore] Loaded ${Object.keys(personaResponses).length} personas from DB for ${sessionId}`)

    // ── 4. Fetch examiner Q&A ─────────────────────────────────────────────
    // User answers to diagnostic questions — high-signal for bias detection
    // (e.g. "my advisor said it's a good deal" → authority deference confirmed)
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

    console.log(`[BiasScore] Loaded ${examinerQA.length} examiner answers for ${sessionId}`)

    // ── 5. Fetch ontology tag ─────────────────────────────────────────────
    const { data: ontology } = await supabase
      .from('sessions_ontology')
      .select('raw_ontology_json, decision_type_primary, instrumental_weight, constitutive_weight, dominant_emotion, has_stated_deadline, counterparty_present')
      .eq('session_id', sessionId)
      .maybeSingle()

    const ontologyJson = ontology?.raw_ontology_json as Record<string, unknown> | null ?? null

    // ── 6. Score biases ───────────────────────────────────────────────────
    console.log(`[BiasScore] Scoring session ${sessionId}`)

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

    // ── 7. Upsert into bias_library ───────────────────────────────────────
    if (detected.length === 0) {
      console.log(`[BiasScore] No biases detected above threshold for session ${sessionId}`)
      return NextResponse.json({ status: 'ok', detected: 0 })
    }

    for (const score of detected) {
      const biasParam = BIAS_PARAMETERS.find(b => b.key === score.bias_key)
      if (!biasParam) continue

      // Check if this bias already has a row (cross-session accumulation keyed by bias_parameter only for now — pre-auth)
      // Post-auth (Sprint 6) this will key on user_id
      const { data: existingBias } = await supabase
        .from('bias_library')
        .select('id, detection_count, confidence_weight, asymmetry_score_avg, session_ids, activation_contexts')
        .eq('bias_parameter', score.bias_key)
        .is('user_email', null)  // pre-auth: null user bucket
        .maybeSingle()

      if (existingBias) {
        const newCount  = existingBias.detection_count + 1
        const newWeight = Math.min(existingBias.confidence_weight + 0.30, 1.0)
        const newAvg    = ((existingBias.asymmetry_score_avg ?? 0) * existingBias.detection_count + (score.asymmetry ?? 0)) / newCount
        const mergedIds = Array.from(new Set([...(existingBias.session_ids ?? []), sessionId]))
        const mergedCtx = {
          ...(existingBias.activation_contexts as Record<string, unknown> ?? {}),
          [sessionId]: {
            ...score.activation_context,
            reasoning:         score.reasoning,
            prosecutor_score:  score.prosecutor_score,
            defense_score:     score.defense_score,
            decision_type:     ontology?.decision_type_primary ?? null,
          },
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
          user_email:          null,
          session_ids:         [sessionId],
          bias_parameter:      score.bias_key,
          detection_count:     1,
          confidence_weight:   0.30,
          asymmetry_score_avg: score.asymmetry,
          activation_contexts: {
            [sessionId]: {
              ...score.activation_context,
              reasoning:         score.reasoning,
              prosecutor_score:  score.prosecutor_score,
              defense_score:     score.defense_score,
              decision_type:     ontology?.decision_type_primary ?? null,
            },
          },
        })
      }
    }

    console.log(`[BiasScore] Upserted ${detected.length} bias rows for session ${sessionId}`)

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

// app/api/bias-score/route.ts
// ── Sprint 4 / 4b: Bias Library — Background Scoring Endpoint ────────────────
// ── Sprint 20: Added signal_type classification per detection ─────────────────
// ── Sprint R2: Human-inputs-only scoring ─────────────────────────────────────
//
// Called server-side from /api/examiner POST after examiner submit/skip.
//
// Sprint 20 change: after scoreBiasesForSession() returns, each detected bias
// is classified via classifyBiasSignal() against the session's ontology_vector.
// The signal_type ('distorting' | 'neutral' | 'adaptive') is stored inside
// activation_contexts per session — no new DB column required.
//
// Sprint R2 change: bias scoring now reads ONLY human-authored inputs.
//
//   REMOVED: reading assistant-role (LLM) persona messages as scoring evidence.
//   ADDED:   reading user-role messages (pushback typed by the decision-maker)
//            as secondary evidence.
//
//   Why this matters: if a persona mentions FOMO in its analysis, the old scorer
//   would record FOMO in the user's fingerprint — but that's the LLM's observation,
//   not a pattern the user exhibited. The fingerprint must reflect the decision-
//   maker's own cognitive patterns, not echoes of what advisors said about them.
//
//   Guard change: abort condition updated from "no persona messages" to
//   "no decision_text" — decision_text is always present; the session is always
//   scoreable even without examiner answers or pushback (early sessions).
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import {
  scoreBiasesForSession,
  classifyBiasSignal,
  BIAS_PARAMETERS,
} from '@/lib/bias-scorer'
import type { OntologyScoreMap } from '@/lib/bias-scorer'
import { decrypt } from '@/lib/encryption'

export async function POST(req: Request) {
  // S5-03: internal route — only accessible from server-side fetch with INTERNAL_API_SECRET
  const internalSecret = process.env.INTERNAL_API_SECRET
  const incoming = req.headers.get('x-internal-secret')
  if (internalSecret && incoming !== internalSecret) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

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

    // Decrypt raw user input before any use
    const decisionText = decrypt(session.decision_text) ?? ''
    const contextText  = decrypt(session.context_text)  ?? null

    if (!decisionText.trim()) {
      console.warn(`[BiasScore] No decision_text for session ${sessionId} — aborting`)
      return NextResponse.json({ status: 'ok', skipped: true, reason: 'no_decision_text' })
    }

    const resolvedUserId    = session.user_id    ?? null
    const resolvedUserEmail = session.user_email ?? null
    const resolvedDeviceId  = session.device_id  ?? null

    const identityTier =
      resolvedUserId    ? 'user_id'    :
      resolvedUserEmail ? 'user_email' :
      resolvedDeviceId  ? 'device_id'  : 'anonymous'

    console.log(`[BiasScore] Scoring session ${sessionId} (identity: ${identityTier})`)

    // ── 3. Read user pushback messages (human inputs only) ─────────────────
    // Sprint R2: reads ONLY role='user' messages — the decision-maker's own
    // pushback messages typed during advisor conversations.
    // Excludes all role='assistant' persona outputs to prevent contamination.
    const { data: userMessages } = await supabase
      .from('messages')
      .select('content, role')
      .eq('session_id', sessionId)
      .eq('role', 'user')
      .order('created_at', { ascending: true })

    const pushbackTexts: string[] = (userMessages ?? [])
      .map(m => (decrypt(m.content) ?? '').trim())
      .filter((t): t is string => Boolean(t) && t.length > 0)

    console.log(`[BiasScore] ${pushbackTexts.length} user pushback message(s) for session ${sessionId}`)

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
        .map(r => ({
          question: decrypt(r.question_text) ?? '',
          answer:   decrypt(r.response_text)  ?? '',
        }))

    if (examinerQA.length === 0 && pushbackTexts.length === 0) {
      console.log(`[BiasScore] Scoring from decision_text only for session ${sessionId} — no examiner or pushback data yet`)
    }

    // ── 5. Fetch ontology tag + vector ────────────────────────────────────
    const { data: ontology } = await supabase
      .from('sessions_ontology')
      .select('raw_ontology_json, ontology_vector, decision_type_primary, instrumental_weight, constitutive_weight, dominant_emotion, has_stated_deadline, counterparty_present')
      .eq('session_id', sessionId)
      .maybeSingle()

    const ontologyJson = ontology?.raw_ontology_json as Record<string, unknown> | null ?? null

    const ontologyVector: OntologyScoreMap | null =
      (ontology?.ontology_vector as OntologyScoreMap | null) ?? null

    // ── 6. Score biases (human inputs only) ───────────────────────────────
    const result = await scoreBiasesForSession({
      sessionId,
      decisionText:  decisionText,
      contextText:   contextText,
      pushbackTexts,
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
      } else {
        // Anonymous session: use synthetic device_id keyed to this session so
        // the row is retrievable by bias-note GET even with no persistent identity.
        // Format 'anon:<sessionId>' is distinguishable from real device IDs.
        const { data } = await supabase
          .from('bias_library')
          .select('id, detection_count, confidence_weight, asymmetry_score_avg, session_ids, activation_contexts')
          .eq('bias_parameter', score.bias_key)
          .eq('device_id', `anon:${sessionId}`)
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
          // Anonymous sessions get a synthetic device_id so the row is
          // retrievable by bias-note GET; real device IDs are used as-is.
          device_id:           resolvedDeviceId ?? (identityTier === 'anonymous' ? `anon:${sessionId}` : null),
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

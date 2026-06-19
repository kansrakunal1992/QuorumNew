/**
 * QUORUM — Persona Route (Sprint 19 / R2 / R1 / R3 / R5 update)
 *
 * Sprint 19 additions:
 *
 *   Council Context Enrichment — extended to all 6 initial personas
 *     Previously (Sprint 12), buildCouncilContext() was only injected for
 *     'synthesis' and 'decision_brief'. Initial Council personas ran blind
 *     to rule engine signals.
 *
 *     Now: fetchCouncilContext() fires for ALL persona calls where
 *     messages.length === 0 (first-pass Council) AND the session has a
 *     stored v2.0 ontology_vector + rule_engine_result.
 *
 *     Pushback calls (messages.length > 0, !rawMessages) are excluded —
 *     they are user-reactive and don't need structural re-injection.
 *
 *     Gracefully no-ops for v1.0 sessions or missing data. Non-blocking.
 *
 * Sprint R2 additions:
 *
 *   Longitudinal Bias Injection — all initial personas + synthesis
 *
 *     fetchUserBiasContext() queries bias_library for the user's bias profile
 *     (detection_count >= 1, so early users with 1–3 sessions are included)
 *     and injects two differentiated blocks:
 *
 *       personaAlert    → appended to each initial persona's system prompt.
 *                         Single sentence. Only fires for CONFIRMED + DISTORTING
 *                         biases (detection_count >= 2 + signal = distorting).
 *
 *       synthesisBlock  → appended to synthesis system prompt. Full block with
 *                         all bias rows (confirmed + forming), all scores, and
 *                         a MANDATORY assessment directive.
 *
 *     userId is resolved server-side from the sessions table using sessionId —
 *     no client-side change required (PersonaPanel/SynthesisCard unchanged).
 *
 * Sprint R1 additions:
 *
 *   Persona-specific structural directives
 *     getPersonaStructuralDirective(personaKey) appended to structuralBlock.
 *     contrarian and stakeholder_mirror added to PERSONAS_WITH_STRUCTURAL_CONTEXT.
 *
 *   System prompt layer order (after R1):
 *     1. persona.prompt            — core identity and mandate
 *     2. councilContext            — ontology + rule engine signals
 *     3. synthesisBlock            — longitudinal bias record (synthesis only)
 *     4. pushbackProtocol          — pushback acknowledgment (pushback calls only)
 *     5. personaAlertBlock         — top distorting bias alert (initial personas only)
 *
 * Sprint R3 additions:
 *
 *   Council Weighting Directive — synthesis only, non-negotiable
 *
 *     computePersonaRelevance() scores all 6 advisor personas against the
 *     session's rule engine signals, ontology dimensions, and structural match
 *     quality. buildRelevanceBlock() serialises the result as a MANDATORY
 *     NON-NEGOTIABLE directive appended as the final layer in the synthesis
 *     system prompt.
 *
 *     This prevents synthesis from applying flat equal weight to all 6
 *     advisors regardless of which structural dimensions dominate the decision.
 *     A high-irreversibility session where Risk Architect and Contrarian fired
 *     should resolve Council divergence in their favour — not flatten the blend.
 *
 *     Position: appended LAST in the synthesis system prompt (after synthesisBlock)
 *     so it is the final instruction seen before synthesis output begins.
 *     LLM adherence is highest for terminal system prompt instructions.
 *
 *     fetchCouncilContext() extended to also return:
 *       ruleEngineResult  — the full RuleEngineResult (already fetched, now returned)
 *       maxStructuralScore — extracted from matches_json (already in sessions_ontology)
 *     No new DB queries. No client-side changes.
 *
 *   Updated system prompt layer order (after R3, synthesis calls):
 *     1. persona.prompt            — core identity and mandate
 *     2. councilContext            — ontology + rule engine signals
 *     3. synthesisBlock            — longitudinal bias record (synthesis only)
 *     4. relevanceBlock            — MANDATORY council weighting directive (synthesis only) ← NEW
 *
 * Sprint R5 additions:
 *
 *   Structural output traceability (conditional)
 *     A lightweight output requirement appended to the structuralBlock — inside
 *     the user turn, after the existing persona-specific structural mandate.
 *
 *     Design: conditional, not mandatory. If the structural record genuinely
 *     shaped the persona's angle, they close with one sentence beginning
 *     \"Structurally, this decision [observation].\" If the record did not apply
 *     to their specific analytical angle, the sentence is omitted entirely.
 */

import { PERSONAS }                            from '@/lib/personas'
import { createServiceClient }                 from '@/lib/supabase'
import { createStream }                        from '@/lib/ai-client'
import {
  PERSONAS_WITH_STRUCTURAL_CONTEXT,
  getPersonaStructuralDirective,             // Sprint R1
}                                            from '@/lib/structural-retrieval'
import { buildCouncilContext }               from '@/lib/rule-engine'
import { fetchUserBiasContext }              from '@/lib/bias-scorer'
import { computePersonaRelevance, buildRelevanceBlock } from '@/lib/persona-relevance'  // Sprint R3
import type { OntologyScoreMap }             from '@/lib/bias-scorer'
import type { ScoredVector }                 from '@/lib/ontology-tagger'
import type { RuleEngineResult }             from '@/lib/rule-engine'
import type { PersonaKey, Message }          from '@/lib/types'
import { checkLimit, getClientIP, tooManyRequests, LIMITS } from '@/lib/rate-limit'
import { encrypt }                           from '@/lib/encryption'

// ── Council context fetch (Sprint 12 / R2 / R3 update) ───────────────────────
//
// Sprint R2: return shape extended with userId for fetchUserBiasContext().
// Sprint R3: return shape further extended with ruleEngineResult and
//   maxStructuralScore for computePersonaRelevance() at synthesis time.
//   matches_json added to the select — already stored in sessions_ontology
//   by the structural-match route. No new DB round-trip.

async function fetchCouncilContext(sessionId: string): Promise<{
  councilContextStr:  string | null
  ontologyVector:     OntologyScoreMap | null
  userId:             string | null
  ruleEngineResult:   RuleEngineResult | null   // Sprint R3
  maxStructuralScore: number | null             // Sprint R3
}> {
  try {
    const supabase = createServiceClient()

    const [ontologyResult, sessionResult] = await Promise.all([
      supabase
        .from('sessions_ontology')
        .select('tagger_version, ontology_vector, rule_engine_result, matches_json')  // Sprint R3: +matches_json
        .eq('session_id', sessionId)
        .single(),
      supabase
        .from('sessions')
        .select('user_id')
        .eq('id', sessionId)
        .single(),
    ])

    const userId = sessionResult.data?.user_id ?? null

    const { data, error } = ontologyResult
    if (error || !data) return { councilContextStr: null, ontologyVector: null, userId, ruleEngineResult: null, maxStructuralScore: null }
    if (data.tagger_version !== 'v2.0') return { councilContextStr: null, ontologyVector: null, userId, ruleEngineResult: null, maxStructuralScore: null }
    if (!data.ontology_vector || !data.rule_engine_result) return { councilContextStr: null, ontologyVector: null, userId, ruleEngineResult: null, maxStructuralScore: null }

    // Sprint R3: extract max structural score from matches_json (JSONB array or null)
    let maxStructuralScore: number | null = null
    try {
      const matches = Array.isArray(data.matches_json)
        ? data.matches_json as Array<{ structural_score?: number }>
        : null
      if (matches && matches.length > 0) {
        const scores = matches.map(m => m.structural_score ?? 0).filter(s => s > 0)
        if (scores.length > 0) maxStructuralScore = Math.max(...scores)
      }
    } catch {
      // matches_json absent or malformed — maxStructuralScore stays null
    }

    const ruleEngineResult = data.rule_engine_result as RuleEngineResult

    return {
      councilContextStr: buildCouncilContext(
        data.ontology_vector as ScoredVector,
        ruleEngineResult,
      ),
      ontologyVector:     data.ontology_vector as OntologyScoreMap,
      userId,
      ruleEngineResult,                    // Sprint R3
      maxStructuralScore,                  // Sprint R3
    }
  } catch (err) {
    console.error('[Persona] fetchCouncilContext failed:', err)
    return { councilContextStr: null, ontologyVector: null, userId: null, ruleEngineResult: null, maxStructuralScore: null }
  }
}

/**
 * Sprint 19 fix — race condition guard for initial personas.
 *
 * Initial personas fire immediately in parallel with ontology tagging.
 * sessions_ontology is often not yet written when the first DB read happens,
 * so fetchCouncilContext returns null silently — context never injected.
 *
 * Fix: retry with 400ms intervals for up to 3 seconds. Ontology typically
 * writes within 1–2 seconds. Adds ≤400ms latency before streaming starts
 * in the common case (first or second retry succeeds), which is imperceptible
 * given personas take 5–15s to complete.
 *
 * Synthesis calls do NOT use this — ontology is always written by then.
 * userId is still returned even when ontology is not yet ready (from sessions table).
 */
async function fetchCouncilContextWithRetry(
  sessionId: string,
  maxWaitMs  = 3000,
  intervalMs = 400,
): Promise<{
  councilContextStr:  string | null
  ontologyVector:     OntologyScoreMap | null
  userId:             string | null
  ruleEngineResult:   RuleEngineResult | null
  maxStructuralScore: number | null
}> {
  const start = Date.now()
  while (true) {
    const result = await fetchCouncilContext(sessionId)
    if (result.councilContextStr !== null) return result
    const elapsed = Date.now() - start
    if (elapsed + intervalMs >= maxWaitMs) return result
    await new Promise(r => setTimeout(r, intervalMs))
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  // S5-01: rate limit persona calls — 60 per 10 min per IP
  const rlResult = checkLimit(getClientIP(req), LIMITS.persona)
  if (!rlResult.allowed) return tooManyRequests(rlResult, 'analysis requests')

  try {
    const {
      sessionId,
      personaKey,
      messages,
      decisionText,
      contextText,
      rawMessages,
      registerMode,
      structuralContext,
      examinerContext,
      resubmitAlertId,
      isExaminerContextCall,
    }: {
      sessionId:               string
      personaKey:              PersonaKey
      messages:                Message[]
      decisionText:            string
      contextText?:            string
      rawMessages?:            boolean
      registerMode?:           'analytical' | 'clarification'
      isExaminerContextCall?:  boolean   // set by share-context + examiner updates — skips pushbackProtocol injection only; saves still run
      structuralContext?: string
      examinerContext?:   string
      resubmitAlertId?:   string   // Sprint D3: set when session resubmitted from avoidance alert
    } = await req.json()

    const persona = PERSONAS[personaKey]
    if (!persona) return new Response('Unknown persona', { status: 400 })

    // ── Determine call type ───────────────────────────────────────────────────
    const isSynthesisCall  = rawMessages && (personaKey === 'synthesis' || personaKey === 'decision_brief')
    const isInitialPersona = !rawMessages && messages.length === 0

    // ── Fetch council context + userId in one shot ────────────────────────────
    // Sprint R3: councilContextPromise now also resolves ruleEngineResult and
    // maxStructuralScore so computePersonaRelevance() needs no extra DB call.
    const councilContextPromise = (isSynthesisCall || isInitialPersona) && sessionId
      ? isInitialPersona
        ? fetchCouncilContextWithRetry(sessionId)
        : fetchCouncilContext(sessionId)
      : Promise.resolve({ councilContextStr: null, ontologyVector: null, userId: null, ruleEngineResult: null, maxStructuralScore: null })

    // ── Sprint R2: bias context — chained off councilContextPromise ───────────
    const biasContextPromise = (isSynthesisCall || isInitialPersona)
      ? councilContextPromise.then(({ ontologyVector, userId }) =>
          userId
            ? fetchUserBiasContext(userId, ontologyVector)
            : Promise.resolve({ synthesisBlock: '', personaAlert: null, hasAnyBiases: false, personalCalibrationZones: [], personalBiasTriggers: [] })
        )
      : Promise.resolve({ synthesisBlock: '', personaAlert: null, hasAnyBiases: false, personalCalibrationZones: [], personalBiasTriggers: [] })

    // ── Build chat messages ───────────────────────────────────────────────────
    let chatMessages: { role: 'user' | 'assistant'; content: string }[]

    if (rawMessages && messages.length > 0) {
      chatMessages = messages.map(m => ({
        role:    m.role as 'user' | 'assistant',
        content: m.content,
      }))
    } else {
      const registerBlock = registerMode === 'clarification'
        ? `\nSESSION MODE — CLARIFICATION:\nThe decision-maker has indicated they are looking for help understanding what they want, not just analysis of outcomes. They are facing a values or identity question as much as a practical one. Weight your response accordingly: The Elder and Stakeholder Mirror perspectives are most relevant. Surface the values tension before the risk analysis. Do not optimise for a calculable outcome.\n`
        : `\nSESSION MODE — ANALYTICAL:\nThe decision-maker wants rigorous challenge of their thinking. Run your full framework without softening.\n`

      const contextBlock = contextText
        ? `\nCONTEXT PROVIDED BY DECISION-MAKER:\n${contextText}\n`
        : ''

      // Sprint R1: append persona-specific structural directive after shared block.
      // Sprint R5: OUTPUT TRACEABILITY appended after the mandate — conditional.
      const structuralBlock = (
        structuralContext &&
        PERSONAS_WITH_STRUCTURAL_CONTEXT.has(personaKey) &&
        messages.length === 0
      )
        ? `\n${structuralContext}\n\nYOUR STRUCTURAL MANDATE: ${getPersonaStructuralDirective(personaKey)}\n\nOUTPUT TRACEABILITY (conditional): If the structural record above has genuinely shaped your angle — if you can draw a specific parallel or contrast — close your response with exactly one sentence in this form: "Structurally, this decision [your specific observation about the single most relevant signal from the record above]." If the structural memory did not apply to your specific analytical angle, omit this sentence entirely. Do not fabricate a citation.\n`
        : ''

      if (messages.length === 0) {
        const examinerBlock = examinerContext
          ? `\n\nEXAMINER CONTEXT — captured before the Council ran:\n${examinerContext}\n`
          : ''
        chatMessages = [{
          role:    'user',
          content: `${registerBlock}${structuralBlock}DECISION: ${decisionText}${contextBlock}${examinerBlock}\nPlease give your full assessment as ${persona.label}.`,
        }]
      } else {
        chatMessages = [
          {
            role:    'user',
            content: `${registerBlock}${structuralBlock}DECISION: ${decisionText}${contextBlock}\nPlease give your full assessment as ${persona.label}.`,
          },
          ...messages.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
        ]
      }
    }

    // ── Resolve council context + bias context in parallel ────────────────────
    const [councilResult, biasContext] = await Promise.all([
      councilContextPromise,
      biasContextPromise,
    ])
    const councilContext = councilResult.councilContextStr

    // ── Pushback acknowledgment protocol ──────────────────────────────────────
    // Skipped for examiner-context / share-context calls (isExaminerContextCall) —
    // those are supplemental AI-to-AI updates, not real user challenges. Injecting
    // the protocol causes the model to echo instruction text into its response and
    // the wrapper prompt text to leak into record-page "You challenged" blocks.
    const isPushbackCall = !rawMessages && messages.length > 0
    const lastMsg = messages[messages.length - 1]
    const pushbackText = isPushbackCall && !isExaminerContextCall && lastMsg?.role === 'user'
      ? lastMsg.content.trim()
      : null

    const pushbackProtocol = pushbackText
      ? `\n\nMANDATORY PUSHBACK PROTOCOL — NON-NEGOTIABLE:\nThe decision-maker has just submitted the following challenge or new information:\n"${pushbackText}"\n\nRESPONSE FORMAT — follow exactly, no exceptions:\n\n1. FIRST sentence only: identify what they introduced. One sentence. Nothing before it.\n   Valid forms: "You've introduced [X]." / "Your pushback adds [X]." / "The new information here is [X]."\n\n2. THEN in 3–5 sentences: state specifically what this changes in your prior analysis, and what it does NOT change — and why.\n\n3. Stop. Maximum 150 words total.\n\nHARD BANS — any violation renders the response invalid:\n• NEVER open with "PUSHBACK MODE" or any other label, header, or prefix\n• NEVER restart your full analysis framework — no "The pre-mortem:", no "Execution risk:", no "Assumption risk:", no "Dependency risk:" headers\n• NEVER repeat analysis you already gave — cover only what the pushback changes\n• NEVER start with "I" as the first word\n• NEVER use transition openers ("I hear you, but…" / "That said…" / "However…")\n• Keep under 150 words — always finish the sentence you are writing before stopping`
      : ''

    // ── Assemble system prompt ────────────────────────────────────────────────
    // Layer order (synthesis):
    //   1. persona.prompt         — core identity and mandate
    //   2. councilContext         — ontology + rule engine signals
    //   3. synthesisBlock         — longitudinal bias record (synthesis only)
    //   4. relevanceBlock         — MANDATORY council weighting directive (synthesis only) ← R3
    //
    // Layer order (initial personas):
    //   1. persona.prompt
    //   2. councilContext
    //   4. pushbackProtocol       — pushback acknowledgment enforcement (pushback only)
    //   5. personaAlertBlock      — top confirmed+distorting bias (initial personas only)

    let basePrompt = councilContext
      ? `${persona.prompt}\n\n${councilContext}`
      : persona.prompt

    // Layer 3: full bias block for synthesis — MANDATORY directive included
    if (isSynthesisCall && biasContext.synthesisBlock) {
      basePrompt = `${basePrompt}\n\n${biasContext.synthesisBlock}`
      console.log(`[Persona] Longitudinal bias block injected for synthesis | session ${sessionId}`)
    }

    // ── Sprint D3: Resubmission context ───────────────────────────────────────
    // When the user clicked "Bring it back →" from an avoidance alert in Mirror,
    // resubmitAlertId is present. Fetch the alert snapshot and inject a short
    // context block so synthesis acknowledges the elapsed time and asks whether
    // the framing has shifted — without framing it as failure.
    // Non-fatal: if the fetch fails or the userId is unknown, injection is skipped.
    if (isSynthesisCall && resubmitAlertId && councilResult.userId) {
      try {
        const supabaseD3 = createServiceClient()
        const { data: alertRow } = await supabaseD3
          .from('avoidance_alerts')
          .select('days_open, structural_echo, user_id')
          .eq('id', resubmitAlertId)
          .single()

        if (alertRow && (alertRow as any).user_id === councilResult.userId) {
          const daysOpen = (alertRow as any).days_open as number
          const echo     = (alertRow as any).structural_echo as { matchScore: number; decisionSnippet: string } | null

          const echoNote = echo
            ? ` A prior decision was structurally similar to this one (${echo.matchScore}/100 match: "${echo.decisionSnippet.slice(0, 80)}…"). Consider whether the dynamic that applied then is present here.`
            : ''

          const resubmissionBlock = `
RESUBMISSION CONTEXT — read this before synthesising:
This decision was first brought to Quorum ${daysOpen} days ago and was not resolved at that time. The user is now bringing it back.

Your synthesis should:
1. Acknowledge that time has passed — frame elapsed time as information, not as failure or avoidance. Something like: "The fact that this has been open for ${daysOpen} days is itself worth reading — whether that's because the conditions weren't right, or because something has shifted in the framing."
2. Note whether anything in the current Council analysis suggests the question has changed since it was first brought. If the framing, stakes, or options look different, name what changed and what that implies for the direction of this analysis.
3. Do NOT use the phrase "you avoided this" or any language that frames the elapsed time as a failure. The observation is neutral — time open is a signal, not an indictment.${echoNote}

MANDATORY: weave this context into your synthesis naturally. Do not create a separate section header for it.`

          basePrompt = `${basePrompt}\n\n${resubmissionBlock.trim()}`
          console.log(`[Persona] Resubmission context injected for synthesis | alert ${resubmitAlertId.slice(0, 8)} | ${daysOpen}d open`)
        }
      } catch (err) {
        // Non-fatal — synthesis proceeds without resubmission context
        console.warn('[Persona] Resubmission context fetch failed (non-fatal):', err)
      }
    }

    // Layer 4 (R3): council weighting directive — synthesis only, always last
    // Fires even when councilContext is null (persona may still have useful
    // baseline weights from ontology dimensions). No-ops gracefully if both
    // ruleEngineResult and ontologyVector are null (returns baseline 0.50 map
    // which produces a flat directive — still valid, just less informative).
    // Sprint CAL: personalCalibrationZones threaded through from biasContext —
    // already resolved above, no extra DB call needed.
    if (isSynthesisCall) {
      const relevanceMap = computePersonaRelevance(
        councilResult.ruleEngineResult,
        councilResult.ontologyVector,
        councilResult.maxStructuralScore,
        biasContext.personalCalibrationZones,
      )
      const relevanceBlock = buildRelevanceBlock(
        relevanceMap,
        councilResult.ruleEngineResult,
        councilResult.ontologyVector,
        councilResult.maxStructuralScore,
        biasContext.personalCalibrationZones,
      )
      basePrompt = `${basePrompt}${relevanceBlock}`
      console.log(`[Persona] Council weighting directive injected for synthesis | session ${sessionId}`)
    }

    // Layer 5: one-sentence bias alert for initial personas (confirmed + distorting only)
    const personaAlertBlock = (isInitialPersona && biasContext.personaAlert)
      ? `\n\n${biasContext.personaAlert}`
      : ''

    const systemPrompt = `${basePrompt}${pushbackProtocol}${personaAlertBlock}`

    if (councilContext) {
      console.log(`[Persona] Council context injected for ${personaKey} (${isInitialPersona ? 'initial' : 'synthesis'}) | session ${sessionId}`)
    }
    if (isInitialPersona && biasContext.personaAlert) {
      console.log(`[Persona] Bias alert injected for ${personaKey} | session ${sessionId}`)
    }

    // ── Stream ────────────────────────────────────────────────────────────────
    const { readable, getContent } = await createStream(
      systemPrompt,
      chatMessages,
      personaKey === 'synthesis' ? 'anthropic' : 'deepseek',
    )

    const passthrough = new ReadableStream<Uint8Array>({
      async start(controller) {
        const reader  = readable.getReader()
        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            controller.enqueue(value)
          }

          const assistantContent = getContent()?.trim()
          const supabase         = createServiceClient()

          // Save pushback / share-context user message.
          // For isExaminerContextCall, this is the examiner wrapper; the brief PDF
          // strips it via cleanPushbackText() and the record page does the same.
          // We save it so the full exchange (user context + advisor update) is
          // captured in the record and included in the Decision Brief.
          if (sessionId && messages.length > 0 && !rawMessages) {
            const lastMsg = messages[messages.length - 1]
            if (lastMsg.role === 'user') {
              await supabase.from('messages').insert({
                session_id: sessionId,
                persona:    personaKey,
                role:       'user',
                content:    encrypt(lastMsg.content),
              })
            }
          }

          // Save assistant response.
          // For isExaminerContextCall this is the advisor's update after receiving
          // peer-challenge context — deliberately saved so it appears in the record
          // page and is included in the Decision Brief PDF.
          if (sessionId && assistantContent) {
            const { error } = await supabase.from('messages').insert({
              session_id: sessionId,
              persona:    personaKey,
              role:       'assistant',
              content:    encrypt(assistantContent),
            })
            if (error) console.error('[Persona] Supabase insert error:', error)
          }

          controller.close()
        } catch (err) {
          controller.error(err)
        }
      },
    })

    return new Response(passthrough, {
      headers: {
        'Content-Type':      'text/plain; charset=utf-8',
        'Cache-Control':     'no-cache',
        'X-Accel-Buffering': 'no',
      },
    })
  } catch (err) {
    console.error('[Persona] Route error:', err)
    return new Response('Internal server error', { status: 500 })
  }
}

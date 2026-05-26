/**
 * QUORUM — Persona Route (Sprint 19 update)
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
 */

import { PERSONAS }                            from '@/lib/personas'
import { createServiceClient }                 from '@/lib/supabase'
import { createStream }                        from '@/lib/ai-client'
import { PERSONAS_WITH_STRUCTURAL_CONTEXT }    from '@/lib/structural-retrieval'
import { buildCouncilContext }                 from '@/lib/rule-engine'
import type { ScoredVector }                   from '@/lib/ontology-tagger'
import type { RuleEngineResult }               from '@/lib/rule-engine'
import type { PersonaKey, Message }            from '@/lib/types'

// ── Council context fetch (Sprint 12) ─────────────────────────────────────────

/**
 * Fetches the stored ontology_vector and rule_engine_result for a session,
 * then returns a buildCouncilContext block.
 *
 * Returns null if the session is v1.0, data is unavailable, or any fetch fails.
 */
async function fetchCouncilContext(sessionId: string): Promise<string | null> {
  try {
    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from('sessions_ontology')
      .select('tagger_version, ontology_vector, rule_engine_result')
      .eq('session_id', sessionId)
      .single()

    if (error || !data) return null
    if (data.tagger_version !== 'v2.0') return null
    if (!data.ontology_vector || !data.rule_engine_result) return null

    return buildCouncilContext(
      data.ontology_vector  as ScoredVector,
      data.rule_engine_result as RuleEngineResult,
    )
  } catch (err) {
    // Non-fatal — synthesis falls back to standard system prompt
    console.error('[Persona] fetchCouncilContext failed:', err)
    return null
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
 */
async function fetchCouncilContextWithRetry(
  sessionId: string,
  maxWaitMs = 3000,
  intervalMs = 400,
): Promise<string | null> {
  const start = Date.now()
  while (true) {
    const result = await fetchCouncilContext(sessionId)
    if (result !== null) return result
    const elapsed = Date.now() - start
    if (elapsed + intervalMs >= maxWaitMs) return null
    await new Promise(r => setTimeout(r, intervalMs))
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(req: Request) {
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
    }: {
      sessionId:         string
      personaKey:        PersonaKey
      messages:          Message[]
      decisionText:      string
      contextText?:      string
      rawMessages?:      boolean
      registerMode?:     'analytical' | 'clarification'
      structuralContext?: string
      examinerContext?:  string   // C0 + rule answers baked into initial persona call (new flow)
    } = await req.json()

    const persona = PERSONAS[personaKey]
    if (!persona) return new Response('Unknown persona', { status: 400 })

    // ── Sprint 19: council context for all initial personas + synthesis ───────
    // Fetched in parallel with message construction to avoid blocking.
    // Fires for:
    //   - All 6 initial Council personas (messages.length === 0, !rawMessages)
    //   - synthesis / decision_brief (rawMessages path — unchanged from Sprint 12)
    // Excluded: pushback calls (messages.length > 0, !rawMessages) — user-reactive,
    //   structural re-injection would distort the pushback dynamic.
    const isSynthesisCall  = rawMessages && (personaKey === 'synthesis' || personaKey === 'decision_brief')
    const isInitialPersona = !rawMessages && messages.length === 0
    const councilContextPromise = (isSynthesisCall || isInitialPersona) && sessionId
      ? isInitialPersona
        ? fetchCouncilContextWithRetry(sessionId)  // retry — ontology may not be written yet
        : fetchCouncilContext(sessionId)            // synthesis always fires after ontology
      : Promise.resolve(null)

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

      const structuralBlock = (
        structuralContext &&
        PERSONAS_WITH_STRUCTURAL_CONTEXT.has(personaKey) &&
        messages.length === 0
      )
        ? `\n${structuralContext}\n`
        : ''

      if (messages.length === 0) {
        // ── C0 + rule answers from Examiner — injected for initial persona calls only ──
        // examinerContext is populated when personas fire AFTER examiner submission (new flow).
        // For C0 (JTBD framing), this reaches all 6 personas.
        // For rule answers, SessionView routes them to the relevant persona only.
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

    // ── Resolve system prompt (council context for synthesis) ─────────────────
    const councilContext = await councilContextPromise
    const systemPrompt   = councilContext
      ? `${persona.prompt}\n\n${councilContext}`
      : persona.prompt

    if (councilContext) {
      console.log(`[Persona] Council context injected for ${personaKey} (${isInitialPersona ? 'initial' : 'synthesis'}) | session ${sessionId}`)
    }

    // ── Stream ────────────────────────────────────────────────────────────────
    const { readable, getContent } = await createStream(systemPrompt, chatMessages)

    const passthrough = new ReadableStream<Uint8Array>({
      async start(controller) {
        const reader  = readable.getReader()
        const encoder = new TextEncoder()
        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            controller.enqueue(value)
          }

          const assistantContent = getContent()?.trim()
          const supabase         = createServiceClient()

          // Save pushback user message
          if (sessionId && messages.length > 0 && !rawMessages) {
            const lastMsg = messages[messages.length - 1]
            if (lastMsg.role === 'user') {
              await supabase.from('messages').insert({
                session_id: sessionId,
                persona:    personaKey,
                role:       'user',
                content:    lastMsg.content,
              })
            }
          }

          // Save assistant response
          if (sessionId && assistantContent) {
            const { error } = await supabase.from('messages').insert({
              session_id: sessionId,
              persona:    personaKey,
              role:       'assistant',
              content:    assistantContent,
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

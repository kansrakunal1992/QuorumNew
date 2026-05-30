/**
 * QUORUM — Persona Route (Sprint 19 / R2 / R1 update)
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
 *                         Keeps the 6 parallel persona calls lean.
 *
 *       synthesisBlock  → appended to synthesis system prompt. Full block with
 *                         all bias rows (confirmed + forming), all scores, and
 *                         a MANDATORY assessment directive. Language is calibrated
 *                         per tier: "is present" for confirmed, "may be active"
 *                         for forming.
 *
 *     userId is resolved server-side from the sessions table using sessionId —
 *     no client-side change required (PersonaPanel/SynthesisCard unchanged).
 *
 *     Single DB path: userId fetch is reused by councilContext + biasContext.
 *     Both run in parallel — no added latency on the critical path.
 *
 *     Excluded from pushback calls — bias profile does not change mid-session
 *     and re-injection on pushback would distort the user-reactive dynamic.
 *
 *     Gracefully no-ops (empty blocks) when:
 *       - Session is anonymous (no user_id)
 *       - User has no bias rows at all
 *       - fetchUserBiasContext() throws (non-fatal)
 *
 * Sprint R1 additions:
 *
 *   Persona-specific structural directives
 *     getPersonaStructuralDirective(personaKey) is now imported and appended
 *     to the structuralBlock at injection time. Each of the 5 personas that
 *     receive structural context gets a one-sentence usage mandate tailored to
 *     their analytical role — rather than a single generic instruction.
 *
 *     contrarian and stakeholder_mirror added to PERSONAS_WITH_STRUCTURAL_CONTEXT
 *     in structural-retrieval.ts — no change needed here; the Set expansion is
 *     picked up automatically by the existing PERSONAS_WITH_STRUCTURAL_CONTEXT.has()
 *     guard below.
 *
 *   System prompt layer order (after R1):
 *     1. persona.prompt            — core identity and mandate
 *     2. councilContext            — ontology + rule engine signals
 *     3. synthesisBlock            — longitudinal bias record (synthesis only)
 *     4. pushbackProtocol          — pushback acknowledgment (pushback calls only)
 *     5. personaAlertBlock         — top distorting bias alert (initial personas only)
 *
 *   structuralBlock layer (user turn, initial personas only):
 *     shared context block + persona-specific directive suffix
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
import type { OntologyScoreMap }             from '@/lib/bias-scorer'
import type { ScoredVector }                 from '@/lib/ontology-tagger'
import type { RuleEngineResult }             from '@/lib/rule-engine'
import type { PersonaKey, Message }          from '@/lib/types'

// ── Council context fetch (Sprint 12 / R2 update) ────────────────────────────
//
// Sprint R2: return shape changed from `string | null` to an object so we can
// pass ontologyVector to fetchUserBiasContext() without a second DB round-trip.

async function fetchCouncilContext(sessionId: string): Promise<{
  councilContextStr: string | null
  ontologyVector:    OntologyScoreMap | null
  userId:            string | null
}> {
  try {
    const supabase = createServiceClient()

    // Fetch ontology data + user_id in a single parallel pair
    const [ontologyResult, sessionResult] = await Promise.all([
      supabase
        .from('sessions_ontology')
        .select('tagger_version, ontology_vector, rule_engine_result')
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
    if (error || !data) return { councilContextStr: null, ontologyVector: null, userId }
    if (data.tagger_version !== 'v2.0') return { councilContextStr: null, ontologyVector: null, userId }
    if (!data.ontology_vector || !data.rule_engine_result) return { councilContextStr: null, ontologyVector: null, userId }

    return {
      councilContextStr: buildCouncilContext(
        data.ontology_vector  as ScoredVector,
        data.rule_engine_result as RuleEngineResult,
      ),
      ontologyVector: data.ontology_vector as OntologyScoreMap,
      userId,
    }
  } catch (err) {
    console.error('[Persona] fetchCouncilContext failed:', err)
    return { councilContextStr: null, ontologyVector: null, userId: null }
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
): Promise<{ councilContextStr: string | null; ontologyVector: OntologyScoreMap | null; userId: string | null }> {
  const start = Date.now()
  while (true) {
    const result = await fetchCouncilContext(sessionId)
    if (result.councilContextStr !== null) return result
    const elapsed = Date.now() - start
    if (elapsed + intervalMs >= maxWaitMs) return result  // return userId even on timeout
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
      sessionId:          string
      personaKey:         PersonaKey
      messages:           Message[]
      decisionText:       string
      contextText?:       string
      rawMessages?:       boolean
      registerMode?:      'analytical' | 'clarification'
      structuralContext?: string
      examinerContext?:   string
    } = await req.json()

    const persona = PERSONAS[personaKey]
    if (!persona) return new Response('Unknown persona', { status: 400 })

    // ── Determine call type ───────────────────────────────────────────────────
    const isSynthesisCall  = rawMessages && (personaKey === 'synthesis' || personaKey === 'decision_brief')
    const isInitialPersona = !rawMessages && messages.length === 0

    // ── Fetch council context + userId in one shot ────────────────────────────
    // Sprint R2: fetchCouncilContext now also returns userId (from sessions table)
    // so we can pass it to fetchUserBiasContext without a second DB call.
    // Both councilContext and biasContext resolve in parallel via Promise.all.
    const councilContextPromise = (isSynthesisCall || isInitialPersona) && sessionId
      ? isInitialPersona
        ? fetchCouncilContextWithRetry(sessionId)
        : fetchCouncilContext(sessionId)
      : Promise.resolve({ councilContextStr: null, ontologyVector: null, userId: null })

    // ── Sprint R2: bias context — chained off councilContextPromise ───────────
    // Chains (not races) so biasContext uses the ontologyVector already fetched.
    // Net latency: 0ms extra (runs within the same await window as councilContext).
    const biasContextPromise = (isSynthesisCall || isInitialPersona)
      ? councilContextPromise.then(({ ontologyVector, userId }) =>
          userId
            ? fetchUserBiasContext(userId, ontologyVector)
            : Promise.resolve({ synthesisBlock: '', personaAlert: null, hasAnyBiases: false })
        )
      : Promise.resolve({ synthesisBlock: '', personaAlert: null, hasAnyBiases: false })

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
      // getPersonaStructuralDirective() returns '' for non-structural personas —
      // no existence check needed; the PERSONAS_WITH_STRUCTURAL_CONTEXT guard
      // already prevents the block from being assembled for excluded personas.
      const structuralBlock = (
        structuralContext &&
        PERSONAS_WITH_STRUCTURAL_CONTEXT.has(personaKey) &&
        messages.length === 0
      )
        ? `\n${structuralContext}\n\nYOUR STRUCTURAL MANDATE: ${getPersonaStructuralDirective(personaKey)}\n`
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
    const [{ councilContextStr: councilContext }, biasContext] = await Promise.all([
      councilContextPromise,
      biasContextPromise,
    ])

    // ── Pushback acknowledgment protocol ──────────────────────────────────────
    const isPushbackCall = !rawMessages && messages.length > 0
    const lastMsg = messages[messages.length - 1]
    const pushbackText = isPushbackCall && lastMsg?.role === 'user'
      ? lastMsg.content.trim()
      : null

    const pushbackProtocol = pushbackText
      ? `

MANDATORY PUSHBACK PROTOCOL — NON-NEGOTIABLE:
The decision-maker has just submitted the following challenge or new information:
"${pushbackText}"

Your FIRST sentence must name exactly what they introduced. Not your position. Not a restatement of your prior analysis. Not a transition phrase. One sentence that identifies what they brought — the specific argument, fact, or objection — before anything else.

Correct opening forms:
  "You've introduced [X]."
  "Your pushback adds [X] — [your response]."
  "The new information here is [X]."

Forbidden openings:
  Starting with your position ("Two cities is still the right answer…")
  Starting with a transition ("I hear you, but…" / "That said…")
  Starting with a restatement of the decision
  Any form of "I" as the first word

Violation of this rule renders the entire response invalid. Follow it without exception.`
      : ''

    // ── Assemble system prompt ────────────────────────────────────────────────
    // Layer order:
    //   1. persona.prompt         — core identity and mandate (always)
    //   2. councilContext         — ontology + rule engine signals (initial + synthesis)
    //   3. synthesisBlock         — full longitudinal bias record (synthesis only)
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

    // Layer 4: pushback protocol
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
    const { readable, getContent } = await createStream(systemPrompt, chatMessages)

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

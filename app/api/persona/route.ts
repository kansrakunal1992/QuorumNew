/**
 * QUORUM — Persona Route (Sprint 12 update)
 *
 * CHANGES vs Sprint 11:
 *
 *   Council Context Enrichment (Sprint 12 Item 2)
 *     When personaKey is 'synthesis' or 'decision_brief' (rawMessages path),
 *     the route fetches sessions_ontology and calls buildCouncilContext to
 *     prepend a structured decision-structure block to the system prompt.
 *
 *     This gives the synthesis persona awareness of:
 *       - High-signal ontology dimensions (identity stakes, regret asymmetry, etc.)
 *       - Which examiner rules fired (GATE/FLAG) and why
 *     …so it can engage with structural signals rather than treating the session
 *     as a generic advisor conversation.
 *
 *     Only fires for v2.0 sessions (tagger_version = 'v2.0') with a stored
 *     ontology_vector and rule_engine_result. Gracefully no-ops otherwise.
 *     No client-side changes required.
 *
 *   All other paths (6 initial personas, pushbacks) — unchanged.
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
    }: {
      sessionId:         string
      personaKey:        PersonaKey
      messages:          Message[]
      decisionText:      string
      contextText?:      string
      rawMessages?:      boolean
      registerMode?:     'analytical' | 'clarification'
      structuralContext?: string
    } = await req.json()

    const persona = PERSONAS[personaKey]
    if (!persona) return new Response('Unknown persona', { status: 400 })

    // ── Sprint 12: council context for synthesis / decision_brief ────────────
    // Fetched in parallel with message construction to avoid blocking.
    const isSynthesisCall = rawMessages && (personaKey === 'synthesis' || personaKey === 'decision_brief')
    const councilContextPromise = isSynthesisCall && sessionId
      ? fetchCouncilContext(sessionId)
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
        chatMessages = [{
          role:    'user',
          content: `${registerBlock}${structuralBlock}DECISION: ${decisionText}${contextBlock}\nPlease give your full assessment as ${persona.label}.`,
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
      console.log(`[Persona] Council context injected for ${personaKey} | session ${sessionId}`)
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

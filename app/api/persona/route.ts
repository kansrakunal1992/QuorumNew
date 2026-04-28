import { PERSONAS } from '@/lib/personas'
import { createServiceClient } from '@/lib/supabase'
import { createStream } from '@/lib/ai-client'
import { PERSONAS_WITH_STRUCTURAL_CONTEXT } from '@/lib/structural-retrieval'
import type { PersonaKey, Message } from '@/lib/types'

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
      structuralContext,  // Sprint 5: injected for Pattern Analyst, Risk Architect, Elder
    }: {
      sessionId: string
      personaKey: PersonaKey
      messages: Message[]
      decisionText: string
      contextText?: string
      rawMessages?: boolean
      registerMode?: 'analytical' | 'clarification'
      structuralContext?: string
    } = await req.json()

    const persona = PERSONAS[personaKey]
    if (!persona) return new Response('Unknown persona', { status: 400 })

    let chatMessages: { role: 'user' | 'assistant'; content: string }[]

    if (rawMessages && messages.length > 0) {
      chatMessages = messages.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }))
    } else {
      // Register context: injected at the TOP of the user message so it
    // shapes the persona's framing before anything else is read.
    const registerBlock = registerMode === 'clarification'
      ? `\nSESSION MODE — CLARIFICATION:\nThe decision-maker has indicated they are looking for help understanding what they want, not just analysis of outcomes. They are facing a values or identity question as much as a practical one. Weight your response accordingly: The Elder and Stakeholder Mirror perspectives are most relevant. Surface the values tension before the risk analysis. Do not optimise for a calculable outcome.\n`
      : `\nSESSION MODE — ANALYTICAL:\nThe decision-maker wants rigorous challenge of their thinking. Run your full framework without softening.\n`

    const contextBlock = contextText ? `\nCONTEXT PROVIDED BY DECISION-MAKER:\n${contextText}\n` : ''

    // Sprint 5: inject structural memory only for eligible personas, only on first message
    const structuralBlock = (
      structuralContext &&
      PERSONAS_WITH_STRUCTURAL_CONTEXT.has(personaKey) &&
      messages.length === 0  // only on initial analysis, not pushbacks
    )
      ? `\n${structuralContext}\n`
      : ''

      if (messages.length === 0) {
        chatMessages = [{
          role: 'user',
          content: `${registerBlock}${structuralBlock}DECISION: ${decisionText}${contextBlock}\nPlease give your full assessment as ${persona.label}.`,
        }]
      } else {
        // messages contains alternating user pushbacks and prior assistant replies
        // First message in array is always user (the pushback text)
        chatMessages = [
          {
            role: 'user',
            content: `${registerBlock}${structuralBlock}DECISION: ${decisionText}${contextBlock}\nPlease give your full assessment as ${persona.label}.`,
          },
          ...messages.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
        ]
      }
    }

    const { readable, getContent } = await createStream(persona.prompt, chatMessages)

    const encoder = new TextEncoder()
    const passthrough = new ReadableStream<Uint8Array>({
      async start(controller) {
        const reader = readable.getReader()
        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            controller.enqueue(value)
          }

          const assistantContent = getContent()?.trim()
          const supabase = createServiceClient()

          // ── Save user pushback messages to DB ──────────────────
          // When messages array has content and the last message is from user,
          // it's a pushback that hasn't been saved yet — save it now
          if (sessionId && messages.length > 0 && !rawMessages) {
            const lastMsg = messages[messages.length - 1]
            if (lastMsg.role === 'user') {
              await supabase.from('messages').insert({
                session_id: sessionId,
                persona: personaKey,
                role: 'user',
                content: lastMsg.content,
              })
            }
          }

          // ── Save assistant response ────────────────────────────
          if (sessionId && assistantContent) {
            const { error } = await supabase.from('messages').insert({
              session_id: sessionId,
              persona: personaKey,
              role: 'assistant',
              content: assistantContent,
            })
            if (error) console.error('Supabase insert error:', error)
          }

          controller.close()
        } catch (err) {
          controller.error(err)
        }
      },
    })

    return new Response(passthrough, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache',
        'X-Accel-Buffering': 'no',
      },
    })
  } catch (err) {
    console.error('Persona route error:', err)
    return new Response('Internal server error', { status: 500 })
  }
}

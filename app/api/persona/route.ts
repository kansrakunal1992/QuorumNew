import { PERSONAS } from '@/lib/personas'
import { createServiceClient } from '@/lib/supabase'
import { createStream } from '@/lib/ai-client'
import type { PersonaKey, Message } from '@/lib/types'

export async function POST(req: Request) {
  try {
    const {
      sessionId,
      personaKey,
      messages,
      decisionText,
      contextText,
    }: {
      sessionId: string
      personaKey: PersonaKey
      messages: Message[]
      decisionText: string
      contextText?: string
    } = await req.json()

    const persona = PERSONAS[personaKey]
    if (!persona) {
      return new Response('Unknown persona', { status: 400 })
    }

    const contextBlock = contextText
      ? `\nCONTEXT PROVIDED BY DECISION-MAKER:\n${contextText}\n`
      : ''

    // Build message history for the provider
    const chatMessages: { role: 'user' | 'assistant'; content: string }[] =
      messages.length === 0
        ? [
            {
              role: 'user',
              content:
                `DECISION: ${decisionText}${contextBlock}\n` +
                `Please give your full assessment as ${persona.label}.`,
            },
          ]
        : [
            {
              role: 'user',
              content:
                `DECISION: ${decisionText}${contextBlock}\n` +
                `Please give your full assessment as ${persona.label}.`,
            },
            ...messages.map((m) => ({
              role: m.role as 'user' | 'assistant',
              content: m.content,
            })),
          ]

    const { readable, getContent } = await createStream(persona.prompt, chatMessages)

    // Persist after stream — wrap readable so we can intercept close
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
          // Save to Supabase once fully streamed
          const content = getContent()
          if (sessionId && content) {
            const supabase = createServiceClient()
            await supabase.from('messages').insert({
              session_id: sessionId,
              persona: personaKey,
              role: 'assistant',
              content,
            })
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

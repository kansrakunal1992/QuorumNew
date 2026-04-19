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
      rawMessages,  // if true, messages[0].content is already the full user turn
    }: {
      sessionId: string
      personaKey: PersonaKey
      messages: Message[]
      decisionText: string
      contextText?: string
      rawMessages?: boolean
    } = await req.json()

    const persona = PERSONAS[personaKey]
    if (!persona) return new Response('Unknown persona', { status: 400 })

    // Build chat messages for the AI provider
    let chatMessages: { role: 'user' | 'assistant'; content: string }[]

    if (rawMessages && messages.length > 0) {
      // Synthesis path: messages[0] is already the complete user turn
      chatMessages = messages.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }))
    } else {
      // Normal persona path
      const contextBlock = contextText ? `\nCONTEXT PROVIDED BY DECISION-MAKER:\n${contextText}\n` : ''

      if (messages.length === 0) {
        chatMessages = [{
          role: 'user',
          content: `DECISION: ${decisionText}${contextBlock}\nPlease give your full assessment as ${persona.label}.`,
        }]
      } else {
        chatMessages = [
          {
            role: 'user',
            content: `DECISION: ${decisionText}${contextBlock}\nPlease give your full assessment as ${persona.label}.`,
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
          const content = getContent()?.trim()
          if (sessionId && content) {
            const supabase = createServiceClient()
            const { error } = await supabase.from('messages').insert({
                session_id: sessionId,
                persona: personaKey,
                role: 'assistant',
                content,
              })

              if (error) {
                console.error('Supabase insert error:', error)
              }
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

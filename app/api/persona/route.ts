import Anthropic from '@anthropic-ai/sdk'
import { PERSONAS } from '@/lib/personas'
import { createServiceClient } from '@/lib/supabase'
import type { PersonaKey, Message } from '@/lib/types'

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

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

    // Build the user message with full context
    const contextBlock = contextText
      ? `\nCONTEXT PROVIDED BY DECISION-MAKER:\n${contextText}\n`
      : ''

    const conversationBlock =
      messages.length > 0
        ? `\nCONVERSATION SO FAR:\n${messages
            .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
            .join('\n\n')}\n`
        : ''

    const userMessage =
      `DECISION: ${decisionText}${contextBlock}${conversationBlock}\n` +
      `Please give your full assessment as ${persona.label}.`

    // Build Anthropic messages array
    // For pushback turns, we pass conversation history properly
    const anthropicMessages: Anthropic.MessageParam[] =
      messages.length === 0
        ? [{ role: 'user', content: userMessage }]
        : [
            // First turn: the original decision
            {
              role: 'user',
              content: `DECISION: ${decisionText}${contextBlock}\nPlease give your full assessment as ${persona.label}.`,
            },
            // Assistant's prior responses + user pushbacks interleaved
            ...buildAnthropicHistory(messages, persona.label),
          ]

    // Stream from Claude
    const stream = await anthropic.messages.stream({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1200,
      system: persona.prompt,
      messages: anthropicMessages,
    })

    const encoder = new TextEncoder()
    let fullContent = ''

    const readable = new ReadableStream({
      async start(controller) {
        try {
          for await (const event of stream) {
            if (
              event.type === 'content_block_delta' &&
              event.delta.type === 'text_delta'
            ) {
              const text = event.delta.text
              fullContent += text
              controller.enqueue(encoder.encode(text))
            }
          }

          // Persist to Supabase after stream completes
          if (sessionId && fullContent) {
            const supabase = createServiceClient()
            await supabase.from('messages').insert({
              session_id: sessionId,
              persona: personaKey,
              role: 'assistant',
              content: fullContent,
            })
          }

          controller.close()
        } catch (err) {
          console.error('Stream error:', err)
          controller.error(err)
        }
      },
    })

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache',
        'X-Accel-Buffering': 'no', // disables Nginx buffering on Railway
      },
    })
  } catch (err) {
    console.error('Persona route error:', err)
    return new Response('Internal server error', { status: 500 })
  }
}

// Converts flat Message[] into Anthropic's alternating user/assistant format
function buildAnthropicHistory(
  messages: Message[],
  personaLabel: string
): Anthropic.MessageParam[] {
  const result: Anthropic.MessageParam[] = []

  // We need at least one prior assistant turn to build history
  // The messages array contains only pushback exchanges (user + assistant pairs)
  // The initial response is streamed directly, so messages here are pushback turns
  for (const msg of messages) {
    if (msg.role === 'user') {
      result.push({ role: 'user', content: msg.content })
    } else {
      result.push({ role: 'assistant', content: msg.content })
    }
  }

  return result
}

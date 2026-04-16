/**
 * AI provider abstraction.
 * AI_PROVIDER=deepseek   → DeepSeek API (OpenAI-compatible)
 * AI_PROVIDER=anthropic  → Claude API (default)
 * AI_MODEL=...           → override the model for either provider
 */

import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'

const PROVIDER = (process.env.AI_PROVIDER ?? 'anthropic').toLowerCase()
const ANTHROPIC_MODEL = process.env.AI_MODEL ?? 'claude-sonnet-4-20250514'
const DEEPSEEK_MODEL  = process.env.AI_MODEL ?? 'deepseek-chat'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? '' })
const deepseek  = new OpenAI({ apiKey: process.env.DEEPSEEK_API_KEY ?? '', baseURL: 'https://api.deepseek.com' })

interface StreamResult {
  readable: ReadableStream<Uint8Array>
  getContent: () => string
}

export async function createStream(
  systemPrompt: string,
  messages: { role: 'user' | 'assistant'; content: string }[]
): Promise<StreamResult> {
  return PROVIDER === 'deepseek'
    ? streamDeepSeek(systemPrompt, messages)
    : streamAnthropic(systemPrompt, messages)
}

async function streamAnthropic(
  systemPrompt: string,
  messages: { role: 'user' | 'assistant'; content: string }[]
): Promise<StreamResult> {
  const stream = await anthropic.messages.stream({
    model: ANTHROPIC_MODEL,
    max_tokens: 1200,
    system: systemPrompt,
    messages: messages as Anthropic.MessageParam[],
  })
  const encoder = new TextEncoder()
  let fullContent = ''
  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of stream) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            fullContent += event.delta.text
            controller.enqueue(encoder.encode(event.delta.text))
          }
        }
        controller.close()
      } catch (err) { controller.error(err) }
    },
  })
  return { readable, getContent: () => fullContent }
}

async function streamDeepSeek(
  systemPrompt: string,
  messages: { role: 'user' | 'assistant'; content: string }[]
): Promise<StreamResult> {
  const stream = await deepseek.chat.completions.create({
    model: DEEPSEEK_MODEL,
    max_tokens: 1200,
    stream: true,
    messages: [{ role: 'system', content: systemPrompt }, ...messages],
  })
  const encoder = new TextEncoder()
  let fullContent = ''
  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of stream) {
          const text = chunk.choices[0]?.delta?.content ?? ''
          if (text) { fullContent += text; controller.enqueue(encoder.encode(text)) }
        }
        controller.close()
      } catch (err) { controller.error(err) }
    },
  })
  return { readable, getContent: () => fullContent }
}

export function getProviderInfo() {
  return {
    provider: PROVIDER,
    model: PROVIDER === 'deepseek' ? DEEPSEEK_MODEL : ANTHROPIC_MODEL,
  }
}

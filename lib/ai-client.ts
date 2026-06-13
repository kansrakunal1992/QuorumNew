/**
 * AI provider abstraction.
 *
 * Global fallback (AI_PROVIDER env var):
 *   AI_PROVIDER=deepseek   → DeepSeek API (OpenAI-compatible)
 *   AI_PROVIDER=anthropic  → Claude API (default)
 *
 * Per-call override (Sprint 25 — hybrid routing):
 *   Pass `provider` to createStream, or `options.provider` to createCompletion,
 *   to pin a specific call to one model family regardless of AI_PROVIDER.
 *   All 15 AI calls carry an explicit provider flag — the env var is the
 *   fallback only for any call that omits the flag.
 *
 * Routing mode (ROUTING_MODE env var):
 *   ROUTING_MODE=hybrid        → per-call provider flags respected (default)
 *   ROUTING_MODE=deepseek_only → all 15 calls forced to DeepSeek regardless
 *                                 of per-call provider flags. Use for cost
 *                                 testing and A/B quality comparison.
 *
 * Model selection:
 *   ANTHROPIC_MODEL  env var  → override Claude model   (default: claude-sonnet-4-20250514)
 *   DEEPSEEK_MODEL   env var  → override DeepSeek model (default: deepseek-v4-pro)
 *   Legacy AI_MODEL  env var  → still respected as fallback for DeepSeek only,
 *                               so existing Railway env var configs are not broken.
 *
 * DeepSeek thinking mode (DEEPSEEK_THINKING env var):
 *   DEEPSEEK_THINKING=disabled → thinking OFF for all DeepSeek calls (default)
 *   DEEPSEEK_THINKING=enabled  → thinking ON for all DeepSeek calls
 *   Note: thinking mode disables temperature sampling (silently ignored by API).
 *   Note: streaming calls suppress reasoning_content — only content tokens stream.
 *   TD logged: enable thinking selectively for non-streaming completions only
 *   (fingerprint, brief gen) once per-call thinking control is added.
 */

import Anthropic from '@anthropic-ai/sdk'
import OpenAI    from 'openai'

const GLOBAL_PROVIDER    = (process.env.AI_PROVIDER ?? 'anthropic').toLowerCase() as 'anthropic' | 'deepseek'
const ROUTING_MODE       = (process.env.ROUTING_MODE ?? 'hybrid') as 'hybrid' | 'deepseek_only'
const ANTHROPIC_MODEL    = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-20250514'
const DEEPSEEK_MODEL     = process.env.DEEPSEEK_MODEL  ?? process.env.AI_MODEL ?? 'deepseek-v4-pro'
const DEEPSEEK_THINKING  = (process.env.DEEPSEEK_THINKING ?? 'disabled') as 'enabled' | 'disabled'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? '' })
const deepseek  = new OpenAI({ apiKey: process.env.DEEPSEEK_API_KEY ?? '', baseURL: 'https://api.deepseek.com' })

// ── 503 retry helper ───────────────────────────────────────────────────────────
// DeepSeek returns 503 during peak load. One retry after a short wait recovers
// the majority of transient overloads without meaningfully increasing latency.
const RETRY_WAIT_MS   = 5000
const MAX_503_RETRIES = 2

function is503(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as Record<string, unknown>
  return e['status'] === 503 || e['code'] === 'service_unavailable_error'
}

async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  let lastErr: unknown
  for (let attempt = 0; attempt <= MAX_503_RETRIES; attempt++) {
    try {
      return await fn()
    } catch (err) {
      if (is503(err) && attempt < MAX_503_RETRIES) {
        console.warn(`[AIClient] 503 on ${label} — retrying in ${RETRY_WAIT_MS}ms (attempt ${attempt + 1}/${MAX_503_RETRIES})`)
        await new Promise(r => setTimeout(r, RETRY_WAIT_MS))
        lastErr = err
      } else {
        throw err
      }
    }
  }
  throw lastErr
}

// ── Routing helper ─────────────────────────────────────────────────────────────
// Single place where ROUTING_MODE override is applied.
// deepseek_only collapses all calls to DeepSeek regardless of per-call flags.
function resolveProvider(requested?: 'anthropic' | 'deepseek'): 'anthropic' | 'deepseek' {
  if (ROUTING_MODE === 'deepseek_only') return 'deepseek'
  return requested ?? GLOBAL_PROVIDER
}

// ── Types ──────────────────────────────────────────────────────────────────────

interface StreamResult {
  readable:   ReadableStream<Uint8Array>
  getContent: () => string
}

/**
 * Options for createCompletion.
 * All fields are optional — omitting `provider` falls back to AI_PROVIDER env var.
 */
export interface CompletionOptions {
  /** Pin this call to a specific provider, ignoring AI_PROVIDER env var. */
  provider?: 'anthropic' | 'deepseek'
  /**
   * System prompt.
   * Passed as Anthropic `system` param or prepended as an OpenAI `system` message.
   * Use when the call requires a separate system + user message structure
   * (e.g. ontology tagger).
   */
  systemPrompt?: string
  /**
   * Sampling temperature (0.0–1.0).
   * Defaults to each provider's default when omitted.
   * Set low (0.0–0.2) for structured/JSON outputs that require determinism.
   * Silently ignored for DeepSeek calls when DEEPSEEK_THINKING=enabled.
   */
  temperature?: number
}

// ── Streaming ─────────────────────────────────────────────────────────────────

/**
 * createStream — streaming AI call for user-facing Council output.
 *
 * Provider routing (hybrid mode):
 *   'anthropic' → synthesis only
 *   'deepseek'  → all 6 persona analyses, pushbacks, decision_brief persona
 *
 * In deepseek_only mode all calls are forced to DeepSeek regardless.
 */
export async function createStream(
  systemPrompt: string,
  messages:     { role: 'user' | 'assistant'; content: string }[],
  provider?:    'anthropic' | 'deepseek',
): Promise<StreamResult> {
  const p = resolveProvider(provider)
  console.log(`[AIClient] createStream → ${p}${ROUTING_MODE === 'deepseek_only' ? ' (deepseek_only override)' : ''}`)
  return p === 'deepseek'
    ? streamDeepSeek(systemPrompt, messages)
    : streamAnthropic(systemPrompt, messages)
}

async function streamAnthropic(
  systemPrompt: string,
  messages:     { role: 'user' | 'assistant'; content: string }[],
): Promise<StreamResult> {
  const stream = await anthropic.messages.stream({
    model:      ANTHROPIC_MODEL,
    max_tokens: 1200,
    system:     systemPrompt,
    messages:   messages as Anthropic.MessageParam[],
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
  messages:     { role: 'user' | 'assistant'; content: string }[],
): Promise<StreamResult> {
  const stream = await withRetry(
    () => deepseek.chat.completions.create({
      model:      DEEPSEEK_MODEL,
      max_tokens: 1200,
      stream:     true,
      messages:   [{ role: 'system', content: systemPrompt }, ...messages],
      thinking:   { type: DEEPSEEK_THINKING },
    } as any) as any,
    'streamDeepSeek',
  ) as AsyncIterable<any>
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

// ── Non-streaming completion ───────────────────────────────────────────────────

/**
 * createCompletion — non-streaming AI call for background/structured tasks.
 *
 * Backward compatible: callers that pass only (prompt, maxTokens) are unaffected.
 * New callers pass options.provider to pin to a specific model family.
 *
 * Provider routing (hybrid mode):
 *   anthropic → ontology tagger, bias scorer, contradiction detector (×2),
 *               gap questions, rules extraction, structural annotation
 *   deepseek  → personas, brief auto-gen, voice cleanup, mirror fingerprint,
 *               personalise rule question
 *
 * In deepseek_only mode all calls are forced to DeepSeek regardless.
 *
 * @example
 *   // Structured call — always Claude in hybrid mode
 *   await createCompletion(prompt, 4000, { provider: 'anthropic' })
 *
 *   // Generative call — always DeepSeek in hybrid mode
 *   await createCompletion(prompt, 1200, { provider: 'deepseek' })
 *
 *   // With separate system prompt + low temperature (e.g. ontology tagger)
 *   await createCompletion(userMsg, 2000, {
 *     provider:     'anthropic',
 *     systemPrompt: TAGGER_SYSTEM,
 *     temperature:  0.1,
 *   })
 */
export async function createCompletion(
  prompt:    string,
  maxTokens  = 4000,
  options:   CompletionOptions = {},
): Promise<string> {
  const { provider, systemPrompt, temperature } = options
  const p = resolveProvider(provider)
  console.log(`[AIClient] createCompletion → ${p} (${maxTokens} max tokens)${ROUTING_MODE === 'deepseek_only' ? ' (deepseek_only override)' : ''}`)

  if (p === 'deepseek') {
    const msgs: OpenAI.Chat.ChatCompletionMessageParam[] = []
    if (systemPrompt) msgs.push({ role: 'system', content: systemPrompt })
    msgs.push({ role: 'user', content: prompt })

    const res = await withRetry(
      () => deepseek.chat.completions.create({
        model:      DEEPSEEK_MODEL,
        max_tokens: maxTokens,
        stream:     false,
        // temperature is silently ignored by DeepSeek when thinking=enabled
        ...(temperature !== undefined && DEEPSEEK_THINKING === 'disabled' ? { temperature } : {}),
        messages:   msgs,
        thinking:   { type: DEEPSEEK_THINKING },
      } as any),
      'createCompletion',
    )
    return res.choices[0]?.message?.content ?? ''
  } else {
    const res = await anthropic.messages.create({
      model:      ANTHROPIC_MODEL,
      max_tokens: maxTokens,
      ...(systemPrompt  ? { system: systemPrompt }  : {}),
      ...(temperature !== undefined ? { temperature } : {}),
      messages: [{ role: 'user', content: prompt }],
    })
    return res.content[0].type === 'text' ? res.content[0].text : ''
  }
}

// ── Provider info ──────────────────────────────────────────────────────────────

export function getProviderInfo() {
  return {
    provider:       GLOBAL_PROVIDER,
    routingMode:    ROUTING_MODE,
    model:          GLOBAL_PROVIDER === 'deepseek' ? DEEPSEEK_MODEL : ANTHROPIC_MODEL,
    anthropicModel: ANTHROPIC_MODEL,
    deepseekModel:  DEEPSEEK_MODEL,
    deepseekThinking: DEEPSEEK_THINKING,
  }
}

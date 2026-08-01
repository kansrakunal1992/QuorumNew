import 'server-only'
// lib/embeddings.ts
// ── Context Ingestion — embeddings ───────────────────────────────────────────
//
// New vendor dependency: OPENAI_API_KEY. None of the existing model families
// (Anthropic/DeepSeek/Mistral/Qwen — see lib/ai-client.ts) expose an
// embeddings endpoint through the OpenAI-compatible client already wired up
// there, so this is a small, isolated addition rather than a reuse of
// existing routing. Flagging as an ops item: a new key needs to be set in
// Railway → Variables before Context Ingestion's dedup step will do anything
// (it degrades gracefully — see embedText() below — rather than failing the
// whole import when the key is missing).
//
// Used for two things (both point back to lib/context-dedup.ts and the
// `embedding` column on user_memory_facts):
//   1. v1: silently drop near-duplicate candidates before the review screen
//      ever shows them (against existing accepted facts + the user's
//      structured profile picks).
//   2. v2: semantic retrieval at Council-prompt-assembly time, once fact
//      counts grow past what's sensible to inject wholesale. The embedding
//      is stored on every accepted fact now specifically so v2 doesn't need
//      a backfill pass.
// ─────────────────────────────────────────────────────────────────────────────

import OpenAI from 'openai'

const EMBEDDING_MODEL = 'text-embedding-3-small'   // 1536 dims — matches user_memory_facts.embedding

let client: OpenAI | null = null
function getClient(): OpenAI | null {
  if (client) return client
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return null
  client = new OpenAI({ apiKey })
  return client
}

/**
 * Embed a single string. Returns null (never throws) when OPENAI_API_KEY is
 * unset or the call fails — callers must treat a null embedding as "skip
 * dedup / semantic retrieval for this fact", not as a fatal error. Extraction
 * quality never depends on embeddings being available.
 */
export async function embedText(text: string): Promise<number[] | null> {
  const c = getClient()
  if (!c) {
    console.warn('[Embeddings] OPENAI_API_KEY not set — skipping embedding (dedup degraded, semantic retrieval unavailable)')
    return null
  }
  try {
    const res = await c.embeddings.create({ model: EMBEDDING_MODEL, input: text.slice(0, 8000) })
    return res.data[0]?.embedding ?? null
  } catch (err) {
    console.error('[Embeddings] embedText failed:', err)
    return null
  }
}

/**
 * Batch-embed several strings in one API call. Same graceful-degradation
 * contract as embedText() — a failure returns an array of nulls the same
 * length as the input, never throws.
 */
export async function embedBatch(texts: string[]): Promise<(number[] | null)[]> {
  if (texts.length === 0) return []
  const c = getClient()
  if (!c) {
    console.warn('[Embeddings] OPENAI_API_KEY not set — skipping batch embedding')
    return texts.map(() => null)
  }
  try {
    const res = await c.embeddings.create({ model: EMBEDDING_MODEL, input: texts.map(t => t.slice(0, 8000)) })
    return res.data.map(d => d.embedding ?? null)
  } catch (err) {
    console.error('[Embeddings] embedBatch failed:', err)
    return texts.map(() => null)
  }
}

/** Cosine similarity, 0 (unrelated) to 1 (identical direction). */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0
  const len = Math.min(a.length, b.length)
  for (let i = 0; i < len; i++) {
    dot   += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

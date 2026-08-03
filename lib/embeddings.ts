import 'server-only'
// lib/embeddings.ts
// ── Context Ingestion — embeddings ───────────────────────────────────────────
//
// Uses Mistral's mistral-embed model via MISTRAL_API_KEY — the same key
// lib/ai-client.ts already uses for mistral-small-latest chat completions —
// so unlike the original OpenAI-based version, this needs no new vendor
// account. Called directly via fetch() rather than the `openai` package's
// client pointed at Mistral's baseURL (the pattern lib/ai-client.ts uses
// for chat): Mistral's embeddings endpoint takes the source text under an
// `inputs` field, not OpenAI's `input`, so the OpenAI client's request
// shape doesn't line up here even though it does for chat completions.
//
// mistral-embed produces 1024-dim vectors, not OpenAI's 1536 — see
// supabase/add_context_ingestion_mistral_embed.sql, which resizes
// user_memory_facts.embedding accordingly (and necessarily clears any
// previously-stored 1536-dim vectors — see that migration's comment).
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

const EMBEDDING_MODEL = 'mistral-embed'   // 1024 dims — matches user_memory_facts.embedding
const EMBEDDINGS_URL   = 'https://api.mistral.ai/v1/embeddings'

interface MistralEmbeddingResponse {
  data: Array<{ embedding: number[]; index: number }>
}

async function callMistralEmbeddings(inputs: string[]): Promise<number[][] | null> {
  const apiKey = process.env.MISTRAL_API_KEY
  if (!apiKey) {
    console.warn('[Embeddings] MISTRAL_API_KEY not set — skipping embedding (dedup degraded, semantic retrieval unavailable)')
    return null
  }
  try {
    const res = await fetch(EMBEDDINGS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model: EMBEDDING_MODEL, inputs: inputs.map(t => t.slice(0, 8000)) }),
    })
    if (!res.ok) {
      console.error('[Embeddings] Mistral API error:', res.status, await res.text().catch(() => ''))
      return null
    }
    const json = await res.json() as MistralEmbeddingResponse
    // Mistral returns results in request order already, but sort by the
    // returned index defensively rather than assume that always holds.
    return [...json.data].sort((a, b) => a.index - b.index).map(d => d.embedding)
  } catch (err) {
    console.error('[Embeddings] Mistral call failed:', err)
    return null
  }
}

/**
 * Embed a single string. Returns null (never throws) when MISTRAL_API_KEY is
 * unset or the call fails — callers must treat a null embedding as "skip
 * dedup / semantic retrieval for this fact", not as a fatal error. Extraction
 * quality never depends on embeddings being available.
 */
export async function embedText(text: string): Promise<number[] | null> {
  const results = await callMistralEmbeddings([text])
  return results?.[0] ?? null
}

/**
 * Batch-embed several strings in one API call. Same graceful-degradation
 * contract as embedText() — a failure returns an array of nulls the same
 * length as the input, never throws.
 */
export async function embedBatch(texts: string[]): Promise<(number[] | null)[]> {
  if (texts.length === 0) return []
  const results = await callMistralEmbeddings(texts)
  if (!results) return texts.map(() => null)
  return texts.map((_, i) => results[i] ?? null)
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

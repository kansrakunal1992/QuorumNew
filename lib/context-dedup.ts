import 'server-only'
// lib/context-dedup.ts
// ── Context Ingestion — dedup against existing Mirror/Profile facts ─────────
//
// Runs after embedding, before ranking/capping — filters candidates the user
// would just be re-approving. Compared against two things:
//   1. The user's existing accepted/edited user_memory_facts (relevant on a
//      reimport, or after a partial save).
//   2. A short canonical sentence per structured UserProfile field they've
//      already picked in ProfileCaptureOverlay (archetype, fears, life
//      stage, risk stance) — so "you're risk-averse" doesn't get proposed
//      again when they already selected Conservative.
//
// Candidate count is small (well under 100 even before the top-15 cap), so a
// plain JS-side O(n·m) cosine comparison is simpler and fast enough here —
// no need for pgvector's <=> operator at this step. The stored `embedding`
// column exists for v2's semantic retrieval, not this dedup pass.
// ─────────────────────────────────────────────────────────────────────────────

import { cosineSimilarity } from './embeddings'
import type { MemoryFactCandidateWithEmbedding } from './types'

const DUPLICATE_THRESHOLD = 0.88

export interface EmbeddedReference {
  text:      string
  embedding: number[] | null
}

export function filterDuplicates(
  candidates: MemoryFactCandidateWithEmbedding[],
  existing:   EmbeddedReference[],
): MemoryFactCandidateWithEmbedding[] {
  const references = existing.filter(e => e.embedding !== null) as { text: string; embedding: number[] }[]
  if (references.length === 0) return candidates

  return candidates.filter(c => {
    // Can't compare without an embedding — err toward keeping it (a possible
    // duplicate shown to the user for one extra checkbox beats one silently
    // dropped without any signal that it happened).
    if (!c.embedding) return true
    return !references.some(ref => cosineSimilarity(c.embedding as number[], ref.embedding) >= DUPLICATE_THRESHOLD)
  })
}

// Canonical sentences for the structured profile fields — kept short and in
// the same register as extracted facts so embedding-space comparison is
// meaningful. Only fields the user actually filled in are included.
export function profileToReferenceSentences(profile: {
  archetype?:     string | null
  primary_fears?: string[] | null
  life_stage?:    string | null
  risk_stance?:   string | null
} | null): string[] {
  if (!profile) return []
  const out: string[] = []
  if (profile.archetype)   out.push(`Sees themself primarily as: ${profile.archetype}.`)
  if (profile.risk_stance) out.push(`Natural stance toward risk: ${profile.risk_stance}.`)
  if (profile.life_stage)  out.push(`Current life stage: ${profile.life_stage}.`)
  for (const fear of profile.primary_fears ?? []) {
    out.push(`A recurring fear in high-stakes decisions: ${fear}.`)
  }
  return out
}

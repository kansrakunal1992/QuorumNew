// lib/ontology-validate.ts
// ── Is this a usable ontology tag? (pure) ────────────────────────────────────────
// Moved out of app/api/ontology/route.ts unchanged, so the route and the pre-tag path (lib/chat-intake-pretag.ts) apply
// exactly the same test. A Next.js route file may only export HTTP handlers, so it cannot be shared from there.

import type { OntologyTag } from '@/lib/ontology-tagger'

const VALID_TYPES = [
  'commitment', 'allocation', 'transition',
  'acquisition', 'renunciation', 'governance', 'delegation',
]

export function validateTag(tag: OntologyTag): boolean {
  if (!VALID_TYPES.includes(tag.decision_type_primary)) return false
  if (typeof tag.instrumental_weight !== 'number')     return false
  if (typeof tag.constitutive_weight !== 'number')     return false
  if (!tag.examiner_gap_1 || !tag.examiner_gap_2 || !tag.examiner_gap_3) return false
  // v2.0: also require scored_vector
  if (!tag.scored_vector || typeof tag.scored_vector !== 'object')        return false
  if (typeof tag.scored_vector.upstream_dependency?.score !== 'number') return false
  if (typeof tag.scored_vector.identity_alignment?.score !== 'number')  return false
  if (typeof tag.scored_vector.regret_asymmetry?.score !== 'number')    return false
  return true
}

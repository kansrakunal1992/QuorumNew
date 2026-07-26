// lib/product-tier.ts
// ── Product tier resolution (Free / Elite / Private) ─────────────────────────
//
// Single source of truth for "which product tier is this account on" — the
// input lib/ai-client.ts's tiered routing needs. Deliberately separate from
// lib/mirror-access.ts's getMirrorAccessState(): that answers "can this user
// see Mirror UI" (locked/teaser/unlocked), a feature-gate question. This
// answers "which of the three named plans are they on", a routing question.
// They read the same table because a paid mirror_access row today always
// means Elite or Private under the new naming — but keep the functions
// separate so a future world where tier and Mirror-feature-access diverge
// doesn't require untangling one function into two.
//
// Expiry semantics intentionally mirror getMirrorAccessState():
//   - advisory / lifetime (legacy)  → never expires
//   - monthly / annual              → valid while expires_at > now()
//   - no row, or expired row        → 'free'
// ─────────────────────────────────────────────────────────────────────────────

import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from './supabase'
import type { ProductTier, PrivateModelFamily } from './types'

export interface ProductTierInfo {
  tier:               ProductTier
  privateModelFamily: PrivateModelFamily | null
}

export const FREE_TIER: ProductTierInfo = { tier: 'free', privateModelFamily: null }

/**
 * getProductTier — resolve a user's product tier for AI routing purposes.
 *
 * Accepts an optional pre-fetched SupabaseClient (service-role) to avoid a
 * redundant client construction when the caller already has one in scope
 * (most route handlers do). Falls back to creating one otherwise.
 */
export async function getProductTier(
  userId:    string | null | undefined,
  supabase?: SupabaseClient,
): Promise<ProductTierInfo> {
  if (!userId) return FREE_TIER

  const client = supabase ?? createServiceClient()

  const { data: row, error } = await client
    .from('mirror_access')
    .select('access_type, product_tier, private_model_family, expires_at')
    .eq('user_id', userId)
    .maybeSingle()

  if (error || !row) return FREE_TIER

  // Same expiry convention as getMirrorAccessState(): advisory/lifetime never
  // expire; monthly/annual are valid only while expires_at is in the future.
  const neverExpires = row.access_type === 'advisory' || row.access_type === 'lifetime'
  const stillValid    = neverExpires || !row.expires_at || new Date(row.expires_at as string) > new Date()

  if (!stillValid) return FREE_TIER

  // product_tier is NOT NULL in the DB (migration default 'elite'), but stay
  // defensive against any row written before the migration ran.
  const tier = (row.product_tier as ProductTier | null) ?? 'elite'

  return {
    tier,
    privateModelFamily: tier === 'private'
      ? ((row.private_model_family as PrivateModelFamily | null) ?? null)
      : null,
  }
}

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
//
// Also resolves the TD-LD-10/TD-LD-11 per-user routing override
// (model_route_fast / model_route_premium) in the same query — one DB round
// trip gets both tier and override, since middleware.ts needs both on every
// request. userId is carried on the returned object itself (not just passed
// in) so that once this flows through headers/AsyncLocalStorage into
// lib/ai-client.ts, the audit logger there still knows who the call was for
// without needing a separate channel.
// ─────────────────────────────────────────────────────────────────────────────

import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from './supabase'
import type { ProductTier, PrivateModelFamily, RouteOverride, PrivateEndpoint } from './types'

export interface ProductTierInfo {
  tier:               ProductTier
  privateModelFamily: PrivateModelFamily | null
  userId:             string | null
  modelRouteFast:     RouteOverride | null
  modelRoutePremium:  RouteOverride | null
  // Only populated when tier === 'private' AND a private_deployments row
  // exists for this user — null means "Private tier granted, but their
  // dedicated infra hasn't been deployed yet" (a real, expected state
  // between granting access and finishing the deploy), not an error.
  privateEndpoint:    PrivateEndpoint | null
}

export const FREE_TIER: ProductTierInfo = {
  tier:               'free',
  privateModelFamily: null,
  userId:             null,
  modelRouteFast:      null,
  modelRoutePremium:   null,
  privateEndpoint:     null,
}

/**
 * getProductTier — resolve a user's product tier (and any routing override)
 * for AI routing purposes.
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
    .select('access_type, product_tier, private_model_family, model_route_fast, model_route_premium, expires_at')
    .eq('user_id', userId)
    .maybeSingle()

  // No row (or a lookup error) — free tier, but a routing override can still
  // apply even to a nominally-free tester account (TD-LD-11's founder
  // workflow doesn't require them to hold a paid tier). Since overrides only
  // live on mirror_access rows today, a free account has none to check —
  // this is a known, acceptable limitation: granting a free-tier override
  // requires an admin grant that also sets a tier (elite/private), same as
  // the doc's own worked example.
  if (error || !row) return { ...FREE_TIER, userId }


  // Same expiry convention as getMirrorAccessState(): advisory/lifetime never
  // expire; monthly/annual are valid only while expires_at is in the future.
  const neverExpires = row.access_type === 'advisory' || row.access_type === 'lifetime'
  const stillValid    = neverExpires || !row.expires_at || new Date(row.expires_at as string) > new Date()

  if (!stillValid) return { ...FREE_TIER, userId }

  // product_tier is NOT NULL in the DB (migration default 'elite'), but stay
  // defensive against any row written before that migration ran.
  const tier = (row.product_tier as ProductTier | null) ?? 'elite'

  // Private tier needs a second lookup — their dedicated endpoint lives in
  // private_deployments, not mirror_access (see that table's doc comment
  // for why it's a separate table). Only queried when actually on Private,
  // so Free/Elite requests never pay for this extra round trip.
  let privateEndpoint: PrivateEndpoint | null = null
  if (tier === 'private') {
    const { data: deployment } = await client
      .from('private_deployments')
      .select('endpoint_url, endpoint_api_key, fast_model, premium_model')
      .eq('user_id', userId)
      .maybeSingle()

    if (deployment) {
      privateEndpoint = {
        baseUrl:      deployment.endpoint_url as string,
        apiKey:       deployment.endpoint_api_key as string,
        fastModel:    deployment.fast_model as string,
        premiumModel: deployment.premium_model as string,
      }
    }
    // No row yet → privateEndpoint stays null. This is a normal, expected
    // state (granted Private, deploy not finished yet) — lib/ai-client.ts
    // throws a clear, specific error naming this if a call actually reaches
    // that point with no endpoint, rather than this function guessing.
  }

  return {
    tier,
    privateModelFamily: tier === 'private'
      ? ((row.private_model_family as PrivateModelFamily | null) ?? null)
      : null,
    userId,
    modelRouteFast:    (row.model_route_fast as RouteOverride | null) ?? null,
    modelRoutePremium: (row.model_route_premium as RouteOverride | null) ?? null,
    privateEndpoint,
  }
}

// lib/mirror-access.ts
// ── Mirror access state helper (Sprint 19) ───────────────────────────────────
//
// Single source of truth for "what can this user see?".
// Replaces the inline binary mirror_access row-exists checks across all routes.
//
// Access logic:
//   • 'advisory'               → always unlocked (no expiry check)
//   • 'lifetime' (legacy)      → always unlocked — retired, no longer offered/grantable,
//                                 but any pre-existing row is still honoured
//   • 'annual'   / 'monthly'   → unlocked if expires_at > now(); teaser/locked otherwise
//   • No row, or expired row   → check session count
//                                ≥ TEASER_THRESHOLD sessions → teaser
//                                < TEASER_THRESHOLD sessions → locked
//
// Note: there is no longer a separate "unlock threshold" (the old MIRROR_THRESHOLD=5).
//       Subscription is what unlocks. Session count only determines teaser vs locked.
// ─────────────────────────────────────────────────────────────────────────────

import type { SupabaseClient } from '@supabase/supabase-js'
import type { MirrorAccessState } from './types'

export const TEASER_THRESHOLD = 3

export async function getMirrorAccessState(
  userId: string,
  supabase: SupabaseClient,
): Promise<MirrorAccessState> {

  // ── 1. Check mirror_access row ─────────────────────────────────────────────
  const { data: accessRow } = await supabase
    .from('mirror_access')
    .select('id, access_type, expires_at')
    .eq('user_id', userId)
    .maybeSingle()

  if (accessRow) {
    // Advisory: never expires. Lifetime: legacy, retired — honoured if present.
    if (accessRow.access_type === 'lifetime' || accessRow.access_type === 'advisory') {
      return 'unlocked'
    }

    // Annual / monthly: check expiry
    if (accessRow.access_type === 'annual' || accessRow.access_type === 'monthly') {
      if (!accessRow.expires_at || new Date(accessRow.expires_at) > new Date()) {
        return 'unlocked'
      }
      // Expired — fall through to session count check
    }
  }

  // ── 2. No valid access — determine teaser vs locked by session count ────────
  const { count } = await supabase
    .from('sessions')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)

  const sessionCount = count ?? 0
  return sessionCount >= TEASER_THRESHOLD ? 'teaser' : 'locked'
}

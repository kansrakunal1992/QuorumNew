// lib/founding.ts
// ── Founding Elite cohort helper ──────────────────────────────────────────
//
// Founding is NOT a product tier — it's a pricing/cohort marker layered on
// top of product_tier='elite' (see supabase/add_founding_member_to_mirror_
// access.sql). Covers both Founding Elite Monthly and Annual — billing
// cycle is orthogonal to cohort membership, see app/api/payment/
// create-subscription/route.ts. This file is the single source of truth
// for "is the Founding offer still available," used by both:
//   - app/api/mirror/status/route.ts   (whether the Mirror page shows the offer)
//   - app/api/payment/create-subscription/route.ts  (server-side enforcement)
// so the two can never disagree — a user can't see the offer the server
// would then reject, and closing the cap in one place closes it everywhere.
//
// Count semantics: counts every mirror_access row EVER marked
// founding_member = true, not just currently-active subscriptions. Founding
// is a permanent cohort membership (status is never revoked on cancellation
// — see the migration), so a lapsed founding member still occupies their
// seat. Slots do not reopen. If that's not the intended behaviour, this is
// the one place to change it.
//
// FOUNDER_OVERRIDE=true bypasses the cap everywhere this helper is used —
// for local/staging testing only. Never set in production.
//
// FOUNDING_MEMBER_CAP overrides the seat cap itself (default 20 if unset
// or invalid). Set this in Railway to raise the cohort size later (e.g.
// 30, 40) without a code change or redeploy of logic — just the env var.
// ─────────────────────────────────────────────────────────────────────────────

import type { SupabaseClient } from '@supabase/supabase-js'

const DEFAULT_FOUNDING_MEMBER_CAP = 20

export function getFoundingMemberCap(): number {
  const raw = process.env.FOUNDING_MEMBER_CAP
  const parsed = raw ? parseInt(raw, 10) : NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_FOUNDING_MEMBER_CAP
}

export async function getFoundingMemberCount(supabase: SupabaseClient): Promise<number> {
  const { count } = await supabase
    .from('mirror_access')
    .select('*', { count: 'exact', head: true })
    .eq('founding_member', true)

  return count ?? 0
}

export async function isFoundingAvailable(supabase: SupabaseClient): Promise<boolean> {
  if (process.env.FOUNDER_OVERRIDE === 'true') return true

  const count = await getFoundingMemberCount(supabase)
  return count < getFoundingMemberCap()
}

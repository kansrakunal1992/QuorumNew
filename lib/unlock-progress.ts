// lib/unlock-progress.ts
// Institutional Sprint 5 (task 4) — "4 of 20 needed" progress counts.
//
// This is a DELIBERATE, NARROW exception to "views never reveal sub-floor
// group sizes" — read before reusing this pattern anywhere else:
//
//   Sprint 4's aggregate views protect BEHAVIORAL DATA (calibration
//   averages, bias patterns) by simply not returning a row below K_FLOOR —
//   absence is the mechanism. This file does not touch that. It exposes
//   ONLY a bare headcount toward the threshold for one dimension's bucket —
//   never an average, never a delta, nothing about what those people's
//   sessions actually contain. "4 people logged a HIGH-stakes decision so
//   far, need 20" is meaningfully less sensitive than "those 4 people's
//   average calibration delta is +0.6" — the former is a participation
//   fact, the latter a behavioral one.
//
//   This was an explicit product decision, not a default: offered "exact
//   count for everyone" vs. "vague progress only" vs. "admins only", exact-
//   for-everyone was chosen knowingly, accepting that for a very small
//   institution a count like "2 of 20" can approach identifying who. If
//   that trade-off ever needs revisiting, change it here — this file is the
//   only place bare sub-floor headcounts are queried anywhere in the
//   institutional layer.
//
// Never add an average/delta/any behavioral field to this file's queries.
// If a future sprint wants that, it needs its own explicit product
// decision, not a quiet extension of this one.

import { createServiceClient } from '@/lib/supabase'
import { effectiveKFloor }     from '@/lib/k-floor'

type ServiceClient = ReturnType<typeof createServiceClient>

export interface UnlockProgress {
  dim:     string
  bucket:  'high' | 'low'
  current: number
  needed:  number
  cleared: boolean
}

// institutionId: null means platform-wide progress. Returns both buckets,
// since a dimension only "clears" once both individually clear K_FLOOR —
// matching institutional_benchmark_segments' HAVING clause.
export async function getUnlockProgress(
  dim: string,
  institutionId: string | null,
): Promise<UnlockProgress[]> {
  const supabase = createServiceClient()
  const kFloor = await resolveKFloor(supabase, institutionId)

  const consentingUserIds = await getConsentingUserIds(supabase, institutionId)
  if (!consentingUserIds.length) {
    return emptyResult(dim, kFloor)
  }

  // Two-step, application-side bucketing rather than one deeply-nested
  // PostgREST embedded-filter query: simpler to get right and to read than
  // relying on embedded-resource filter syntax for a jsonb field, and this
  // isn't a hot path (called once per not-yet-cleared dimension shown in
  // the UI, not per page load of already-cleared data).
  const { data: rows, error } = await supabase
    .from('sessions')
    .select('user_id, outcomes!inner(calibration_delta), sessions_ontology!inner(ontology_vector)')
    .in('user_id', consentingUserIds)
    .not('outcomes.calibration_delta', 'is', null)
    .not('sessions_ontology.ontology_vector', 'is', null)

  if (error) {
    console.error('[unlock-progress] session query failed:', error.message)
    return emptyResult(dim, kFloor)
  }

  const highUsers = new Set<string>()
  const lowUsers  = new Set<string>()

  for (const row of rows ?? []) {
    const ontology = Array.isArray(row.sessions_ontology) ? row.sessions_ontology[0] : row.sessions_ontology
    const vector = ontology?.ontology_vector as Record<string, number> | undefined
    const score = vector?.[dim]
    if (typeof score !== 'number') continue
    if (score >= 4) highUsers.add(row.user_id)
    else if (score <= 2) lowUsers.add(row.user_id)
  }

  return [
    { dim, bucket: 'high', current: highUsers.size, needed: kFloor, cleared: highUsers.size >= kFloor },
    { dim, bucket: 'low',  current: lowUsers.size,  needed: kFloor, cleared: lowUsers.size  >= kFloor },
  ]
}

async function resolveKFloor(supabase: ServiceClient, institutionId: string | null): Promise<number> {
  if (!institutionId) return effectiveKFloor(null)
  const { data } = await supabase
    .from('institutions')
    .select('k_floor_override')
    .eq('id', institutionId)
    .maybeSingle()
  return effectiveKFloor(data?.k_floor_override)
}

async function getConsentingUserIds(supabase: ServiceClient, institutionId: string | null): Promise<string[]> {
  let query = supabase
    .from('institution_memberships')
    .select('user_id')
    .eq('consent_aggregate', true)

  if (institutionId) query = query.eq('institution_id', institutionId)

  const { data, error } = await query
  if (error) {
    console.error('[unlock-progress] consenting-users query failed:', error.message)
    return []
  }
  // Dedup for the platform-wide (institutionId === null) case, same reason
  // as institutional_platform_benchmark_segments' consenting_users CTE — a
  // multi-institution user shouldn't be counted more than once.
  // Explicit intermediate string[] required, not stylistic — see
  // lib/cohort-insights.ts's fetchBiasParameterLabels for why: new Set(x)
  // infers Set<unknown> (not Set<string>) when x's element type is bare
  // 'any', which untyped .select() results are.
  const userIds: string[] = (data ?? []).map((r: { user_id: string }) => r.user_id)
  return [...new Set(userIds)]
}

function emptyResult(dim: string, kFloor: number): UnlockProgress[] {
  return [
    { dim, bucket: 'high', current: 0, needed: kFloor, cleared: false },
    { dim, bucket: 'low',  current: 0, needed: kFloor, cleared: false },
  ]
}

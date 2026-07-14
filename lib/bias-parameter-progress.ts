// lib/bias-parameter-progress.ts
// Tier 3 — "X of 20 needed" progress for bias parameters, extending the
// SAME authorized exception documented in lib/unlock-progress.ts's header
// to a new data type. Re-read that file's header before touching this one —
// the constraint is identical: bare headcounts only, never confidence
// weight, detection count, or any other behavioral value. This file adds
// one new thing to be careful about: bias_library is keyed by email, not
// user_id (see supabase/institutional_sprint6_bias_parameter_view.sql's
// schema note) — the bridge here mirrors that view's join exactly.

import { createServiceClient } from '@/lib/supabase'
import { effectiveKFloor }     from '@/lib/k-floor'

type ServiceClient = ReturnType<typeof createServiceClient>

export interface BiasParameterProgress {
  biasParameter: string
  current: number
  needed: number
  cleared: boolean
}

export async function getBiasParameterProgress(
  biasParameter: string,
  institutionId: string | null,
): Promise<BiasParameterProgress> {
  const supabase = createServiceClient()
  const kFloor = await resolveKFloor(supabase, institutionId)

  const consentingEmails = await getConsentingEmails(supabase, institutionId)
  if (!consentingEmails.length) {
    return { biasParameter, current: 0, needed: kFloor, cleared: false }
  }

  // Bare headcount only — how many consenting members have this bias
  // parameter in bias_library at all. No confidence_weight, no
  // detection_count, no activation_contexts.
  const { data, error } = await supabase
    .from('bias_library')
    .select('user_email')
    .eq('bias_parameter', biasParameter)
    .in('user_email', consentingEmails)

  if (error) {
    console.error('[bias-parameter-progress] query failed:', error.message)
    return { biasParameter, current: 0, needed: kFloor, cleared: false }
  }

  const emails: string[] = (data ?? []).map((r: { user_email: string }) => r.user_email)
  const current = new Set(emails).size

  return { biasParameter, current, needed: kFloor, cleared: current >= kFloor }
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

async function getConsentingEmails(supabase: ServiceClient, institutionId: string | null): Promise<string[]> {
  let query = supabase
    .from('institution_memberships')
    .select('user_id')
    .eq('consent_aggregate', true)
  if (institutionId) query = query.eq('institution_id', institutionId)

  const { data, error } = await query
  if (error) {
    console.error('[bias-parameter-progress] consenting-users query failed:', error.message)
    return []
  }

  const rawUserIds: string[] = (data ?? []).map((r: { user_id: string }) => r.user_id)
  const userIds = [...new Set(rawUserIds)]
  const emails: string[] = []
  for (const userId of userIds) {
    try {
      const { data: userData } = await supabase.auth.admin.getUserById(userId)
      if (userData.user?.email) emails.push(userData.user.email)
    } catch { /* skip — same best-effort pattern as roster/cohort-insights */ }
  }
  return emails
}

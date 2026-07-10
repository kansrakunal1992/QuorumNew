// lib/active-institution.ts
// Institutional Sprint 5 (tasks 1/2) — resolving and setting which
// institution is the user's current viewing context, when they belong to
// more than one. Backed by user_institution_preference (see
// institutional_sprint5_ui_support.sql for why a dedicated table rather
// than client-only state or auth metadata).

import { createServiceClient } from '@/lib/supabase'

type ServiceClient = ReturnType<typeof createServiceClient>

export interface ActiveInstitutionInfo {
  institutionId: string | null
  institutionName: string | null
  memberships: { institutionId: string; name: string; role: 'admin' | 'member' }[]
}

// Returns null institutionId if the user has zero memberships (the caller
// should treat this as "not an institutional user at all" — no badge, no
// pill, nothing new) or if they have memberships but haven't picked one yet
// (defaults to the first membership by joined_at, same tie-break used by
// the Sprint 3 admin page picker).
export async function resolveActiveInstitution(userId: string): Promise<ActiveInstitutionInfo> {
  const supabase = createServiceClient()

  const { data: memberships, error } = await supabase
    .from('institution_memberships')
    .select('institution_id, role, joined_at, institutions(name)')
    .eq('user_id', userId)
    .order('joined_at', { ascending: true })

  if (error) {
    console.error('[active-institution] membership lookup failed:', error.message)
    return { institutionId: null, institutionName: null, memberships: [] }
  }
  if (!memberships?.length) {
    return { institutionId: null, institutionName: null, memberships: [] }
  }

  const list = memberships.map(m => ({
    institutionId: m.institution_id,
    role:          m.role as 'admin' | 'member',
    name:          nameOf(m.institutions),
  }))

  const { data: pref } = await supabase
    .from('user_institution_preference')
    .select('active_institution_id')
    .eq('user_id', userId)
    .maybeSingle()

  const preferredId = pref?.active_institution_id
  const match = list.find(m => m.institutionId === preferredId) ?? list[0]

  return { institutionId: match.institutionId, institutionName: match.name, memberships: list }
}

export async function setActiveInstitution(userId: string, institutionId: string): Promise<boolean> {
  const supabase = createServiceClient()

  // Confirm the user actually belongs to the institution they're switching
  // to — this route is reachable by any authenticated user, and blindly
  // trusting a client-supplied institutionId would let someone set their
  // "active" context to an institution they have no membership in (harmless
  // on its own since nothing else trusts this value without its own checks,
  // but there's no reason to allow it).
  const { data: membership } = await supabase
    .from('institution_memberships')
    .select('id')
    .eq('user_id', userId)
    .eq('institution_id', institutionId)
    .maybeSingle()

  if (!membership) return false

  const { error } = await supabase
    .from('user_institution_preference')
    .upsert({ user_id: userId, active_institution_id: institutionId, updated_at: new Date().toISOString() })

  if (error) {
    console.error('[active-institution] preference upsert failed:', error.message)
    return false
  }
  return true
}

function nameOf(institutions: { name: string } | { name: string }[] | null): string {
  const inst = Array.isArray(institutions) ? institutions[0] : institutions
  return inst?.name ?? 'Institution'
}

import 'server-only'

// lib/stakeholders.ts
// ── Stakeholder upsert (Phase 2, v2) ──────────────────────────────────────────
//
// One person, one row, however many times or channels they're mentioned
// across — matched by (user_id, lower(trim(name))). See
// supabase/sprint_stakeholder_connectors_v2.sql's comment on name_lookup for
// why that column exists unencrypted alongside the encrypted name.

import { createServiceClient } from '@/lib/supabase'
import { encrypt, decrypt } from '@/lib/encryption'

export interface StakeholderRecord {
  id:             string
  name:           string
  role:           string | null
  consultReason:  string | null
}

export async function upsertStakeholder(
  userId:        string,
  name:          string,
  role?:         string | null,
  consultReason?: 'expertise' | 'challenge' | 'approval' | 'affected' | 'trust' | null,
): Promise<StakeholderRecord> {
  const supabase   = createServiceClient()
  const nameLookup = name.trim().toLowerCase()

  const { data: existing } = await supabase
    .from('stakeholders')
    .select('id, name, role, consult_reason')
    .eq('user_id', userId)
    .eq('name_lookup', nameLookup)
    .maybeSingle()

  if (existing) {
    const update: Record<string, unknown> = { last_referenced_at: new Date().toISOString() }
    if (role) update.role = encrypt(role)
    if (consultReason) update.consult_reason = consultReason
    await supabase.from('stakeholders').update(update).eq('id', existing.id)

    return {
      id:            existing.id,
      name:          decrypt(existing.name) ?? name,
      role:          role ? role : (decrypt(existing.role) ?? null),
      consultReason: consultReason ?? existing.consult_reason,
    }
  }

  const { data: created, error } = await supabase
    .from('stakeholders')
    .insert({
      user_id:        userId,
      name:           encrypt(name.trim()),
      name_lookup:    nameLookup,
      role:           role ? encrypt(role) : null,
      consult_reason: consultReason ?? null,
    })
    .select('id')
    .single()

  if (error || !created) throw new Error(`Failed to create stakeholder: ${error?.message}`)

  return { id: created.id, name: name.trim(), role: role ?? null, consultReason: consultReason ?? null }
}

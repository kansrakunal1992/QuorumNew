// lib/decision-history.ts
// -- Phase 2 (retention work): one person's recent decisions, by best identity -
// Server-side helper. Merges rows linked to a user_id with rows that only carry
// the same device_id, because chat-flow sessions created before the Phase 0
// auth-header fix (and anonymous sessions in general) have device_id but a null
// user_id. Without the device half, an anonymous person's D2 has nothing to be
// compared against, and a signed-in person's pre-fix history goes missing.
//
// Two separate queries merged by id (not a PostgREST .or() string) so no
// caller-supplied value is ever interpolated into a filter expression. The
// device id is additionally format-checked.

import type { SupabaseClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/encryption'
import type { DecisionRow } from '@/lib/cross-decision-observations'

const DEVICE_RE = /^[A-Za-z0-9_-]{8,80}$/
const COLS = 'id, created_at, optimization_priority, initial_instinct, final_decision, prediction_matched_final'

export async function loadDecisionRows(
  supabase: SupabaseClient,
  who: { userId?: string | null; deviceId?: string | null },
  opts: { limit?: number; excludeId?: string; requireFinal?: boolean } = {},
): Promise<DecisionRow[]> {
  const limit = opts.limit ?? 12
  const merged = new Map<string, any>()

  const run = async (col: 'user_id' | 'device_id', value: string) => {
    let q = supabase.from('sessions').select(COLS).eq(col, value)
    if (opts.requireFinal) q = q.not('final_decision', 'is', null)
    if (opts.excludeId) q = q.neq('id', opts.excludeId)
    const { data, error } = await q.order('created_at', { ascending: false }).limit(limit)
    if (error) { console.warn('[decision-history] query failed:', error.message); return }
    for (const r of data ?? []) merged.set(r.id as string, r)
  }

  if (who.userId) await run('user_id', who.userId)
  if (who.deviceId && DEVICE_RE.test(who.deviceId)) await run('device_id', who.deviceId)

  return Array.from(merged.values())
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    .slice(0, limit)
    .map(r => ({
      id:                       r.id as string,
      created_at:               r.created_at as string,
      optimization_priority:    (r.optimization_priority as string | null) ?? null,
      initial_instinct:         (r.initial_instinct as string | null) ?? null,
      final_decision_plain:     r.final_decision ? (decrypt(r.final_decision as string) ?? null) : null,
      prediction_matched_final: (r.prediction_matched_final as boolean | null) ?? null,
    }))
}

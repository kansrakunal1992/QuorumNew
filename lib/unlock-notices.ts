// lib/unlock-notices.ts
// Institutional Sprint 5 (task 5) — one-time "a new benchmark panel just
// unlocked" notice, backed by seen_unlock_notices (unique on user+dim+scope,
// so a second call for the same triple is a no-op, never fires twice).

import { createServiceClient } from '@/lib/supabase'

export type UnlockScopeType = 'institution' | 'platform' | 'rollup'

// Call this whenever a DimensionBenchmark (lib/aggregate-benchmark.ts) is
// about to be shown with real buckets (not the 'insufficient' scope) — it
// tells you whether THIS is the first time this user has ever seen this
// exact (dim, scope) unlocked, and marks it seen in the same call so a
// second render of the same panel never re-fires the toast, including
// across devices/sessions.
export async function checkAndMarkUnlockSeen(
  userId: string,
  dim: string,
  scopeType: UnlockScopeType,
): Promise<boolean> {
  const supabase = createServiceClient()

  const { data: existing } = await supabase
    .from('seen_unlock_notices')
    .select('id')
    .eq('user_id', userId)
    .eq('dim', dim)
    .eq('scope_type', scopeType)
    .maybeSingle()

  if (existing) return false // already seen — not a first-time unlock

  const { error } = await supabase
    .from('seen_unlock_notices')
    .insert({ user_id: userId, dim, scope_type: scopeType })

  if (error) {
    // Unique-constraint violation means a concurrent request already
    // inserted it first — that's fine, it just means this call lost the
    // race and should NOT report itself as the first-time unlock either.
    if (error.code !== '23505') {
      console.error('[unlock-notices] insert failed:', error.message)
    }
    return false
  }

  return true // genuinely first time — caller should show the toast
}

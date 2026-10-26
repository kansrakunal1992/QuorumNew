// lib/chat-intake-checkpoint-helpers.ts
// ── Launch hardening helpers for POST /api/chat-intake/checkpoint (pure / injected) ──
// Next.js route files may only export HTTP handlers, so the testable pieces live here. The Supabase client is passed in
// (structurally typed), which lets tests drive them with a fake and prove the behaviour without a database.

export const CLAIM_STALE_MS = 90_000

/** The slice of the Supabase query builder these helpers use. */
interface ClaimDb {
  from(table: string): {
    update(values: Record<string, unknown>): {
      eq(col: string, val: string): {
        or(filter: string): { select(cols: string): PromiseLike<{ data: unknown[] | null; error: { message: string } | null }> }
      } & PromiseLike<unknown>
    }
  }
}

export type ClaimResult = 'claimed' | 'held' | 'unavailable'

/**
 * 'claimed' = we hold it; 'held' = someone else is mid-creation (a fresh claim exists);
 * 'unavailable' = the column is missing or the call failed — proceed unclaimed (never block a launch on the claim itself).
 */
export async function claimCheckpoint(db: ClaimDb, chatIntakeId: string, now: number = Date.now()): Promise<ClaimResult> {
  try {
    const staleBefore = new Date(now - CLAIM_STALE_MS).toISOString()
    const { data, error } = await db
      .from('chat_intakes')
      .update({ checkpoint_claimed_at: new Date(now).toISOString() })
      .eq('id', chatIntakeId)
      .or(`checkpoint_claimed_at.is.null,checkpoint_claimed_at.lt.${staleBefore}`)
      .select('id')
    if (error) return 'unavailable'
    return data && data.length > 0 ? 'claimed' : 'held'
  } catch {
    return 'unavailable'
  }
}

/** Best-effort release so an immediate retry after a failed creation is not made to wait out the stale window. */
export async function releaseClaim(db: ClaimDb, chatIntakeId: string): Promise<void> {
  try { await (db.from('chat_intakes').update({ checkpoint_claimed_at: null }).eq('id', chatIntakeId) as PromiseLike<unknown>) } catch { /* best-effort */ }
}

/**
 * Headers for the internal POST /api/session. /api/session rate-limits by client IP, so the REAL client's address must
 * be forwarded — otherwise every launch looks like it came from the server and all users share one bucket.
 */
export function internalSessionHeaders(src: { authorization?: string | null; forwardedFor?: string | null; realIp?: string | null }): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    ...(src.authorization ? { Authorization: src.authorization } : {}),
    ...(src.forwardedFor ? { 'x-forwarded-for': src.forwardedFor } : {}),
    ...(src.realIp ? { 'x-real-ip': src.realIp } : {}),
  }
}

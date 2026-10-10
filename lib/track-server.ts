// lib/track-server.ts
// -- Phase 4 (retention work): events that only the server can witness ---------
// paid_conversion and mirror_unlocked happen in the payment webhook, not in a
// browser, so they cannot go through POST /api/events. Writes straight to the
// same `events` table (supabase/phase0_events.sql) with the service client.
// Never throws and never changes the caller's response -- a webhook must not
// fail (and make Razorpay retry) because an analytics row could not be written.

import type { SupabaseClient } from '@supabase/supabase-js'

export async function trackServer(
  supabase: SupabaseClient,
  event: string,
  opts: { userId: string; sessionId?: string | null; props?: Record<string, string | number | boolean | null> },
): Promise<void> {
  try {
    let identity: 'google' | 'magic_link' = 'magic_link'
    try {
      const { data } = await supabase.auth.admin.getUserById(opts.userId)
      if (data?.user?.app_metadata?.provider === 'google') identity = 'google'
    } catch { /* default stays */ }

    const { error } = await supabase.from('events').insert({
      event,
      user_id:        opts.userId,
      session_id:     opts.sessionId ?? null,
      identity_state: identity,
      props:          opts.props ?? {},
    })
    if (error) console.warn(`[track-server] ${event} skipped:`, error.message)
  } catch (err) {
    console.warn(`[track-server] ${event} failed:`, err)
  }
}

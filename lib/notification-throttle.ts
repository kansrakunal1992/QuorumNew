// lib/notification-throttle.ts
// ── Shared cross-cron nudge gate ─────────────────────────────────────────────
//
// daily-nudge and validation-nudge share ONE rolling clock per user, so they
// can't both contact the same person back-to-back. Push + email are now sent
// as a single combo decision (see PushEnablePrompt copy: "never back-to-back")
// — there is no separate push-only throttle anymore. If canSendNudge() says
// no, neither channel fires for that source's run.
//
// reanalyze-email is intentionally NOT gated here. Its 7/14/30-day milestone
// emails fire at most 3 times ever per session, at a specific meaningful
// moment (checking in on a real decision's outcome) — unlike daily-nudge or
// validation-nudge, a missed reanalyze milestone has no retry; "day 14.5"
// doesn't exist. Silently dropping it for an unrelated nudge collision would
// be a real product loss, not just noise-reduction. mirror-insight-email is
// also excluded — it's email-only and already has its own 7-day cooldown.
//
// Priority between the two gated sources (validation-nudge over daily-nudge)
// is enforced by CRON SCHEDULE ORDER, not by logic here — see the deploy
// notes for the schedule. Whichever source's cron runs first in a given
// window claims the shared slot; the later one correctly sees it's taken.
//
// Fails closed: if the DB check itself errors, treat it as "already sent"
// (skip) rather than risk a double-send because of an unrelated DB hiccup.
// ─────────────────────────────────────────────────────────────────────────────

import { createServiceClient } from './supabase'

export const SHARED_NUDGE_GATE_DAYS = 3

export type NudgeSource = 'daily_nudge' | 'validation_nudge'

/**
 * True if this user has NOT received a nudge combo (any gated source) within
 * the shared window. Call this immediately before sending; if it returns
 * true, send both email and push, then call recordNudge().
 */
export async function canSendNudge(
  userId: string,
  withinDays: number = SHARED_NUDGE_GATE_DAYS,
): Promise<boolean> {
  const supabase = createServiceClient()
  const cutoff = new Date(Date.now() - withinDays * 86_400_000).toISOString()

  const { data, error } = await supabase
    .from('notification_log')
    .select('id')
    .eq('user_id', userId)
    .gte('sent_at', cutoff)
    .limit(1)

  if (error) {
    console.error('[NotificationThrottle] canSendNudge check failed — failing closed:', error)
    return false
  }

  return (data?.length ?? 0) === 0
}

/** Record that a nudge combo was just sent — claims the shared slot. */
export async function recordNudge(userId: string, source: NudgeSource): Promise<void> {
  const supabase = createServiceClient()
  const { error } = await supabase.from('notification_log').insert({ user_id: userId, source })
  if (error) console.error('[NotificationThrottle] recordNudge failed:', error)
}

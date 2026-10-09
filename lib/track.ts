// lib/track.ts
// -- Phase 0 (retention work): first-party product events ---------------------
// Fire-and-forget. Never throws, never blocks UI. Writes to the `events` table
// through POST /api/events (see supabase/phase0_events.sql).
//
// Identity: user_id / identity_state are resolved SERVER-SIDE from the bearer
// token (so they cannot be spoofed). device_id is read from localStorage only
// if it already exists -- this helper never creates one, so it respects the
// functional-cookie consent gate in lib/storage.ts. Without consent, events are
// still recorded, just without a device_id.
//
// decision_index = number of decisions already in this browser's local history
// when the event fired. For true D1..D5 funnels use supabase/phase0_funnel_views.sql,
// which derives the index from the sessions table instead.

import { getStoredDeviceId, getStoredSessionIds } from '@/lib/storage'
import { getAuthHeaders } from '@/lib/auth-headers'

export type TrackEventName =
  | 'landing_view'
  | 'decision_started'
  | 'decision_checkpointed'
  | 'decision_completed'
  | 'another_decision_clicked'
  | 'park_started'
  | 'park_saved'
  | 'tally_seen'
  | 'auth_prompt_seen'
  | 'auth_started'
  | 'magic_link_requested'
  | 'auth_skipped'
  | 'auth_completed'
  | 'review_date_chosen'
  | 'gate_arm_assigned'
  | 'observation_seen'
  | 'habit_saved'
  | 'install_prompt_seen'
  | 'install_prompt_accepted'

export type TrackProps = Record<string, string | number | boolean | null>

export function track(
  event: TrackEventName,
  props: TrackProps = {},
  opts: { sessionId?: string | null } = {},
): void {
  if (typeof window === 'undefined') return
  void (async () => {
    try {
      const auth = await getAuthHeaders()
      await fetch('/api/events', {
        method:    'POST',
        keepalive: true,
        headers:   { 'Content-Type': 'application/json', ...auth },
        body: JSON.stringify({
          event,
          deviceId:      getStoredDeviceId(),
          decisionIndex: getStoredSessionIds().length,
          sessionId:     opts.sessionId ?? null,
          props,
        }),
      })
    } catch { /* analytics must never affect the product */ }
  })()
}

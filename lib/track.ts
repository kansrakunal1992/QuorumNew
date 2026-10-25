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
  | 'starter_opened'
  | 'starter_picked'
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
  | 'notification_opted_in'
  | 'notification_opened'
  | 'notification_to_decision'
  | 'mirror_viewed'
  | 'return_visit'
  // v8 — Natural Intake cards. Additive: every earlier event above still fires exactly as before.
  // Props are stable ids / counts / booleans only — never option wording, never free text.
  | 'intake_card_group_shown'
  | 'intake_card_answered'
  | 'intake_card_freetext_opened'
  | 'intake_council_ready'
  | 'intake_summary_shown'
  | 'intake_summary_action'
  // v9 — progressive cards + single confirmation. Counts / ids only, never wording.
  | 'intake_reflection_shown'
  | 'intake_step_shown'
  | 'intake_checkpoint_error'
  | 'council_launch_requested'      // the person asked for the Council (Convene tapped / launch confirmed) — NOT proof it started
  | 'intake_summary_feedback'        // one-tap "did this capture it?" on the summary: captured = yes | partly | no
  | 'council_execution_started'     // the session page actually began running the Council (first advisor request fired)

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

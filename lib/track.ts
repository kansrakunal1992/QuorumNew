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
import { getEventContext } from '@/lib/attribution'

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
  | 'park_pivot_started'
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
  // v10 — shortened journey. One tap after the Council: did the result feel specific to this person? specific = yes | partly | no
  | 'council_specificity_feedback'
  // v14  cookie banner outcome, errors, sign-in-before-Council gate, payment funnel, record + outcome. Ids/enums/counts only.
  | 'consent_shown'
  | 'consent_accepted'            // functional: boolean, via: all | preferences
  | 'consent_rejected'
  | 'client_error'                // where, kind (ai_error | rate_limited | network | payment_failed | other), status
  | 'convene_gate_shown'          // the sign-in step shown immediately before the Council would run
  | 'paywall_viewed'
  | 'checkout_opened'
  | 'payment_success'
  | 'payment_failed'
  | 'checkout_dismissed'
  | 'record_viewed'
  | 'outcome_recorded'

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
          props: { ...getEventContext(event), ...props },   // v14: device class, in-app browser, first-touch channel
        }),
      })
    } catch { /* analytics must never affect the product */ }
  })()
}

export type ClientErrorKind = 'ai_error' | 'rate_limited' | 'network' | 'payment_failed' | 'other'

// v14: failures the person experiences but nothing recorded (a Council advisor that never answered, a 429, a failed
// checkout). Capped per page load so a retry loop cannot flood the events table.
const errorCounts = new Map<string, number>()
export function trackError(where: string, kind: ClientErrorKind, status?: number | null, opts: { sessionId?: string | null } = {}): void {
  const key = `${where}:${kind}`
  const n = (errorCounts.get(key) ?? 0) + 1
  errorCounts.set(key, n)
  if (n > 3) return
  track('client_error', { where, kind, status: typeof status === 'number' ? status : null }, opts)
}

/** Map an HTTP status (or a thrown error) to the error kind used above. */
export function errorKindFromStatus(status: number | null | undefined): ClientErrorKind {
  if (status === 429) return 'rate_limited'
  if (typeof status === 'number' && status >= 500) return 'ai_error'
  if (status == null) return 'network'
  return 'other'
}

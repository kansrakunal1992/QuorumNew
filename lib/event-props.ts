// lib/event-props.ts
// ── Privacy guard for intake / Council-launch analytics props (pure) ─────────
//
// `cleanProps` in app/api/events/route.ts stores any string up to 200 characters a client sends, so privacy
// used to depend entirely on every caller. For the Natural Intake events this is now enforced on the server:
// only known prop KEYS are kept, and string VALUES must look like identifiers (letters, digits and . _ : , | -
// — no spaces), so a sentence of free text, an option label or a name cannot be stored even if a future caller
// passes one by mistake. Numbers and booleans pass through. Everything else is dropped silently.

type Prim = string | number | boolean | null

const INTAKE_EVENTS = new Set([
  'intake_card_group_shown', 'intake_card_answered', 'intake_card_freetext_opened', 'intake_council_ready',
  'intake_summary_shown', 'intake_summary_action', 'intake_summary_feedback', 'intake_reflection_shown',
  'intake_step_shown', 'intake_checkpoint_error', 'council_launch_requested', 'council_execution_started',
  'council_specificity_feedback',
])

const ALLOWED_KEYS = new Set([
  'chat_intake_id', 'flow_version', 'viewport', 'intake_step',
  'question_id', 'slot_key', 'decision_category', 'select_mode', 'min_selections', 'max_selections', 'option_count',
  'adaptive', 'essential', 'sensitive', 'companion', 'group_count',
  'response_type', 'selected_count', 'option_ids', 'used_free_text', 'all_selected', 'met_minimum', 'ms_to_answer',
  'readiness_state', 'unknown_count', 'card_groups_answered', 'skipped_count', 'has_tension', 'ms_to_ready',
  'user_submissions', 'card_taps', 'stakes', 'deferred_count', 'gap_count', 'reflections_shown', 'changed_from_original',
  'action', 'edited', 'shown', 'reason', 'stage', 'captured',
  'derived_answers', 'typed_answers', 'derived_reviewed_on_reveal', 'lean_saved',
  // v10: whether the quick check was shown, how many chat-covered answers were recorded without a screen, and the
  // post-Council "did this feel specific to you?" answer (yes | partly | no)
  'check_shown', 'auto_recorded', 'specific',
])

// Identifier-looking strings only: no spaces, no sentence punctuation.
const SAFE_STRING = /^[A-Za-z0-9._:,|\-]{1,120}$/

export const isIntakeEvent = (event: string): boolean => INTAKE_EVENTS.has(event)

export function sanitizeIntakeProps(event: string, raw: Record<string, Prim>): Record<string, Prim> {
  if (!INTAKE_EVENTS.has(event)) return raw
  const out: Record<string, Prim> = {}
  for (const [k, v] of Object.entries(raw)) {
    if (!ALLOWED_KEYS.has(k)) continue
    if (v === null || typeof v === 'boolean' || typeof v === 'number') out[k] = v
    else if (typeof v === 'string' && SAFE_STRING.test(v)) out[k] = v
  }
  return out
}

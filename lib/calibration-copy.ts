// lib/calibration-copy.ts
// ── Plain-language copy for Calibration Zones + Bias Triggers (Sprint CAL UX, Sprint BT) ────
//
// lib/structural-retrieval.ts's DIM_LABELS ("stakes magnitude", "outcome
// uncertainty") is written for LLM prompts, where precision matters more
// than warmth. This file is the human-facing counterpart.
//
// Consumers: components/CalibrationSparkline.tsx (dimension maps only) and
// components/BiasFingerprint.tsx (dimension maps for Phase-1 dimension
// triggers, flag maps for Phase-2a boolean-flag triggers). DIM_LABELS itself
// is untouched and still feeds the synthesis directive in lib/bias-scorer.ts.
//
// Four maps:
//   DIMENSION_EVERYDAY_PHRASE — keyed by VectorDimName. A plain noun phrase
//     describing the dimension, used in place of "high {dimLabel}".
//   CALIBRATION_ACTION_HINTS  — keyed by VectorDimName. One concrete
//     suggestion per dimension per direction (overconfident / underconfident).
//   FLAG_EVERYDAY_PHRASE      — keyed by BooleanFlagKey (Sprint BT Phase 2a).
//     Plain phrase for urgency_present / counterparty_present.
//   FLAG_ACTION_HINTS         — keyed by BooleanFlagKey. One hint per flag —
//     no direction split, since bias triggers are inherently one-directional
//     (a flag condition that makes a bias MORE costly, never less).
//
// All four deliberately hand-written per key rather than a single generic
// template — genuinely different things go wrong in a high-stakes decision
// versus a time-pressured one versus a negotiation with a counterparty in
// the room, and the copy should reflect that difference.
// ─────────────────────────────────────────────────────────────────────────────

import type { VectorDimName } from '@/lib/structural-retrieval'
import type { BooleanFlagKey, CategoryField } from '@/lib/bias-trigger-engine'

export const DIMENSION_EVERYDAY_PHRASE: Record<VectorDimName, string> = {
  reversibility:                'decisions that are hard to undo',
  time_horizon:                 'decisions whose effects play out over years, not months',
  stakes_magnitude:             'high-stakes decisions',
  outcome_uncertainty:          "decisions where you genuinely can't predict the outcome",
  ambiguity:                    'decisions where the situation itself is unclear',
  task_complexity:              'decisions with a lot of moving parts',
  decision_discriminating_info: "decisions where you're missing a key fact",
  time_pressure:                'decisions made under time pressure',
  decision_unit:                'decisions that need several people to agree',
  value_conflict:               'decisions where your own priorities pull in different directions',
  emotional_intensity:          'emotionally charged decisions',
  identity_alignment:           'decisions tied to who you want to be',
  regret_asymmetry:             'decisions where one mistake would hurt far more than the other',
  upstream_dependency:          "decisions that depend on something else you haven't settled yet",
}

interface ActionHintPair {
  overconfident:  string
  underconfident: string
}

export const CALIBRATION_ACTION_HINTS: Record<VectorDimName, ActionHintPair> = {
  reversibility: {
    overconfident:  "Before committing, name what you'd need to see in the first 30 days to know it's working — and who you'd tell if you wanted out.",
    underconfident: "Your read on these has held up — don't let how hard it is to undo make you slower to trust it.",
  },
  time_horizon: {
    overconfident:  "Pressure-test the timeline: ask what changes about this in year two or three that you can't see clearly today.",
    underconfident: "You've judged these better than you gave yourself credit for — resist waiting for more certainty before acting.",
  },
  stakes_magnitude: {
    overconfident:  "Before deciding, write down the one thing that would have to be true for this to go badly — if you can't name it clearly, that's the gap.",
    underconfident: "High stakes haven't made your judgment worse here — they've made you doubt it more than the evidence warrants.",
  },
  outcome_uncertainty: {
    overconfident:  'Treat your confidence number as a guess, not a fact, and build a real fallback — not just a backup thought.',
    underconfident: "Genuine uncertainty hasn't actually thrown off your judgment here — it's just made a fine read feel less sure.",
  },
  ambiguity: {
    overconfident:  "Before deciding, write down two or three different ways this situation could actually be read — if you've only considered one, that's the risk.",
    underconfident: "Unclear situations haven't hurt your judgment — they've just made you underrate a read that's held up.",
  },
  task_complexity: {
    overconfident:  'Break it into the 2–3 sub-decisions actually driving the outcome — complexity tends to make you feel more in control than you are.',
    underconfident: "The number of moving parts hasn't hurt your judgment — don't let complexity alone talk you out of a call you'd already make well.",
  },
  decision_discriminating_info: {
    overconfident:  'Name the one fact that, if it changed, would change your decision — and check whether you actually have it before committing.',
    underconfident: "Missing information hasn't actually thrown off your calls here — you've decided well with incomplete data before.",
  },
  time_pressure: {
    overconfident:  'Before deciding under a deadline, check whether the deadline is actually real or self-imposed — that single check has mattered for you before.',
    underconfident: "Time pressure hasn't made your judgment worse — it's just made you feel less sure of calls that turned out fine.",
  },
  decision_unit: {
    overconfident:  "Before assuming alignment, ask each person directly what they'd do differently — assumed agreement has cost you more than real disagreement.",
    underconfident: "Needing others on board hasn't hurt your read of these — trust the call you've already made.",
  },
  value_conflict: {
    overconfident:  "Name which priority you're actually choosing this time, out loud — leaving it implicit is when these have cost you.",
    underconfident: "Internal conflict hasn't made your final call worse — it's just made the process feel harder than the outcome warranted.",
  },
  emotional_intensity: {
    overconfident:  'Give it 24 hours before committing if you can — your read on these has tended to shift once the charge settles.',
    underconfident: "Strong emotion hasn't clouded your judgment here — your gut call has held up better than you trusted at the time.",
  },
  identity_alignment: {
    overconfident:  "Separate what this decision says about you from what it actually does for you — that gap is where the overconfidence tends to live.",
    underconfident: "These haven't gone worse for you — don't let the personal stakes make you doubt a read that's been solid.",
  },
  regret_asymmetry: {
    overconfident:  "Name explicitly which mistake you're protecting against — when that's left vague, the bigger one tends to slip through.",
    underconfident: "Lopsided downside hasn't made your calls worse — it's made you more anxious about decisions you were already making well.",
  },
  upstream_dependency: {
    overconfident:  "Name the upstream question you're treating as settled — that's usually the one that turns out not to be.",
    underconfident: "An unresolved upstream question hasn't hurt your judgment on this one — it's just made a fine call feel shakier than it is.",
  },
}

// ── Phase 2a — boolean-flag trigger copy ──────────────────────────────────────
// Mirror-UI-only (see lib/bias-trigger-engine.ts header for why these never
// feed the synthesis directive). No direction split — a flag trigger is
// always "this condition makes the bias more dangerous," never the reverse.
export const FLAG_EVERYDAY_PHRASE: Record<BooleanFlagKey, string> = {
  urgency_present:      'there is real or perceived time pressure',
  counterparty_present: 'another person or party is directly involved',
}

export const FLAG_ACTION_HINTS: Record<BooleanFlagKey, string> = {
  urgency_present:      'Before deciding under a deadline, check whether the deadline is actually real or self-imposed — that single question has mattered for you before.',
  counterparty_present: "Before deciding, write down what you'd want if the other party weren't in the room — then check how much that's actually shifted.",
}

// ── Phase 2b — categorical trigger copy ───────────────────────────────────────
// Mirror-UI feed only by default disposition, but unlike Phase 2a's flags,
// decision_type_primary and dominant_emotion DO feed the synthesis directive
// too (lib/bias-scorer.ts) — these labels are for the Mirror UI card; the
// synthesis-facing phrasing pulls from lib/bias-trigger-engine.ts's
// CATEGORY_VALUE_LABELS directly. No direction split — same one-directional
// rule as flag triggers.
export const CATEGORY_ACTION_HINTS: Record<CategoryField, Record<string, string>> = {
  decision_type_primary: {
    commitment:   "Before locking in a commitment, name the exit cost out loud — that's usually the thing this pattern skips.",
    allocation:   "Before allocating, write down what you're NOT funding as a result — the trade-off is where this pattern tends to hide.",
    transition:   "Before a transition, name what specifically ends — vague transitions are where this pattern shows up most.",
    acquisition:  "Before acquiring anything, separate what you're buying from what you're hoping it becomes — that gap is where this pattern lives.",
    renunciation: "Before giving something up, name what you expect to gain from letting go — if you can't say it plainly, slow down.",
    governance:   "Before setting a rule or structure, ask who it actually constrains — including yourself — before deciding it's the right one.",
    delegation:   "Before delegating, name the one thing you're not willing to hand off — if you can't name it, that's the risk.",
  },
  dominant_emotion: {
    anxiety:      "When you notice anxiety driving the decision, separate the part that's real risk from the part that's just discomfort with not knowing yet.",
    excitement:   "When something feels exciting, give it 24 hours before committing — this pattern has tended to look different a day later.",
    obligation:   "When a decision feels like something you 'should' do, check whether it's actually yours to do — obligation has blurred that line before.",
    ambivalence:  "When you're genuinely torn, name the actual trade-off you're avoiding choosing between — staying in ambivalence has a cost too.",
    urgency:      "When it feels urgent, check whether the urgency is real or self-generated — that question alone has changed the outcome before.",
    resignation:  "When a decision feels like the only option left, double-check that's actually true — resignation has narrowed the field before when it wasn't.",
  },
}
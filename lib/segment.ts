// lib/segment.ts
// ── v18: which group a decision belongs to, for events (pure) ────────────────────────────────────────────────────────
//
// The same grouping the repeat-usage analysis kit uses (analysis/02_repeat_by_first_decision.sql), so what the app records and
// what the queries report cannot drift apart. It is deliberately about the TOPIC of the decision (the intake's decisionKind),
// not the ontology's structural decision_type_primary, which cannot tell "raise funding" from "buy a house".
//
//   founder_business  business, team, product
//   feeder_leave_job  career_exit  (someone leaving a job, possibly to start something: the feeder)
//   money_unclear     money        (personal finance or company capital: not forced either way)
//   personal_other    everything else with a kind
//   unclassified      no kind yet
//
// Only ever used to label events with a small fixed set of strings. It never leaves the person's own data.

import { baseKindOf } from '@/lib/decision-playbooks'

export type DecisionSegment = 'founder_business' | 'feeder_leave_job' | 'money_unclear' | 'personal_other' | 'unclassified'

export function segmentOfKind(kind: string | null | undefined): DecisionSegment {
  if (!kind) return 'unclassified'
  const base = baseKindOf(kind) ?? kind.split('.')[0]
  if (!base) return 'unclassified'
  if (base === 'business' || base === 'team' || base === 'product') return 'founder_business'
  if (base === 'career_exit') return 'feeder_leave_job'
  if (base === 'money') return 'money_unclear'
  return 'personal_other'
}

/** The base kind only (never a playbook id), as a short safe label for events. */
export function baseKindLabel(kind: string | null | undefined): string | null {
  if (!kind) return null
  const base = (baseKindOf(kind) ?? kind.split('.')[0]) || null
  return base && /^[a-z_]{2,24}$/.test(base) ? base : null
}

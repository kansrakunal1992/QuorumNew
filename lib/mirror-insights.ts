// lib/mirror-insights.ts
// ── v16 Phase 4: the Mirror as three questions, built only from what the record supports ──────────────────────────
//
//   1. What has Quorum learned about how I decide?     -> `learned`
//   2. What should I watch for?                        -> `watch`
//   3. What could I do differently next time?          -> `next`
//
// Pure and deterministic: no model call, no new table, nothing inferred. Every insight is a count over decisions the person
// actually made, carries the decisions it rests on, and says how much evidence that is. It reuses the observation engine that
// already powers the "Quorum noticed" line (lib/cross-decision-observations.ts), so the wording and the numbers agree
// everywhere they appear.
//
// WHAT THIS DELIBERATELY DOES NOT DO
//   - It does not describe personality, motives or "what kind of decider you are".
//   - It does not show a claim that is weak: a repeat has to be a majority, an instinct split has to be lopsided.
//   - It does not fill empty space. With nothing that clears its threshold it says so, and says what would change that.
//   - It does not call early evidence a pattern. Fewer than three decisions is "early"; "established" needs five or more
//     AND a clear majority.
// The deeper Mirror (fingerprint, rules, contradictions, calibration) is unchanged and sits below this for people who have it.

import { computeObservations, followedInstinct } from './cross-decision-observations'
import type { DecisionRow } from './cross-decision-observations'
import { priorityLabel } from './chat-intake-lean'

/** A decision row plus the facts the "watch" insights need. Extra fields are optional so plain DecisionRows still work. */
export interface InsightRow extends DecisionRow {
  /** First words of the decision, for the evidence list. Only ever returned to the signed-in owner. */
  decision_snippet?: string | null
  session_depth?:    'checkpoint' | 'council' | null
  locked?:           boolean
  /** YYYY-MM-DD the person chose for the check-in. */
  review_date?:      string | null
  has_outcome?:      boolean
}

export type InsightGroup = 'learned' | 'watch'
export type InsightKind  = 'priority_repeat' | 'instinct_follow' | 'prediction' | 'uncommitted' | 'checkins_due'
/** `fact` = a plain fact about the record (not a pattern, so it carries no strength of evidence). */
export type Confidence   = 'early' | 'emerging' | 'established' | 'fact'

export interface InsightEvidence { id: string; label: string; created_at: string }

export interface Insight {
  id:             string
  group:          InsightGroup
  kind:           InsightKind
  claim:          string
  confidence:     Confidence
  /** One honest sentence about how much this rests on. */
  confidenceNote: string
  /** How many decisions it rests on. Always present, even when `evidence` is withheld. */
  evidenceCount:  number
  /** The decisions behind it. Empty for the anonymous view (see /api/mirror/overview). */
  evidence:       InsightEvidence[]
  /** A question or step to try next time. null when nothing useful can be said without guessing. */
  nextTime:       string | null
  strength:       number
}

export interface NextStep { text: string; fromInsightId: string }

export interface MirrorOverviewData {
  decisionCount: number
  learned:       Insight[]
  watch:         Insight[]
  next:          NextStep[]
}

// ── Thresholds (all in one place, all tested) ───────────────────────────────
export const WINDOW                  = 8     // same window as computeObservations
export const MIN_REPEAT_SHARE        = 0.5   // a repeated priority must be at least a majority of the decisions that named one
export const MIN_INSTINCT_STRENGTH   = 0.5   // 3 of 4, or 1 of 4 or fewer: lopsided enough to say anything
export const MIN_UNCOMMITTED         = 2     // at least two examined decisions never committed to
export const MIN_UNCOMMITTED_SHARE   = 0.4
export const UNCOMMITTED_GRACE_DAYS  = 2     // a decision examined today is not "never committed to" yet
export const MAX_NEXT_STEPS          = 2

/** How strongly does this much evidence support a pattern? Never "established" on fewer than five decisions. */
export function confidenceFor(n: number, strength: number): Confidence {
  if (n < 3) return 'early'
  if (n >= 5 && strength >= 0.6) return 'established'
  return 'emerging'
}

export function confidenceNote(c: Confidence, n: number): string {
  switch (c) {
    case 'early':       return `Early: this rests on only ${n} decisions, so treat it as a first observation.`
    case 'emerging':    return `Emerging: ${n} decisions point the same way. Not yet proven.`
    case 'established': return `Holds across ${n} decisions.`
    case 'fact':        return 'A fact about your record, not a pattern.'
  }
}

const snip = (r: InsightRow): string => {
  const t = (r.decision_snippet ?? '').trim().replace(/\s+/g, ' ')
  if (!t) return 'A decision'
  return t.length > 80 ? `${t.slice(0, 79).trimEnd()}…` : t
}
const ev = (rows: InsightRow[], withEvidence: boolean): InsightEvidence[] =>
  withEvidence ? rows.map(r => ({ id: r.id, label: snip(r), created_at: r.created_at })) : []

const newestFirst = (rows: InsightRow[]) =>
  [...rows].sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0))

function dayNumber(d: Date): number { return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000) }
function daysBetween(iso: string, now: Date): number | null {
  const t = new Date(iso)
  if (isNaN(t.getTime())) return null
  return dayNumber(now) - dayNumber(t)
}
function reviewDue(date: string | null | undefined, now: Date): boolean {
  if (!date || !/^\d{4}-\d{2}-\d{2}/.test(date)) return false
  const [y, m, d] = date.slice(0, 10).split('-').map(Number)
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000) <= dayNumber(now)
}

export function buildInsights(
  allRows: InsightRow[],
  opts: { now?: Date; withEvidence?: boolean } = {},
): MirrorOverviewData {
  const now = opts.now ?? new Date()
  const withEvidence = opts.withEvidence ?? true
  const recent = newestFirst(allRows).slice(0, WINDOW)
  const learned: Insight[] = []
  const watch: Insight[] = []

  // ── learned: priority repeat ───────────────────────────────────────────────
  const named = recent.filter(r => r.optimization_priority && r.optimization_priority !== 'other')
  const obs = computeObservations(recent, { window: WINDOW })
  const pr = obs.find(o => o.kind === 'priority_repeat')
  if (pr) {
    const p = pr.key.split(':')[1]
    const support = named.filter(r => r.optimization_priority === p)
    const share = support.length / named.length
    if (support.length >= 2 && share >= MIN_REPEAT_SHARE) {
      const c = confidenceFor(named.length, share)
      learned.push({
        id: `priority:${p}`, group: 'learned', kind: 'priority_repeat',
        claim: pr.line, confidence: c, confidenceNote: confidenceNote(c, named.length),
        evidenceCount: support.length, evidence: ev(support, withEvidence),
        nextTime: `Next time, before you start, write down what you would choose if ${priorityLabel(p).toLowerCase()} did not matter. If the answer changes, that is worth knowing.`,
        strength: pr.strength,
      })
    }
  }

  // ── learned: instinct followed or overridden ───────────────────────────────
  const withInstinct = recent.filter(r => followedInstinct(r.initial_instinct, r.final_decision_plain) !== null)
  const ins = obs.find(o => o.kind === 'instinct_follow')
  if (ins && withInstinct.length >= 2 && ins.strength >= MIN_INSTINCT_STRENGTH) {
    const k = withInstinct.filter(r => followedInstinct(r.initial_instinct, r.final_decision_plain)).length
    const followed = k / withInstinct.length >= 0.5
    const c = confidenceFor(withInstinct.length, ins.strength)
    learned.push({
      id: `instinct:${followed ? 'followed' : 'overrode'}`, group: 'learned', kind: 'instinct_follow',
      claim: ins.line, confidence: c, confidenceNote: confidenceNote(c, withInstinct.length),
      evidenceCount: withInstinct.length, evidence: ev(withInstinct, withEvidence),
      nextTime: followed
        ? 'Next time, before you lock it, ask what would have to be true for your first instinct to be wrong.'
        : 'Next time, note what changed your mind. If it is the same thing each time, that is your real criterion.',
      strength: ins.strength,
    })
  }

  // ── learned: how often Quorum's guess matched ──────────────────────────────
  const withPred = recent.filter(r => r.prediction_matched_final !== null && r.prediction_matched_final !== undefined)
  const pd = obs.find(o => o.kind === 'prediction')
  if (pd && withPred.length >= 2) {
    const c = confidenceFor(withPred.length, pd.strength)
    learned.push({
      id: 'prediction', group: 'learned', kind: 'prediction',
      claim: pd.line, confidence: c, confidenceNote: `${confidenceNote(c, withPred.length)} This is about how well Quorum anticipates you, not a verdict on you.`,
      evidenceCount: withPred.length, evidence: ev(withPred, withEvidence),
      nextTime: null,   // nothing useful to say here without guessing
      strength: pd.strength,
    })
  }

  // ── watch: examined but never committed to ────────────────────────────────
  const examined = recent.filter(r => r.session_depth === 'council')
  const open = examined.filter(r => !r.locked && !r.has_outcome && (daysBetween(r.created_at, now) ?? 0) >= UNCOMMITTED_GRACE_DAYS)
  if (examined.length > 0 && open.length >= MIN_UNCOMMITTED && open.length / examined.length >= MIN_UNCOMMITTED_SHARE) {
    const share = open.length / examined.length
    const c = confidenceFor(examined.length, share)
    watch.push({
      id: 'uncommitted', group: 'watch', kind: 'uncommitted',
      claim: `${open.length} of your ${examined.length} examined decisions were never committed to.`,
      confidence: c, confidenceNote: confidenceNote(c, examined.length),
      evidenceCount: open.length, evidence: ev(open, withEvidence),
      nextTime: 'When a decision stays open, choose one on purpose: commit, park it, or write down what would make you commit.',
      strength: share,
    })
  }

  // ── watch: check-ins waiting ──────────────────────────────────────────────
  const due = recent.filter(r => !r.has_outcome && reviewDue(r.review_date, now))
  if (due.length >= 1) {
    watch.push({
      id: 'checkins_due', group: 'watch', kind: 'checkins_due',
      claim: due.length === 1
        ? 'One check-in you set is waiting for you to record how it went.'
        : `${due.length} check-ins you set are waiting for you to record how they went.`,
      confidence: 'fact', confidenceNote: confidenceNote('fact', due.length),
      evidenceCount: due.length, evidence: ev(due, withEvidence),
      nextTime: 'Record how it went. That is what lets Quorum compare what it expected with what actually happened.',
      strength: 1,
    })
  }

  // ── next: the two strongest suggestions, each tied to the insight it came from ──
  const next: NextStep[] = [...learned, ...watch]
    .filter(i => !!i.nextTime)
    .sort((a, b) => b.strength - a.strength)
    .slice(0, MAX_NEXT_STEPS)
    .map(i => ({ text: i.nextTime as string, fromInsightId: i.id }))

  return { decisionCount: allRows.length, learned, watch, next }
}

/** What to say when nothing clears its threshold. Names what would change that; never fills the space. */
export function emptyOverviewLine(decisionCount: number): string {
  if (decisionCount <= 0) return 'Your first decision becomes the starting point for everything here.'
  if (decisionCount === 1) return 'One decision is a starting point. A second gives Quorum something to compare.'
  return 'Nothing here is solid enough to say yet. Insights appear when decisions overlap enough to show something, and not before.'
}

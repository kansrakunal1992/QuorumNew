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
//
// v17 adds the two kinds the first version left out, each with its own evidence rule (below), because showing them without one
// would break the rule above:
//   CALIBRATION  rests on decisions where the person recorded how it went AND their confidence going in. Two rules, reusing the
//                thresholds the Mirror's calibration section already uses: a confidence gap needs 3 paired decisions and an average
//                gap of at least 1.5 points out of 10; "sure and wrong" needs 3 decisions the person felt very sure about (8+) with at
//                least two, and at least half, worse than expected.
//   CONTRADICTIONS  are NOT computed here. They are Quorum's model-made reading (lib/contradiction-detector.ts), so they are shown
//                only from results already stored and not dismissed, only to the signed-in owner, one at a time, sharp or notable
//                only, only when both decisions still exist and differ, and always labelled as a reading to check, never a fact.

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
  /** v17: confidence out of 10 recorded before the Council, and looking back once the outcome was recorded. */
  pre_confidence?:   number | null
  retro_confidence?: number | null
  /** v17: better_than_expected | as_expected | worse_than_expected | too_early */
  outcome_quality?:  string | null
}

export type InsightGroup = 'learned' | 'watch'
export type InsightKind  = 'priority_repeat' | 'instinct_follow' | 'prediction' | 'uncommitted' | 'checkins_due' | 'sure_and_wrong' | 'calibration_gap' | 'contradiction'
/**
 * `fact`    a plain fact about the record (not a pattern, so it carries no strength of evidence).
 * `reading` Quorum's own model-made interpretation (contradictions). Not a count, so it has no strength either; it is always
 *           offered as something to check, with a way to say it is wrong.
 */
export type Confidence   = 'early' | 'emerging' | 'established' | 'fact' | 'reading'

export interface InsightEvidence { id: string; label: string; created_at: string; /** e.g. 'Where you said it' */ role?: string }

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
  /** v17: set only on a contradiction. The id the person can dismiss it by if the reading is wrong. */
  dismissId?:     string
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
// v17 calibration (confidence is 1-10). The first two are the Mirror calibration section's own: dataReady at 3 paired points,
// and its "strong" pattern at an average gap beyond 1.5.
export const MIN_CALIBRATION_PAIRS   = 3
export const MIN_CALIBRATION_GAP     = 1.5
export const VERY_SURE               = 8     // "very sure" going in: 8 or more out of 10
export const MIN_SURE_DECISIONS      = 3
export const MIN_SURE_WRONG          = 2
export const MIN_SURE_WRONG_SHARE    = 0.5

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
    case 'reading':     return 'Quorum’s reading of two of your decisions, not a fact. Check it against them, and dismiss it if it is wrong.'
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

  // ── watch: very sure going in, and it turned out worse ─────────────────────
  const settled = recent.filter(r => typeof r.pre_confidence === 'number' && r.has_outcome &&
    (r.outcome_quality === 'better_than_expected' || r.outcome_quality === 'as_expected' || r.outcome_quality === 'worse_than_expected'))
  const sure = settled.filter(r => (r.pre_confidence as number) >= VERY_SURE)
  const sureWrong = sure.filter(r => r.outcome_quality === 'worse_than_expected')
  if (sure.length >= MIN_SURE_DECISIONS && sureWrong.length >= MIN_SURE_WRONG && sureWrong.length / sure.length >= MIN_SURE_WRONG_SHARE) {
    const share = sureWrong.length / sure.length
    const c = confidenceFor(sure.length, share)
    watch.push({
      id: 'sure_and_wrong', group: 'watch', kind: 'sure_and_wrong',
      claim: `${sureWrong.length} of the ${sure.length} decisions you felt very sure about (${VERY_SURE} or more out of 10) turned out worse than you expected.`,
      confidence: c, confidenceNote: confidenceNote(c, sure.length),
      evidenceCount: sureWrong.length, evidence: ev(sureWrong, withEvidence),
      nextTime: 'Next time you feel very sure, write down what you would have to see to change your mind before you commit.',
      strength: share,
    })
  }

  // ── learned: confidence going in versus looking back ───────────────────────
  const paired = recent.filter(r => typeof r.pre_confidence === 'number' && typeof r.retro_confidence === 'number' && r.has_outcome)
  if (paired.length >= MIN_CALIBRATION_PAIRS) {
    const avgPre   = paired.reduce((t, r) => t + (r.pre_confidence as number), 0) / paired.length
    const avgRetro = paired.reduce((t, r) => t + (r.retro_confidence as number), 0) / paired.length
    const delta = avgRetro - avgPre
    if (Math.abs(delta) >= MIN_CALIBRATION_GAP) {
      const strength = Math.min(1, Math.abs(delta) / 4)
      const c = confidenceFor(paired.length, strength)
      const pre = Math.round(avgPre * 10) / 10, retro = Math.round(avgRetro * 10) / 10
      const lowerAfter = delta < 0
      learned.push({
        id: 'calibration_gap', group: 'learned', kind: 'calibration_gap',
        claim: `Across ${paired.length} decisions, your confidence averaged ${pre} out of 10 going in and ${retro} looking back. ` +
          (lowerAfter ? 'You tend to feel surer going in than you do afterwards.' : 'You tend to feel less sure going in than you do afterwards.'),
        confidence: c, confidenceNote: confidenceNote(c, paired.length),
        evidenceCount: paired.length, evidence: ev(paired, withEvidence),
        nextTime: lowerAfter
          ? 'Next time, write down your confidence and what would lower it before you commit.'
          : 'Next time, notice when your first read turns out right. It may be worth trusting sooner.',
        strength,
      })
    }
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


// ── v17: contradictions, from stored results only ────────────────────────────────────────────────────────────────────
// These are Quorum's model-made readings (lib/contradiction-detector.ts), stored by the existing pipeline, which already requires
// five sessions with examiner evidence before it runs. This function adds NO detection. It decides whether a stored one is safe
// to show, and how: owner only, one at a time, sharp or notable only, both decisions still present and different, labelled as a
// reading, with a way to dismiss it.
export interface StoredContradiction {
  id:                   string
  principle_text:       string | null
  principle_session_id: string | null
  violation_text:       string | null
  violation_session_id: string | null
  severity:             string | null
  generated_at:         string
}
export interface ContradictionSession { id: string; snippet: string; created_at: string }

const SEVERITY_RANK: Record<string, number> = { sharp: 2, notable: 1 }
const clip = (t: string, n: number) => { const x = t.trim().replace(/\s+/g, ' '); return x.length > n ? `${x.slice(0, n - 1).trimEnd()}…` : x }

export function buildContradictionInsight(stored: StoredContradiction[], sessions: ContradictionSession[]): Insight | null {
  const byId = new Map(sessions.map(s => [s.id, s]))
  const usable = stored
    .filter(c => (SEVERITY_RANK[c.severity ?? ''] ?? 0) > 0)
    .filter(c => !!c.principle_text?.trim() && !!c.violation_text?.trim())
    .filter(c => !!c.principle_session_id && !!c.violation_session_id && c.principle_session_id !== c.violation_session_id)
    .filter(c => byId.has(c.principle_session_id as string) && byId.has(c.violation_session_id as string))
    .sort((a, b) => (SEVERITY_RANK[b.severity ?? ''] - SEVERITY_RANK[a.severity ?? '']) || (a.generated_at < b.generated_at ? 1 : -1))
  const c = usable[0]
  if (!c) return null
  const said = byId.get(c.principle_session_id as string) as ContradictionSession
  const did  = byId.get(c.violation_session_id as string) as ContradictionSession
  return {
    id: `contradiction:${c.id}`, group: 'watch', kind: 'contradiction',
    claim: `Quorum read a tension between two of your decisions. You said: “${clip(c.principle_text as string, 160)}”. Elsewhere: ${clip(c.violation_text as string, 200)}`,
    confidence: 'reading', confidenceNote: confidenceNote('reading', 2),
    evidenceCount: 2,
    evidence: [
      { id: said.id, label: said.snippet || 'A decision', created_at: said.created_at, role: 'Where you said it' },
      { id: did.id,  label: did.snippet  || 'A decision', created_at: did.created_at,  role: 'Where it seems to differ' },
    ],
    nextTime: 'Look at the two decisions side by side. Either the principle has changed or the decision did not follow it. Decide which, and say so.',
    strength: (SEVERITY_RANK[c.severity ?? ''] ?? 1) / 2,
    dismissId: c.id,
  }
}

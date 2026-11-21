// lib/desk.ts
// ── v15 Phase 2: the Decision Desk model (pure, no I/O) ──────────────────────
//
// Turns a person's decisions (as returned by /api/history) into the handful of groups the Desk shows. Everything here is
// derived from fields that already exist on `sessions` -- no new table, no new AI call, no new score.
//
//   due         a review date has arrived (or passed) and no outcome has been logged   -> "How did it go?"
//   open        the Council has run, but the person has not committed to a decision    -> "Decide"
//   unexamined  saved (e.g. "I'm done" at the checkpoint) but the Council has not run   -> "Examine it"
//   waiting     committed, review date still ahead (or committed with no date)         -> "Quorum will check back"
//   closed      an outcome has been logged                                              -> history only
//
// It is a personal workspace, not a task board: no priorities, no due-date columns, no streaks. The only dates shown are
// the review dates the person chose themselves.

export interface DeskSession {
  id:                        string
  decision_text:             string
  created_at:                string
  status?:                   'active' | 'completed' | null
  session_depth?:            'checkpoint' | 'council' | null
  final_decision_locked_at?: string | null
  commitment_review_date?:   string | null
  outcome?:                  { council_helped: string; what_decided: string } | null
}

export type DeskKind = 'due' | 'open' | 'unexamined' | 'waiting' | 'closed'

export interface DeskItem {
  session:    DeskSession
  kind:       DeskKind
  /** Days until the review date: 0 = today, negative = overdue, null = no date. */
  dueInDays:  number | null
}

export interface DeskModel {
  due:        DeskItem[]
  open:       DeskItem[]
  unexamined: DeskItem[]
  waiting:    DeskItem[]
  closed:     DeskItem[]
  total:      number
  /** True when at least one group other than `closed` has something in it. */
  hasActive:  boolean
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}/

/** Local calendar day number (days since epoch) for a Date -- avoids timezone drift when comparing review dates. */
function localDayNumber(d: Date): number {
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000)
}

/** Days from `now` (local calendar day) to a YYYY-MM-DD review date. null when the value is missing or malformed. */
export function daysUntilReview(reviewDate: string | null | undefined, now: Date): number | null {
  if (!reviewDate || !DATE_ONLY.test(reviewDate)) return null
  const [y, m, d] = reviewDate.slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return null
  const target = Math.floor(Date.UTC(y, m - 1, d) / 86_400_000)
  return target - localDayNumber(now)
}

export function classifyDeskSession(s: DeskSession, now: Date): DeskItem {
  const dueInDays = daysUntilReview(s.commitment_review_date, now)
  if (s.outcome) return { session: s, kind: 'closed', dueInDays }
  if (dueInDays !== null) {
    return { session: s, kind: dueInDays <= 0 ? 'due' : 'waiting', dueInDays }
  }
  // No review date.
  if (s.final_decision_locked_at) return { session: s, kind: 'waiting', dueInDays: null }
  if (s.session_depth === 'council') return { session: s, kind: 'open', dueInDays: null }
  return { session: s, kind: 'unexamined', dueInDays: null }
}

const byNewest = (a: DeskItem, b: DeskItem) => (a.session.created_at < b.session.created_at ? 1 : -1)

export function buildDesk(sessions: DeskSession[], now: Date = new Date()): DeskModel {
  const items = sessions.map(s => classifyDeskSession(s, now))
  const pick = (k: DeskKind) => items.filter(i => i.kind === k)

  const due = pick('due').sort((a, b) => (a.dueInDays ?? 0) - (b.dueInDays ?? 0))            // most overdue first
  const waiting = pick('waiting').sort((a, b) => (a.dueInDays ?? 9999) - (b.dueInDays ?? 9999)) // soonest first
  const open = pick('open').sort(byNewest)
  const unexamined = pick('unexamined').sort(byNewest)
  const closed = pick('closed').sort(byNewest)

  return {
    due, open, unexamined, waiting, closed,
    total: sessions.length,
    hasActive: due.length + open.length + unexamined.length + waiting.length > 0,
  }
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** The one line at the top of the Desk. Says what needs the person, in order of how much it matters. */
export function deskHeadline(m: DeskModel, now: Date = new Date()): string {
  if (m.due.length > 0) {
    return m.due.length === 1
      ? 'One decision is ready for its check-in. How did it go?'
      : `${plural(m.due.length, 'decision is', 'decisions are')} ready for a check-in. How did they go?`
  }
  if (m.open.length > 0) {
    return m.open.length === 1
      ? 'One decision has been examined but not decided.'
      : `${m.open.length} decisions have been examined but not decided.`
  }
  if (m.waiting.length > 0) {
    const next = m.waiting.find(w => w.dueInDays !== null)
    if (next && next.dueInDays !== null) {
      return `Nothing is due. Next check-in ${formatWhen(next.dueInDays, next.session.commitment_review_date, now)}.`
    }
    return 'Nothing is due.'
  }
  if (m.unexamined.length > 0) {
    return m.unexamined.length === 1
      ? 'One decision is saved but has not been examined yet.'
      : `${m.unexamined.length} decisions are saved but have not been examined yet.`
  }
  return 'Nothing open. Bring a decision when you have one.'
}

/** "today", "tomorrow", "in 5 days", "on 3 Dec". */
export function formatWhen(daysUntil: number, reviewDate: string | null | undefined, now: Date = new Date()): string {
  if (daysUntil < 0) return daysUntil === -1 ? 'yesterday' : `${Math.abs(daysUntil)} days ago`
  if (daysUntil === 0) return 'today'
  if (daysUntil === 1) return 'tomorrow'
  if (daysUntil <= 14) return `in ${daysUntil} days`
  if (reviewDate && DATE_ONLY.test(reviewDate)) {
    const [y, m, d] = reviewDate.slice(0, 10).split('-').map(Number)
    const dt = new Date(y, m - 1, d)
    if (!isNaN(dt.getTime())) {
      return `on ${dt.toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(dt.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) })}`
    }
  }
  return `in ${daysUntil} days`
}

/**
 * An honest one-liner about how much Quorum has to work with. Deliberately conservative: early counts are called a
 * starting point / first comparison, and nothing here says Quorum "knows" the person. The thresholds match the ones the
 * rest of the product already uses (first comparison at 2, first real look at 3, structural patterns need several).
 */
export function recordStage(total: number): { label: string; line: string } {
  if (total <= 0) return { label: 'Empty', line: 'Your first decision becomes the starting point.' }
  if (total === 1) return { label: 'Starting point', line: 'One decision is a starting point. A second gives Quorum something to compare.' }
  if (total === 2) return { label: 'First comparison', line: 'Two decisions: enough for a first comparison, not yet for patterns.' }
  if (total <= 4) return { label: 'Early signals', line: `${total} decisions: early signals only. Patterns need more evidence than this to be trusted.` }
  return { label: 'Building evidence', line: `${total} decisions: the Mirror shows only what the evidence supports, with how much it rests on.` }
}

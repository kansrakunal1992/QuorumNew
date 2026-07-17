// lib/synthesis-diff.ts
// P1: "What Changed" drawer support (Gaps #2, #3, #5, #8).
//
// Deliberately pure and deterministic — this diffs two already-computed
// snapshots (weights + leans + verdict text) rather than asking the model
// to summarize "what changed." A second LLM call here would add latency,
// cost, and a real chance of inventing a plausible-sounding but incorrect
// explanation; the numbers already say everything that's true.

export interface SynthesisVersionSnapshot {
  version:     number
  verdictText: string
  /** P1 fix: structured proceed|wait|mixed classification of the verdict,
   *  parsed from the model's <verdict_lean> tag. verdictChanged below
   *  compares THIS, not verdictText — the prose sentence is near-never
   *  identical word-for-word between two synthesis runs even when the
   *  underlying recommendation hasn't actually moved, so a text diff was
   *  flagging "the verdict changed" on almost every re-synthesis. */
  verdictLean: string
  weights:     Record<string, number>
  leans:       Record<string, string>
}

export interface WeightDelta {
  persona:  string
  current:  number
  previous: number
  delta:    number   // current - previous, as a 0-100 point difference
}

export interface LeanMove {
  persona: string
  from:    string
  to:      string
}

export interface WhatChangedSummary {
  bullets:        string[]
  weightDeltas:   WeightDelta[]   // sorted desc by |delta|, non-trivial only
  leanMoves:      LeanMove[]
  verdictChanged: boolean
}

export const PERSONA_LABELS: Record<string, string> = {
  contrarian:         'Contrarian',
  risk_architect:     'Risk Architect',
  pattern_analyst:    'Pattern Analyst',
  stakeholder_mirror: 'Stakeholder Mirror',
  elder:              'Elder',
  competitor:         'Competitor',
}

const LEAN_LABELS: Record<string, string> = {
  proceed: 'Proceed',
  wait:    'Wait',
  mixed:   'Mixed',
}

export interface LeanTrajectory {
  persona: string
  /** Collapsed sequence of distinct leans this persona held, in order —
   *  e.g. ['wait', 'proceed'] for an advisor that moved once, however many
   *  versions it took. Consecutive repeats are already removed, so this is
   *  ready to render directly as "Wait → Proceed" without further logic. */
  sequence: string[]
}

/** Sprint 1 (Feature #3, "Advisor Evolution Timeline"). Rolls up how each
 *  advisor's proceed/wait/mixed lean moved across the ENTIRE version
 *  history, not just the latest-vs-previous pair diffSynthesisVersions()
 *  already covers. Deliberately reuses only the `leans` field every
 *  SynthesisVersionSnapshot already carries — no new data capture, no new
 *  AI call, and no attempt to summarize each advisor's actual argument text
 *  (that would need a real LLM call and risk paraphrasing something the
 *  advisor didn't say; the lean tag is already a structured, trustworthy
 *  signal on its own).
 *
 * Only returns personas that actually moved at some point (sequence.length
 * > 1) — an advisor that held the same position throughout has nothing to
 * show here, matching the "only show movers" principle the rest of this
 * file already follows. Callers should also gate on versions.length >= 3:
 * with only two versions this is identical to diffSynthesisVersions()'s
 * own leanMoves, so showing both would just repeat the same information. */
export function buildLeanTrajectories(versions: SynthesisVersionSnapshot[]): LeanTrajectory[] {
  const personas = new Set<string>()
  for (const v of versions) {
    for (const p of Object.keys(v.leans)) personas.add(p)
  }

  const trajectories: LeanTrajectory[] = []
  for (const persona of personas) {
    const sequence: string[] = []
    for (const v of versions) {
      const lean = v.leans[persona]
      if (!lean) continue
      if (sequence[sequence.length - 1] !== lean) sequence.push(lean)
    }
    if (sequence.length > 1) {
      trajectories.push({ persona, sequence })
    }
  }
  return trajectories
}

/** Builds the diff between the two most recent synthesis versions. Expects
 *  `prev` immediately before `curr` (i.e. curr.version === prev.version + 1) —
 *  the drawer only ever calls this on the last two entries in versionHistory. */
export function diffSynthesisVersions(
  prev: SynthesisVersionSnapshot,
  curr: SynthesisVersionSnapshot,
): WhatChangedSummary {
  const personas = new Set([...Object.keys(prev.weights), ...Object.keys(curr.weights)])
  const weightDeltas: WeightDelta[] = []
  for (const p of personas) {
    const previous = Math.round((prev.weights[p] ?? 0.5) * 100)
    const current  = Math.round((curr.weights[p] ?? 0.5) * 100)
    const delta    = current - previous
    // Ignore rounding-noise deltas — only surface a genuine shift.
    if (Math.abs(delta) >= 2) {
      weightDeltas.push({ persona: p, current, previous, delta })
    }
  }
  weightDeltas.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))

  const leanMoves: LeanMove[] = []
  const leanPersonas = new Set([...Object.keys(prev.leans), ...Object.keys(curr.leans)])
  for (const p of leanPersonas) {
    const from = prev.leans[p]
    const to   = curr.leans[p]
    if (from && to && from !== to) {
      leanMoves.push({ persona: p, from, to })
    }
  }

  // P1 fix: compare verdict_lean (proceed|wait|mixed), not verdictText.
  // verdictText is free-form prose the model rewords every run — comparing
  // it directly meant "the council verdict changed" fired on almost every
  // re-synthesis, even when the actual recommendation hadn't moved. Falls
  // back to false (not "changed") when either snapshot lacks a lean — e.g.
  // a version captured before this fix shipped — rather than guessing from text.
  const verdictChanged = !!prev.verdictLean && !!curr.verdictLean
    && prev.verdictLean !== curr.verdictLean

  // Reconciliation bullets, most-informative first: advisor moves, then the
  // top weight shifts, then whether the verdict itself moved — matches the
  // doc's "Since the previous synthesis..." framing. Capped at 5 bullets.
  const bullets: string[] = []
  for (const move of leanMoves.slice(0, 3)) {
    const label = PERSONA_LABELS[move.persona] ?? move.persona
    const from  = LEAN_LABELS[move.from] ?? move.from
    const to    = LEAN_LABELS[move.to]   ?? move.to
    bullets.push(`${label} shifted from ${from} to ${to}.`)
  }
  for (const wd of weightDeltas.slice(0, 2)) {
    const label = PERSONA_LABELS[wd.persona] ?? wd.persona
    const dir   = wd.delta > 0 ? 'gained influence in this synthesis' : 'lost influence in this synthesis'
    bullets.push(`${label} ${dir}.`)
  }
  if (verdictChanged) {
    const from = LEAN_LABELS[prev.verdictLean] ?? prev.verdictLean
    const to   = LEAN_LABELS[curr.verdictLean] ?? curr.verdictLean
    bullets.push(`The council verdict shifted from ${from} to ${to}.`)
  }
  if (bullets.length === 0) {
    bullets.push('No material shift since the last synthesis — the council held its position.')
  }

  return {
    bullets: bullets.slice(0, 5),
    weightDeltas,
    leanMoves,
    verdictChanged,
  }
}

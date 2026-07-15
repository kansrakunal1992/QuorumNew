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

  const verdictChanged = !!curr.verdictText.trim()
    && prev.verdictText.trim() !== curr.verdictText.trim()

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
    bullets.push('The council verdict changed since the last synthesis.')
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

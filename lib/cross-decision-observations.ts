// lib/cross-decision-observations.ts
// -- Phase 2 (retention work): "what Quorum notices across your decisions" ----
// Pure, deterministic, no LLM. Turns a person's recent decision rows into short
// factual observations -- the D2 "first cross-decision observation", the
// rotating one-liner after later decisions, and the trigger for the
// event-driven "Quorum noticed something" email.
//
// Deliberately counts only what the rows literally say (which priority they
// chose, whether the final decision followed the instinct they locked first,
// whether Quorum's prediction matched). Nothing is inferred or invented, so
// there is no fabrication risk and no need to route it through
// lib/fabrication-guard.ts, which exists for model-written text.
//
// Honest by construction: with too little overlap the answer is a plain
// "No overlap yet" line, never a manufactured pattern.

import { priorityLabel } from './chat-intake-lean'   // relative: keeps this file loadable from vitest (no '@' alias there)

export interface DecisionRow {
  id:                       string
  created_at:               string
  optimization_priority:    string | null
  initial_instinct:         string | null
  /** Decrypted final decision text (or null if not locked yet). */
  final_decision_plain:     string | null
  prediction_matched_final: boolean | null
}

export type ObservationKind = 'priority_repeat' | 'instinct_follow' | 'prediction' | 'none'

export interface Observation {
  kind:     ObservationKind
  line:     string
  /** Stable identity of this specific finding -- used to avoid re-sending the same email. */
  key:      string
  /** 0..1, how lopsided / notable the finding is. */
  strength: number
}

export const NO_OVERLAP: Observation = {
  kind: 'none',
  line: 'No overlap yet. Each new decision gives Quorum more to compare.',
  key: 'none',
  strength: 0,
}

const DEFAULT_WINDOW = 8

/** Mirrors trackedInstinctLocal() in app/api/session/[id]/decide/route.ts. */
export function followedInstinct(instinct: string | null, finalPlain: string | null): boolean | null {
  if (!instinct || !finalPlain) return null
  const f = finalPlain.toLowerCase()
  if (instinct === 'accept') return !f.startsWith('no') && !f.includes('reject')
  if (instinct === 'reject') return f.startsWith('no') || f.includes('reject') || f.includes('declin')
  return null
}

function fnv(str: string): number {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) }
  return h >>> 0
}

export function computeObservations(
  rows: DecisionRow[],
  opts: { focusId?: string; window?: number } = {},
): Observation[] {
  const recent = [...rows]
    .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0))
    .slice(0, opts.window ?? DEFAULT_WINDOW)
  const out: Observation[] = []

  // -- priority repeat --------------------------------------------------------
  const withPriority = recent.filter(r => r.optimization_priority && r.optimization_priority !== 'other')
  if (withPriority.length >= 2) {
    const focus = opts.focusId ? withPriority.find(r => r.id === opts.focusId)?.optimization_priority ?? null : null
    let p: string | null = focus
    if (!p) {
      const counts = new Map<string, number>()
      withPriority.forEach(r => counts.set(r.optimization_priority!, (counts.get(r.optimization_priority!) ?? 0) + 1))
      let best = 0
      counts.forEach((c, k) => { if (c > best) { best = c; p = k } })
    }
    if (p) {
      const total = withPriority.length
      const count = withPriority.filter(r => r.optimization_priority === p).length
      if (count >= 2) {
        const label = priorityLabel(p).toLowerCase()
        const line = total === 2
          ? `Both times, you put ${label} first.`
          : count === total
            ? `You've put ${label} first in all ${total} of your recent decisions.`
            : `You put ${label} first in ${count} of your last ${total} decisions.`
        out.push({ kind: 'priority_repeat', line, key: `priority:${p}:${count}`, strength: count / total })
      }
    }
  }

  // -- instinct followed ------------------------------------------------------
  const instinctRows = recent
    .map(r => followedInstinct(r.initial_instinct, r.final_decision_plain))
    .filter((v): v is boolean => v !== null)
  if (instinctRows.length >= 2) {
    const n = instinctRows.length
    const k = instinctRows.filter(Boolean).length
    const line = k === n
      ? (n === 2 ? 'You went with your first instinct both times.' : `You went with your first instinct in all ${n} decisions.`)
      : k === 0
        ? (n === 2 ? 'You overrode your first instinct both times.' : `You overrode your first instinct in all ${n} decisions.`)
        : `You went with your first instinct in ${k} of ${n} decisions.`
    out.push({ kind: 'instinct_follow', line, key: `instinct:${k}:${n}`, strength: Math.abs(k / n - 0.5) * 2 })
  }

  // -- prediction record ------------------------------------------------------
  const predRows = recent.filter(r => r.prediction_matched_final !== null && r.prediction_matched_final !== undefined)
  if (predRows.length >= 2) {
    const t = predRows.length
    const g = predRows.filter(r => r.prediction_matched_final === true).length
    out.push({ kind: 'prediction', line: `Quorum has guessed right ${g} of ${t}.`, key: `prediction:${g}:${t}`, strength: Math.abs(g / t - 0.5) * 2 })
  }

  return out
}

/**
 * Pick one observation to show. Rotates deterministically (by decision count and
 * a seed such as the session id) so people do not see the same line every time,
 * but never invents anything: if nothing qualifies, returns NO_OVERLAP.
 */
export function pickObservation(
  observations: Observation[],
  opts: { n: number; seed: string; exclude?: ObservationKind[] },
): Observation {
  const pool = observations.filter(o => !(opts.exclude ?? []).includes(o.kind))
  if (!pool.length) return NO_OVERLAP
  return pool[(opts.n + fnv(opts.seed)) % pool.length]
}

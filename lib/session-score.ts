// lib/session-score.ts
// ── R4: Session Reliability Index — computation core ─────────────────────────
//
// Unifies four independent data streams into a single per-session score (0–100).
// No LLM calls. No schema changes. Reads from existing tables only.
//
// Formula:
//   score = structural_match_score    × 0.25   (sessions_ontology.matches_json)
//         + bias_clarity_score        × 0.30   (bias_library.activation_contexts)
//         + council_confidence_score  × 0.20   (sessions_ontology.rule_engine_result)
//         + calibration_score         × 0.25   (outcomes.calibration_delta)
//
// Sub-score details:
//   structural_match_score  — maxStructuralScore from matches_json. No history → 50 (neutral)
//   bias_clarity_score      — inverted distorting signal presence × asymmetry. No signals → 80
//   council_confidence_score — deterministic from rule mode + flag count. No LLM required.
//   calibration_score       — from calibration_delta on outcomes row. Pending outcome → 70
//
// Action plan:
//   Always generated. Targets the user's weakest average sub-score across all sessions.
//   Never generic — each action is tied to the specific sub-score and its root cause.
//
// ─────────────────────────────────────────────────────────────────────────────

import { createServiceClient } from '@/lib/supabase'
import type { SessionScoreData }  from '@/lib/types'
import { decrypt, decryptJson }  from '@/lib/encryption'

// ── Sub-score: structural match ───────────────────────────────────────────────
// Source: structural_matches.matches_json (populated by /api/structural-match,
// encrypted at rest). NOT sessions_ontology.
//
// BUGFIX (audit pass, July 2026): matches_json was being selected from
// sessions_ontology — it does not live there, it lives on structural_matches,
// same root cause as the S2-02 fix in app/api/persona/route.ts. Selecting a
// nonexistent column makes Postgres reject the entire query, so ontologyRes
// silently came back empty and structural scoring always fell back to the
// neutral default (hasData: false) — for every session, for every user, on
// top of the MIRROR-1 overload this file already fixed below. Separately,
// bias_library was queried with `bias_label`, but the real column is
// `bias_parameter` (confirmed against every other bias_library call site,
// e.g. app/api/bias-score/route.ts) — same failure mode, so bias-clarity
// scoring was also always falling back to its neutral default (80).
// 50 = neutral (no prior sessions to compare against — not good or bad)

// Bug fix (MIRROR-1): previously returned a bare number, using 50 as both
// "no data available for this session" AND a legitimately reachable real
// score. deriveActionPlan() relied on that overload (checking `=== 50`) as a
// proxy for "user doesn't have enough decisions yet" — but a rounded average
// across up to 20 sessions can land on exactly 50 by pure arithmetic
// coincidence for a user with plenty of real data, which is exactly what
// produced the "Bring 3 or more decisions" message for veteran users. Now
// returns the data-availability flag explicitly instead of overloading the
// score.
function scoreStructural(matchesJson: unknown): { score: number; hasData: boolean } {
  if (!matchesJson || !Array.isArray(matchesJson)) return { score: 50, hasData: false }
  const scores = (matchesJson as Array<{ structural_score?: number }>)
    .map(m => m.structural_score ?? 0)
    .filter(s => s > 0)
  if (scores.length === 0) return { score: 50, hasData: false }
  return { score: Math.round(Math.max(...scores)), hasData: true } // use max match score this session achieved
}

// ── Sub-score: bias clarity ───────────────────────────────────────────────────
// Source: bias_library.activation_contexts JSONB — keyed by session_id
// Penalises for distorting signals weighted by asymmetry_score_avg.
// 80 = baseline when no biases fired in this session (neutral-good)

type BiasRow = {
  bias_parameter: string
  activation_contexts: Record<string, { signal_type?: string }> | null
  asymmetry_score_avg: number
}

function scoreBiasClarity(biasRows: BiasRow[], sessionId: string): {
  score: number
  distortingLabels: string[]
} {
  const active = biasRows.filter(row => {
    const ctx = row.activation_contexts
    return ctx && typeof ctx === 'object' && sessionId in ctx
  })

  if (active.length === 0) return { score: 80, distortingLabels: [] }

  const distorting = active.filter(row => {
    const ctx = row.activation_contexts!
    return (ctx[sessionId]?.signal_type ?? 'neutral') === 'distorting'
  })

  if (distorting.length === 0) return { score: 80, distortingLabels: [] }

  const maxAsymmetry = Math.max(...distorting.map(r => r.asymmetry_score_avg ?? 2))
  const score = Math.max(0, Math.round(100 - distorting.length * maxAsymmetry * 12))

  return {
    score,
    distortingLabels: distorting.map(r => r.bias_parameter as string),
  }
}

// ── Sub-score: council confidence ─────────────────────────────────────────────
// Source: sessions_ontology.rule_engine_result (JSONB — EngineMode + flag_rules array)
// Deterministic — no LLM required.
// Reflects structural clarity of the decision for analysis:
//   OPEN / 0 flags  → 90 (clean conditions for analysis)
//   OPEN / 1–2 flags → 75 (manageable complexity)
//   OPEN / 3+ flags  → 60 (high complexity, divergence likely)
//   GATE             → 50 (structural gate fired — ambiguity or identity tension)
//   REDIRECT         → 35 (decision not ready — upstream block or info gap)

function scoreCouncilConfidence(ruleEngineResult: unknown): number {
  if (!ruleEngineResult || typeof ruleEngineResult !== 'object') return 75
  const r = ruleEngineResult as { mode?: string; flag_rules?: unknown[] }
  const mode      = r.mode ?? 'OPEN'
  const flagCount = Array.isArray(r.flag_rules) ? r.flag_rules.length : 0

  if (mode === 'REDIRECT') return 35
  if (mode === 'GATE')     return 50
  if (flagCount >= 3)      return 60
  if (flagCount >= 1)      return 75
  return 90
}

// ── Sub-score: calibration ────────────────────────────────────────────────────
// Source: outcomes.calibration_delta = retrospective_confidence − pre_decision_confidence
// Negative delta = user was more confident entering than hindsight supported (overconfidence)
// 70 = pending (outcome not yet logged — neutral, not penalised)

function scoreCalibration(calibrationDelta: number | null | undefined): number {
  if (calibrationDelta === null || calibrationDelta === undefined) return 70
  if (calibrationDelta >= 0)    return 85  // well-calibrated or under-confident → learning
  if (calibrationDelta >= -0.3) return 70  // slight overconfidence
  if (calibrationDelta >= -1)   return 50  // moderate overconfidence
  return 30                                 // significant overconfidence
}

// ── Action plan generator ─────────────────────────────────────────────────────
// Targets the user's weakest average sub-score across all sessions.
// Always returns a concrete, non-generic improvement action.

export function deriveActionPlan(avgScores: {
  structural: number
  structuralDataCount: number
  biasClarity: number
  councilConfidence: number
  calibration: number
  hasAnyPendingOutcome: boolean
  topDistortingBias: string | null
  hasMostlyRedirects: boolean
}): string {
  const ranked = [
    { key: 'structural',        score: avgScores.structural },
    { key: 'biasClarity',       score: avgScores.biasClarity },
    { key: 'councilConfidence', score: avgScores.councilConfidence },
    { key: 'calibration',       score: avgScores.calibration },
  ].sort((a, b) => a.score - b.score)

  const weakest = ranked[0]

  switch (weakest.key) {
    case 'structural':
      // Bug fix (MIRROR-1): was `if (avgScores.structural === 50)` — see
      // scoreStructural() comment above for why that was wrong. Now checks
      // the actual thing the copy claims: fewer than 3 sessions with usable
      // structural comparison data.
      if (avgScores.structuralDataCount < 3) {
        return 'Bring 3 or more decisions to Quorum and the Council begins connecting patterns across them — each one makes the next analysis more precise.'
      }
      return 'Bring decisions with different structural profiles — variety in decision type and reversibility builds a richer comparison set and raises your structural match quality.'

    case 'biasClarity':
      if (avgScores.topDistortingBias) {
        return `${avgScores.topDistortingBias} is your most active distorting signal. Name it explicitly in your decision text next time — surfacing it gives the Council a cleaner signal and reduces its pull on the analysis.`
      }
      return 'Provide richer context in your decision text — the more precisely you describe the pressure and constraints, the more accurately the system reads which signals are distorting vs. adaptive.'

    case 'councilConfidence':
      if (avgScores.hasMostlyRedirects) {
        return 'Several of your decisions were redirected — address the upstream dependency or information gap before bringing the decision back. The Council performs best when the decision is ready to be made.'
      }
      return 'Simplify the decision framing before submitting — decisions with fewer competing pressures produce sharper Council analysis. If multiple flags keep firing, consider whether one upstream decision would resolve several downstream ones.'

    case 'calibration':
      if (avgScores.hasAnyPendingOutcome) {
        return 'Return to past decisions and log an outcome — each retrospective directly raises your calibration score and makes the Mirror\'s longitudinal data more precise.'
      }
      return 'Before your next high-stakes decision, write down your confidence level and what would have to be true for you to be wrong. Naming the gap between certainty and evidence is the fastest way to close the calibration delta.'

    default:
      return 'Log outcomes consistently — each retrospective tightens all four sub-scores and compounds your Session Reliability Index over time.'
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function computeUserSessionScores(
  userId:   string,
  supabase: ReturnType<typeof createServiceClient>,
): Promise<SessionScoreData[]> {

  // 1. Fetch last 20 sessions for this user
  const { data: sessions, error: sessErr } = await supabase
    .from('sessions')
    .select('id, decision_text, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(20)

  if (sessErr || !sessions || sessions.length === 0) return []

  const sessionIds = sessions.map(s => s.id as string)

  // 2. Parallel DB reads — four ancillary tables in one round-trip.
  // BUGFIX: matches_json moved to its own query against structural_matches
  // (see header note) — sessions_ontology no longer selects it, and
  // bias_library now selects the real column, bias_parameter.
  const [ontologyRes, biasRes, outcomesRes, structuralMatchesRes] = await Promise.all([
    supabase
      .from('sessions_ontology')
      .select('session_id, rule_engine_result')
      .in('session_id', sessionIds),

    supabase
      .from('bias_library')
      .select('bias_parameter, activation_contexts, asymmetry_score_avg')
      .eq('user_id', userId),

    supabase
      .from('outcomes')
      .select('session_id, calibration_delta')
      .in('session_id', sessionIds),

    supabase
      .from('structural_matches')
      .select('session_id, matches_json')
      .in('session_id', sessionIds),
  ])

  // 3. Index ancillary data by session_id for O(1) lookup
  const ontologyMap = new Map<string, { rule_engine_result: unknown }>()
  for (const row of ontologyRes.data ?? []) {
    ontologyMap.set(row.session_id as string, {
      rule_engine_result: row.rule_engine_result,
    })
  }

  // structural_matches.matches_json is encrypted at rest (encryptJson on write,
  // in app/api/structural-match/route.ts) — decrypt before use, same pattern
  // as the fetchCouncilContext fix in app/api/persona/route.ts.
  const structuralMatchesMap = new Map<string, unknown>()
  for (const row of structuralMatchesRes.data ?? []) {
    structuralMatchesMap.set(row.session_id as string, decryptJson(row.matches_json))
  }

  const biasRows = (biasRes.data ?? []) as BiasRow[]

  const calibrationMap = new Map<string, number | null>()
  for (const row of outcomesRes.data ?? []) {
    calibrationMap.set(row.session_id as string, row.calibration_delta ?? null)
  }

  // 4. Compute per session
  type SessionScoreRow = Omit<SessionScoreData, 'actionPlan'>

  // MIRROR-1: tracked alongside `scored` (not inside it) to avoid touching
  // SessionScoreData's shape / any other consumer of it — this is only
  // needed for the aggregate check below.
  const structuralHasDataFlags: boolean[] = []

  const scored: SessionScoreRow[] = sessions.map(session => {
    const sid      = session.id as string
    const ontology = ontologyMap.get(sid)
    const calibDelta = calibrationMap.get(sid) ?? null

    const { score: structural, hasData: structuralHasData } = scoreStructural(structuralMatchesMap.get(sid))
    structuralHasDataFlags.push(structuralHasData)
    const { score: biasClarity, distortingLabels } = scoreBiasClarity(biasRows, sid)
    const councilConfidence = scoreCouncilConfidence(ontology?.rule_engine_result)
    const calibration       = scoreCalibration(calibDelta)

    const score = Math.round(
      structural        * 0.25 +
      biasClarity       * 0.30 +
      councilConfidence * 0.20 +
      calibration       * 0.25,
    )

    return {
      sessionId:       sid,
      decisionPreview: (decrypt(session.decision_text) ?? '').slice(0, 90),
      createdAt:       session.created_at as string,
      score,
      structural,
      biasClarity,
      councilConfidence,
      calibration,
      calibrationPending: calibDelta === null || calibDelta === undefined,
      distortingBiasLabels: distortingLabels,
    }
  })

  // 5. Derive global action plan from average sub-scores
  const avg = (key: keyof Pick<SessionScoreData, 'structural' | 'biasClarity' | 'councilConfidence' | 'calibration'>) =>
    Math.round(scored.reduce((s, r) => s + r[key], 0) / scored.length)

  // MIRROR-1: real count of sessions with usable structural comparison data —
  // replaces the old `avgScores.structural === 50` proxy.
  const structuralDataCount = structuralHasDataFlags.filter(Boolean).length

  const allDistorting = scored.flatMap(r => r.distortingBiasLabels)
  const topDistortingBias = allDistorting.length > 0
    ? Object.entries(
        allDistorting.reduce<Record<string, number>>((acc, label) => {
          acc[label] = (acc[label] ?? 0) + 1
          return acc
        }, {}),
      ).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
    : null

  const hasMostlyRedirects = scored.filter(r => r.councilConfidence === 35).length > scored.length * 0.4
  const hasAnyPendingOutcome = scored.some(r => r.calibrationPending)

  const actionPlan = deriveActionPlan({
    structural:          avg('structural'),
    structuralDataCount,
    biasClarity:         avg('biasClarity'),
    councilConfidence:   avg('councilConfidence'),
    calibration:         avg('calibration'),
    hasAnyPendingOutcome,
    topDistortingBias,
    hasMostlyRedirects,
  })

  // Attach same global action plan to every row (UI picks it up from [0])
  return scored.map(r => ({ ...r, actionPlan }))
}

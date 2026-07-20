// lib/cohort-insights.ts
// Institutional Sprint 3 (task 2) — cohort insight-sharing.
//
// Built as its own service function, not inline in a route, so Sprint 6's
// audit has one place to check: getCohortInsightsForUser() is the only
// function anywhere that's allowed to assemble a peer's shared insight, and
// it only ever returns the three fields whitelisted in
// lib/cohort-sharing-fields.ts (COHORT_SHARED_FIELDS) — session score,
// calibration delta, bias parameter labels. Never decision_text,
// context_text, response_text, or anything from
// bias_library.activation_contexts.
//
// Sharing rule: for two users in the same cohort, a peer's insight is only
// ever included if BOTH the requesting user and that peer currently have
// consent_shared_cohort = true on their institution_memberships row for the
// cohort's institution. If the requesting user hasn't consented, they see
// nothing about the cohort at all — not even their own reflection of it.
//
// Known scope limits, flagged rather than glossed over:
//   - No institutionId param: this sprint has no "active institution"
//     concept yet (that's Sprint 5's mode switcher), so this walks every
//     cohort the user belongs to across every institution they're in.
//   - independence-score + calibration averaging both do real per-session
//     work (decrypt + score) per peer, per call, live. No caching yet.
//     Acceptable for small cohorts; revisit if cohort sizes grow.
//
// TECH_DEBT.md #2 fix: bias_library is keyed by user_email, not user_id (a
// pre-institutional table) — this function bridges that, and used to do so
// via one auth.admin.getUserById() call per peer (N+1, same pattern as the
// roster route). Now batched: one get_user_emails() RPC call per cohort's
// consenting-peer set, resolved before buildPeerInsight() runs rather than
// inside it. Not batched *across* cohorts in one global call — a user in
// several cohorts still makes one call per cohort — but the per-peer
// pattern the tracker actually flagged is gone.

import { createServiceClient }        from '@/lib/supabase'
import { calculateIndependenceScore } from '@/lib/independence-score'

type ServiceClient = ReturnType<typeof createServiceClient>

export interface CohortPeerInsight {
  userId:              string
  email:               string | null
  sessionScore:        number | null   // whitelisted field: session_score
  sessionScoreDelta:   number | null   // trend component of session_score
  calibrationDeltaAvg: number | null   // whitelisted field: calibration_delta
  biasParameters:      string[]        // whitelisted field: bias_parameter (labels only)
}

export interface CohortInsightsGroup {
  cohortId:      string
  cohortName:    string
  institutionId: string
  peers:         CohortPeerInsight[]   // only mutually-consenting peers
}

export async function getCohortInsightsForUser(userId: string): Promise<CohortInsightsGroup[]> {
  const supabase = createServiceClient()

  const { data: myCohortRows, error } = await supabase
    .from('cohort_memberships')
    .select('cohort_id, cohorts(id, name, institution_id)')
    .eq('user_id', userId)

  if (error) {
    console.error('[cohort-insights] failed to load user cohorts:', error.message)
    return []
  }
  if (!myCohortRows?.length) return []

  const results: CohortInsightsGroup[] = []

  for (const row of myCohortRows) {
    const cohort = Array.isArray(row.cohorts) ? row.cohorts[0] : row.cohorts
    if (!cohort) continue

    // I only see anything about a cohort if I currently consent myself.
    const { data: myMembership } = await supabase
      .from('institution_memberships')
      .select('consent_shared_cohort')
      .eq('institution_id', cohort.institution_id)
      .eq('user_id', userId)
      .maybeSingle()

    if (!myMembership?.consent_shared_cohort) continue

    const { data: peerRows } = await supabase
      .from('cohort_memberships')
      .select('user_id')
      .eq('cohort_id', cohort.id)
      .neq('user_id', userId)

    if (!peerRows?.length) continue

    const peerIds = peerRows.map(p => p.user_id)

    // Only peers who ALSO currently consent, in this same institution.
    const { data: consentingPeers } = await supabase
      .from('institution_memberships')
      .select('user_id')
      .eq('institution_id', cohort.institution_id)
      .in('user_id', peerIds)
      .eq('consent_shared_cohort', true)

    const consentingPeerIds = (consentingPeers ?? []).map(p => p.user_id)
    if (!consentingPeerIds.length) continue

    // One batch lookup for this cohort's whole consenting-peer set, instead
    // of one auth.admin.getUserById() call per peer inside buildPeerInsight.
    const emailByUserId = new Map<string, string>()
    const { data: emailRows, error: emailError } = await supabase
      .rpc('get_user_emails', { p_user_ids: consentingPeerIds })
    if (emailError) {
      console.error('[cohort-insights] get_user_emails failed:', emailError.message)
    } else {
      for (const row of (emailRows ?? []) as { user_id: string; email: string | null }[]) {
        if (row.email) emailByUserId.set(row.user_id, row.email)
      }
    }

    const peers = await Promise.all(
      consentingPeerIds.map(peerId =>
        buildPeerInsight(peerId, emailByUserId.get(peerId) ?? null, supabase)),
    )

    results.push({
      cohortId:      cohort.id,
      cohortName:    cohort.name,
      institutionId: cohort.institution_id,
      peers,
    })
  }

  return results
}

async function buildPeerInsight(
  peerId: string, email: string | null, supabase: ServiceClient,
): Promise<CohortPeerInsight> {
  const [independence, calibrationDeltaAvg, biasParameters] = await Promise.all([
    calculateIndependenceScore(peerId).catch(() => null),
    averageCalibrationDelta(peerId, supabase),
    email ? fetchBiasParameterLabels(email, supabase) : Promise.resolve([]),
  ])

  return {
    userId:              peerId,
    email,
    sessionScore:        independence?.score ?? null,
    sessionScoreDelta:   independence?.delta ?? null,
    calibrationDeltaAvg,
    biasParameters,
  }
}

// calibration_delta = retrospective_confidence − pre_decision_confidence,
// averaged across a user's completed sessions with a logged outcome. This
// deliberately re-derives the average independently of
// lib/bias-scorer.ts's private fetchCalibrationContext() rather than
// exporting and reusing that function, to avoid touching an existing,
// already-tested file for this addition — same average, computed
// separately. Worth de-duplicating later if the two definitions ever need
// to change together.
async function averageCalibrationDelta(userId: string, supabase: ServiceClient): Promise<number | null> {
  const { data: sessions } = await supabase
    .from('sessions')
    .select('id, outcomes(calibration_delta)')
    .eq('user_id', userId)
    .eq('status', 'completed')

  const deltas: number[] = []
  for (const s of sessions ?? []) {
    const outcome = Array.isArray(s.outcomes) ? s.outcomes[0] : s.outcomes
    if (typeof outcome?.calibration_delta === 'number') deltas.push(outcome.calibration_delta)
  }

  if (!deltas.length) return null
  const avg = deltas.reduce((sum, d) => sum + d, 0) / deltas.length
  return Math.round(avg * 100) / 100
}

// bias_parameter labels only — never confidence_weight, detection_count,
// asymmetry_score_avg, or activation_contexts (see lib/cohort-sharing-fields.ts
// for why activation_contexts specifically is excluded).
async function fetchBiasParameterLabels(email: string, supabase: ServiceClient): Promise<string[]> {
  const { data } = await supabase
    .from('bias_library')
    .select('bias_parameter')
    .eq('user_email', email)

  // Explicit intermediate string[] is required here, not stylistic: TS infers
  // Set<unknown> (not Set<string>) from new Set(x) when x's element type is
  // bare `any`, which .select() results are without generated DB types — the
  // spread then fails to assign to the string[] return type. Confirmed via
  // isolated repro before landing this fix.
  const labels: string[] = (data ?? []).map((d: { bias_parameter: string }) => d.bias_parameter)
  return [...new Set(labels)]
}

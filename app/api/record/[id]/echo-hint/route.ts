// app/api/record/[id]/echo-hint/route.ts
// Sprint: Item C — early structural dimension hint (session 3+)
//
// PURPOSE
// Gives EarlyEchoCard a named structural dimension instead of a bare session
// count, starting at session 3 — without touching the MIN_SESSIONS=5 gate
// that protects Council injection quality.
//
// WHY THIS IS SAFE — reads only, no shared state with the real retrieval path:
//   - Calls scoreStructuralSimilarity() directly — the same PURE, synchronous
//     scoring function used by lib/structural-retrieval.ts, but bypasses
//     retrieveStructuralMatches() entirely, so the MIN_SESSIONS gate inside
//     that function is never touched or weakened.
//   - Does NOT call annotateMatch() — no LLM call, no narrative generation.
//     The Council's structural-echo narrative injection remains exclusively
//     gated at MIN_SESSIONS (lib/structural-retrieval.ts:500), unchanged.
//   - Does NOT write to structural_matches or structural_scores — those
//     tables remain the exclusive output of /api/structural-match, called
//     from SessionView during the live session. This route never caches,
//     never upserts, and never competes with that write path.
//   - Returns only an abstracted dimension label (e.g. "stakes magnitude")
//     and a coarse month/year — never the other session's decision text.
//     Per copy discipline: "what the system produces" is abstracted, "how
//     it does it" (scores, thresholds) is never exposed.
//
// GATING
//   - Same identity requirement as /api/structural-match (user_id or
//     user_email on the session) — anonymous/device-only sessions get no
//     hint, which is intentional: it gives EmailCaptureCard a second,
//     concrete reason to link ("unlock comparison across decisions").
//   - Same MATCH_THRESHOLD env var (default 45) as the real retrieval path,
//     so a "hint" is never shown for a weak/coincidental match.
//   - If nothing qualifies, returns { available: false } and the caller
//     (EarlyEchoCard) silently falls back to its existing count-only copy.

import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import {
  scoreStructuralSimilarity,
  DIM_LABELS,
  type OntologySnapshot,
  type VectorDimName,
} from '@/lib/structural-retrieval'
import { decrypt } from '@/lib/encryption'

interface Params {
  params: Promise<{ id: string }>
}

// Friendlier short labels for UI display only — DIM_LABELS itself stays
// untouched since it's shared with Council prompt injection and calibration.
const SHORT_DIM_LABEL: Partial<Record<VectorDimName, string>> = {
  upstream_dependency: 'an unresolved prior decision',
  identity_alignment:  'who you want to be, not just what to do',
  regret_asymmetry:    'an asymmetric-regret structure',
  decision_unit:       'the number of people who need to align',
}

function uiDimLabel(dim: VectorDimName): string {
  return SHORT_DIM_LABEL[dim] ?? DIM_LABELS[dim]
}

export async function GET(req: Request, { params }: Params) {
  try {
    const { id: sessionId } = await params
    const supabase = createServiceClient()

    // ── 1. Current session identity + decision text ─────────────────────────
    const { data: currentSession } = await supabase
      .from('sessions')
      .select('decision_text, created_at, user_email, user_id')
      .eq('id', sessionId)
      .single()

    if (!currentSession) {
      return NextResponse.json({ available: false })
    }

    const userEmail = currentSession.user_email ?? null
    const userId    = currentSession.user_id    ?? null

    // No identity → no past-session retrieval possible (mirrors structural-match).
    // Also no server-side count is possible here — device-local count is the
    // only thing that exists for an anonymous session, which is correct: it
    // really does only span this one device.
    if (!userEmail && !userId) {
      return NextResponse.json({ available: false, reason: 'no_identity' })
    }

    // ── Bug fix (cross-device count mismatch) ────────────────────────────────
    // EarlyEchoCard's headline ("Second decision recorded...") is driven by
    // device-local session count (localStorage), which is correct for an
    // anonymous user but silently wrong for an identified one: a user with
    // 200+ decisions on their account who opens Quorum on a brand-new device
    // has an empty localStorage, so the local count reads 1-2 and the
    // "3 more to activate pattern memory" milestone re-fires even though
    // pattern memory has been active on their account for a long time.
    // Fix: once we know who the user is, get the TRUE total from the
    // database — a cheap head-only count, not the capped 20-row match list
    // below — and let the client override/hide the local-count message
    // whenever the two disagree. This mirrors the same "server truth wins"
    // pattern MemoryEngineStatus already uses for mirrorUnlocked.
    let trueSessionCount: number | null = null
    try {
      let countQuery = supabase.from('sessions').select('id', { count: 'exact', head: true })
      countQuery = userId && userEmail
        ? countQuery.or(`user_id.eq.${userId},user_email.eq.${userEmail}`)
        : userId
          ? countQuery.eq('user_id', userId)
          : countQuery.eq('user_email', userEmail as string)
      const { count } = await countQuery
      trueSessionCount = typeof count === 'number' ? count : null
    } catch (err) {
      console.warn('[EchoHint] True session count query failed (non-fatal):', err)
    }

    // ── 2. Current session's ontology (must be tagged + complete) ───────────
    const { data: currentOntology } = await supabase
      .from('sessions_ontology')
      .select(`
        session_id, decision_type_primary, decision_type_secondary,
        stakes_reversibility, stakes_bearer, stakes_timeline,
        has_stated_deadline, deadline_source, deadline_credibility,
        counterparty_present, counterparty_alignment, relationship_type,
        instrumental_weight, constitutive_weight, dominant_emotion,
        tagger_status, tagger_version, ontology_vector
      `)
      .eq('session_id', sessionId)
      .eq('tagger_status', 'complete')
      .maybeSingle()

    if (!currentOntology) {
      return NextResponse.json({ available: false, reason: 'ontology_not_ready', trueSessionCount })
    }

    // ── 3. Past sessions (same user, complete ontology) — small cap, cheap ──
    let pastQuery = supabase
      .from('sessions_ontology')
      .select(`
        session_id, decision_type_primary, decision_type_secondary,
        stakes_reversibility, stakes_bearer, stakes_timeline,
        has_stated_deadline, deadline_source, deadline_credibility,
        counterparty_present, counterparty_alignment, relationship_type,
        instrumental_weight, constitutive_weight, dominant_emotion,
        tagger_version, ontology_vector,
        sessions!inner ( id, created_at, user_email, user_id )
      `)
      .eq('tagger_status', 'complete')
      .neq('session_id', sessionId)

    if (userId && userEmail) {
      pastQuery = pastQuery.or(`user_id.eq.${userId},user_email.eq.${userEmail}`, { foreignTable: 'sessions' })
    } else if (userId) {
      pastQuery = pastQuery.eq('sessions.user_id', userId)
    } else if (userEmail) {
      pastQuery = pastQuery.eq('sessions.user_email', userEmail)
    }

    const { data: pastOntologies } = await pastQuery
      .order('created_at', { ascending: false })
      .limit(20)

    if (!pastOntologies || pastOntologies.length === 0) {
      return NextResponse.json({ available: false, reason: 'no_past_sessions', trueSessionCount })
    }

    // ── 4. Build snapshots + score (pure, synchronous, no LLM) ──────────────
    const currentSnapshot: OntologySnapshot = {
      session_id:              sessionId,
      decision_text:           decrypt(currentSession.decision_text) ?? '',
      created_at:              currentSession.created_at,
      decision_type_primary:   currentOntology.decision_type_primary ?? '',
      decision_type_secondary: currentOntology.decision_type_secondary ?? [],
      stakes_reversibility:    currentOntology.stakes_reversibility ?? '',
      stakes_bearer:           currentOntology.stakes_bearer ?? '',
      stakes_timeline:         currentOntology.stakes_timeline ?? '',
      has_stated_deadline:     currentOntology.has_stated_deadline ?? false,
      deadline_source:         currentOntology.deadline_source ?? '',
      deadline_credibility:    currentOntology.deadline_credibility ?? '',
      counterparty_present:    currentOntology.counterparty_present ?? false,
      counterparty_alignment:  currentOntology.counterparty_alignment ?? '',
      relationship_type:       currentOntology.relationship_type ?? '',
      instrumental_weight:     Number(currentOntology.instrumental_weight ?? 0.5),
      constitutive_weight:     Number(currentOntology.constitutive_weight ?? 0.5),
      dominant_emotion:        currentOntology.dominant_emotion ?? '',
      tagger_version:          currentOntology.tagger_version ?? 'v1.0',
      ontology_vector:         currentOntology.ontology_vector ?? null,
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pastSnapshots: OntologySnapshot[] = (pastOntologies as any[]).map(o => ({
      session_id:              o.session_id,
      decision_text:           '', // not needed — never returned to client
      created_at:              o.sessions?.created_at ?? '',
      decision_type_primary:   o.decision_type_primary ?? '',
      decision_type_secondary: o.decision_type_secondary ?? [],
      stakes_reversibility:    o.stakes_reversibility ?? '',
      stakes_bearer:           o.stakes_bearer ?? '',
      stakes_timeline:         o.stakes_timeline ?? '',
      has_stated_deadline:     o.has_stated_deadline ?? false,
      deadline_source:         o.deadline_source ?? '',
      deadline_credibility:    o.deadline_credibility ?? '',
      counterparty_present:    o.counterparty_present ?? false,
      counterparty_alignment:  o.counterparty_alignment ?? '',
      relationship_type:       o.relationship_type ?? '',
      instrumental_weight:     Number(o.instrumental_weight ?? 0.5),
      constitutive_weight:     Number(o.constitutive_weight ?? 0.5),
      dominant_emotion:        o.dominant_emotion ?? '',
      tagger_version:          o.tagger_version ?? 'v1.0',
      ontology_vector:         o.ontology_vector ?? null,
    }))

    const MATCH_THRESHOLD = Number(process.env.MATCH_THRESHOLD ?? '45')

    const best = pastSnapshots
      .map(past => ({ past, breakdown: scoreStructuralSimilarity(currentSnapshot, past) }))
      .sort((a, b) => b.breakdown.total - a.breakdown.total)[0]

    if (!best || best.breakdown.total < MATCH_THRESHOLD) {
      return NextResponse.json({ available: false, reason: 'no_qualifying_match', trueSessionCount })
    }

    // ── 5. Extract a single, abstracted dimension label ──────────────────────
    let dimensionLabel: string
    if (best.breakdown.scoring_mode === 'vector' && best.breakdown.top_matching_dims?.length) {
      dimensionLabel = uiDimLabel(best.breakdown.top_matching_dims[0] as VectorDimName)
    } else {
      // Categorical fallback — decision_type was the strongest contributor
      dimensionLabel = currentSnapshot.decision_type_primary
        ? `its ${currentSnapshot.decision_type_primary.replace(/_/g, ' ')} structure`
        : 'its overall shape'
    }

    const matchDate = best.past.created_at
      ? new Date(best.past.created_at).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
      : null

    return NextResponse.json({
      available:      true,
      dimensionLabel,
      matchDate,
      trueSessionCount,
    })

  } catch (err) {
    console.error('[EchoHint] Route error:', err)
    // Fail silent — caller falls back to count-only copy
    return NextResponse.json({ available: false, reason: 'error' })
  }
}

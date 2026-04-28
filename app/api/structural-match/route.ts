// app/api/structural-match/route.ts
// ── Sprint 5: Structural Match Endpoint ──────────────────────────────────────
//
// Called client-side on session page load, immediately after all 6 personas
// begin streaming. Runs in parallel — never blocks the persona streams.
//
// Flow:
//   1. Receive current sessionId + userEmail/userId
//   2. Fetch current session's ontology tag
//   3. Fetch all past sessions' ontology tags for this user (excluding current)
//   4. Run structural scoring + annotation
//   5. Cache result in structural_matches table
//   6. Return context_block to client
//
// The client injects context_block into Pattern Analyst, Risk Architect,
// and Elder persona prompts before their first message fires.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import {
  retrieveStructuralMatches,
  type OntologySnapshot,
} from '@/lib/structural-retrieval'

export async function POST(req: Request) {
  try {
    const { sessionId, userEmail, userId } = await req.json() as {
      sessionId: string
      userEmail?: string
      userId?: string
    }

    if (!sessionId) {
      return NextResponse.json({ error: 'sessionId required' }, { status: 400 })
    }

    const supabase = createServiceClient()

    // ── 1. Check cache first ────────────────────────────────────
    const { data: cached } = await supabase
      .from('structural_matches')
      .select('context_block, matches_json, session_count_used, threshold_met')
      .eq('session_id', sessionId)
      .single()

    if (cached) {
      console.log(`[StructuralMatch] Cache hit for session ${sessionId}`)
      return NextResponse.json({
        context_block:       cached.context_block,
        matches:             cached.matches_json,
        session_count_used:  cached.session_count_used,
        threshold_met:       cached.threshold_met,
        from_cache:          true,
      })
    }

    // ── 2. Fetch current session's ontology tag ─────────────────
    const { data: currentOntology, error: ontologyErr } = await supabase
      .from('sessions_ontology')
      .select(`
        session_id,
        decision_type_primary,
        decision_type_secondary,
        stakes_reversibility,
        stakes_bearer,
        stakes_timeline,
        has_stated_deadline,
        deadline_source,
        deadline_credibility,
        counterparty_present,
        counterparty_alignment,
        relationship_type,
        instrumental_weight,
        constitutive_weight,
        dominant_emotion,
        tagger_status
      `)
      .eq('session_id', sessionId)
      .eq('tagger_status', 'complete')
      .single()

    if (ontologyErr || !currentOntology) {
      console.log(`[StructuralMatch] No complete ontology for session ${sessionId} — tagger may still be running`)
      return NextResponse.json({ context_block: '', matches: [], threshold_met: false, session_count_used: 0 })
    }

    // ── 3. Fetch current session text ───────────────────────────
    const { data: currentSession } = await supabase
      .from('sessions')
      .select('decision_text, created_at')
      .eq('id', sessionId)
      .single()

    if (!currentSession) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }

    // ── 4. Build user filter — email OR userId ──────────────────
    // Pre-auth: match by user_email
    // Post-auth: match by user_id (more reliable)
    // No identity at all: no historical context available
    if (!userEmail && !userId) {
      console.log(`[StructuralMatch] No user identity — cannot retrieve past sessions`)
      return NextResponse.json({ context_block: '', matches: [], threshold_met: false, session_count_used: 0 })
    }

    // ── 5. Fetch past sessions (same user, complete ontology, excluding current) ─
    let pastQuery = supabase
      .from('sessions_ontology')
      .select(`
        session_id,
        decision_type_primary,
        decision_type_secondary,
        stakes_reversibility,
        stakes_bearer,
        stakes_timeline,
        has_stated_deadline,
        deadline_source,
        deadline_credibility,
        counterparty_present,
        counterparty_alignment,
        relationship_type,
        instrumental_weight,
        constitutive_weight,
        dominant_emotion,
        tagger_status,
        sessions!inner (
          id,
          decision_text,
          created_at,
          user_email,
          user_id
        )
      `)
      .eq('tagger_status', 'complete')
      .neq('session_id', sessionId)

    // Build OR filter for user identity
    if (userId && userEmail) {
      pastQuery = pastQuery.or(`user_id.eq.${userId},user_email.eq.${userEmail}`, { foreignTable: 'sessions' })
    } else if (userId) {
      pastQuery = pastQuery.eq('sessions.user_id', userId)
    } else if (userEmail) {
      pastQuery = pastQuery.eq('sessions.user_email', userEmail)
    }

    const { data: pastOntologies, error: pastErr } = await pastQuery
      .order('created_at', { ascending: false })
      .limit(50) // cap at 50 past sessions — enough signal without overloading

    if (pastErr) {
      console.error('[StructuralMatch] Past sessions query failed:', pastErr)
      return NextResponse.json({ context_block: '', matches: [], threshold_met: false, session_count_used: 0 })
    }

    // ── 6. Fetch outcomes for past sessions ─────────────────────
    const pastSessionIds = (pastOntologies ?? []).map(o => o.session_id)
    let outcomesMap: Record<string, { what_decided: string; council_helped: string } | null> = {}

    if (pastSessionIds.length > 0) {
      const { data: outcomes } = await supabase
        .from('session_outcomes')
        .select('session_id, what_decided, council_helped')
        .in('session_id', pastSessionIds)

      outcomesMap = Object.fromEntries(
        (outcomes ?? []).map(o => [o.session_id, { what_decided: o.what_decided, council_helped: o.council_helped }])
      )
    }

    // ── 7. Build OntologySnapshot objects ───────────────────────
    const currentSnapshot: OntologySnapshot = {
      session_id:              sessionId,
      decision_text:           currentSession.decision_text,
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
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pastSnapshots: OntologySnapshot[] = (pastOntologies ?? []).map((o: any) => ({
      session_id:              o.session_id,
      decision_text:           o.sessions?.decision_text ?? '',
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
      outcome:                 outcomesMap[o.session_id] ?? null,
    }))

    console.log(`[StructuralMatch] Scoring session ${sessionId} against ${pastSnapshots.length} past sessions`)

    // ── 8. Run retrieval ─────────────────────────────────────────
    const result = await retrieveStructuralMatches(currentSnapshot, pastSnapshots)

    // ── 9. Cache result ──────────────────────────────────────────
    await supabase
      .from('structural_matches')
      .upsert({
        session_id:          sessionId,
        user_email:          userEmail ?? null,
        user_id:             userId ?? null,
        context_block:       result.context_block,
        matches_json:        result.matches,
        session_count_used:  result.session_count_used,
        threshold_met:       result.threshold_met,
        computed_at:         new Date().toISOString(),
      }, { onConflict: 'session_id' })

    console.log(`[StructuralMatch] Done — ${result.matches.length} matches, threshold_met: ${result.threshold_met}`)

    return NextResponse.json({
      context_block:      result.context_block,
      matches:            result.matches,
      session_count_used: result.session_count_used,
      threshold_met:      result.threshold_met,
      from_cache:         false,
    })

  } catch (err) {
    console.error('[StructuralMatch] Route error:', err)
    return NextResponse.json({ error: 'Internal server error', detail: String(err) }, { status: 500 })
  }
}

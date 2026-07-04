// app/api/structural-match/route.ts
// Sprint 5: Structural Match Endpoint
//
// FIXES (April 29):
//   1. Reads user_email / user_id from sessions table — no longer requires
//      client to pass identity. Client-side call was sending no identity,
//      causing the past-sessions guard to fire and return empty every time.
//   2. Returns { ontology_ready: false } when current session ontology is not
//      yet complete, so the client can retry intelligently.
//   3. Writes individual pairwise scores into structural_scores table for
//      traceability (was previously empty).
//
// Bug fix (STRUCT-1): this route was only ever reached via a client-side
// fire-and-forget call (SessionView.tsx), retrying up to 4x/6s (24s) only
// while ontology wasn't ready yet — and it only writes structural_matches on
// full success, with nothing to retry a session that timed out or whose tab
// was closed early. That left structural_matches permanently unpopulated for
// any session where tagging took longer than the client's patience. Fixed by
// chaining this route server-side from app/api/ontology/route.ts's
// fireStructuralMatch(), fired immediately once tagger_status flips to
// 'complete' — the client-side call above remains as a redundant fallback
// (this route's own cache check at Step 1 makes a duplicate call a cheap
// no-op either way).

import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import {
  retrieveStructuralMatches,
  scoreStructuralSimilarity,
  type OntologySnapshot,
} from '@/lib/structural-retrieval'
import { encrypt, decrypt, encryptJson, decryptJson } from '@/lib/encryption'
import { upsertStructuralEdge } from '@/lib/graph-engine'  // Sprint G1: live graph edge writes

// ── RET-5 Sprint 1: lineage exclusion ────────────────────────────────────────
// A revisit's own parent (or any ancestor/descendant in its chain) is not a
// cross-decision "structural pattern" — it's the same decision restated. Left
// unfiltered, a revisit would self-match its origin at a near-perfect score,
// which is noise, not signal. Bounded to 20 hops each direction — far more
// than any realistic revisit chain, just a guard against runaway queries.
async function fetchSessionLineage(
  supabase: ReturnType<typeof createServiceClient>,
  sessionId: string,
  parentSessionId: string | null,
): Promise<Set<string>> {
  const lineage = new Set<string>()

  // Ancestors — walk up via parent_session_id
  let cursor = parentSessionId
  let hops = 0
  while (cursor && hops < 20) {
    lineage.add(cursor)
    const { data } = await supabase.from('sessions').select('parent_session_id').eq('id', cursor).single()
    cursor = data?.parent_session_id ?? null
    hops++
  }

  // Descendants — walk down via reverse lookup, breadth-first
  let frontier = [sessionId]
  hops = 0
  while (frontier.length > 0 && hops < 20) {
    const { data } = await supabase.from('sessions').select('id').in('parent_session_id', frontier)
    const next = (data ?? []).map(r => r.id)
    next.forEach(id => lineage.add(id))
    frontier = next
    hops++
  }

  return lineage
}

export async function POST(req: Request) {
  try {
    const body = await req.json() as {
      sessionId: string
      userEmail?: string
      userId?: string
    }
    const { sessionId } = body

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
      // Fast single-row read for grid reorder signals (not stored in structural_matches)
      const { data: cachedSignals } = await supabase
        .from('sessions_ontology')
        .select('rule_engine_result, ontology_vector, decision_type_primary, stakes_reversibility')
        .eq('session_id', sessionId)
        .maybeSingle()
      return NextResponse.json({
        context_block:      decrypt(cached.context_block),
        matches:            decryptJson(cached.matches_json),
        session_count_used: cached.session_count_used,
        threshold_met:      cached.threshold_met,
        from_cache:         true,
        ontology_ready:     true,
        rule_engine_result: cachedSignals?.rule_engine_result ?? null,
        ontology_vector:    cachedSignals?.ontology_vector    ?? null,
        decision_type_primary:  cachedSignals?.decision_type_primary  ?? null,
        stakes_reversibility:   cachedSignals?.stakes_reversibility   ?? null,
        best_match_date:    null,  // not stored in structural_matches — acceptable for cache hits
      })
    }

    // ── 2. Fetch current session + identity from DB ─────────────
    // Read identity from the sessions table — do not trust client-passed values
    // because the client-side call in SessionView never passed them anyway.
    const { data: currentSession } = await supabase
      .from('sessions')
      .select('decision_text, created_at, user_email, user_id, parent_session_id')
      .eq('id', sessionId)
      .single()

    if (!currentSession) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }

    const userEmail = currentSession.user_email ?? null
    const userId    = currentSession.user_id    ?? null

    // ── 3. Fetch current session's ontology tag ─────────────────
    const { data: currentOntology } = await supabase
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
        tagger_version,
        ontology_vector,
        rule_engine_result
      `)
      .eq('session_id', sessionId)
      .eq('tagger_status', 'complete')
      .single()

    if (!currentOntology) {
      // Ontology not ready yet — tell client to retry
      console.log(`[StructuralMatch] Ontology not complete for session ${sessionId} — client should retry`)
      return NextResponse.json({
        context_block:      '',
        matches:            [],
        threshold_met:      false,
        session_count_used: 0,
        ontology_ready:     false,
      })
    }

    // ── 4. Guard: need user identity to retrieve past sessions ──
    if (!userEmail && !userId) {
      console.log(`[StructuralMatch] No user identity on session ${sessionId} — skipping past session retrieval`)
      return NextResponse.json({
        context_block: '', matches: [], threshold_met: false,
        session_count_used: 0, ontology_ready: true,
        rule_engine_result: currentOntology.rule_engine_result ?? null,
        ontology_vector:    currentOntology.ontology_vector    ?? null,
        decision_type_primary:  currentOntology.decision_type_primary  ?? null,
        stakes_reversibility:   currentOntology.stakes_reversibility   ?? null,
      })
    }

    // ── 5. Fetch past sessions (same user, complete ontology) ───
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
        tagger_version,
        ontology_vector,
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

    if (userId && userEmail) {
      pastQuery = pastQuery.or(`user_id.eq.${userId},user_email.eq.${userEmail}`, { foreignTable: 'sessions' })
    } else if (userId) {
      pastQuery = pastQuery.eq('sessions.user_id', userId)
    } else if (userEmail) {
      pastQuery = pastQuery.eq('sessions.user_email', userEmail)
    }

    const { data: pastOntologiesRaw, error: pastErr } = await pastQuery
      .order('created_at', { ascending: false })
      .limit(50)

    if (pastErr) {
      console.error('[StructuralMatch] Past sessions query failed:', pastErr)
      return NextResponse.json({ context_block: '', matches: [], threshold_met: false, session_count_used: 0, ontology_ready: true })
    }

    // ── RET-5 Sprint 1: exclude same-lineage sessions from candidates ───────
    const lineageIds = await fetchSessionLineage(supabase, sessionId, currentSession.parent_session_id ?? null)
    const pastOntologies = (pastOntologiesRaw ?? []).filter(o => !lineageIds.has(o.session_id))
    if (lineageIds.size > 0) {
      console.log(`[StructuralMatch] Excluded ${(pastOntologiesRaw ?? []).length - pastOntologies.length} same-lineage session(s) from candidates`)
    }

    const pastCount = (pastOntologies ?? []).length
    console.log(`[StructuralMatch] Scoring session ${sessionId} against ${pastCount} past sessions`)

    // ── 6. Fetch outcomes for past sessions ─────────────────────
    const pastSessionIds = (pastOntologies ?? []).map((o: { session_id: string }) => o.session_id)
    let outcomesMap: Record<string, { what_decided: string; council_helped: string } | null> = {}

    if (pastSessionIds.length > 0) {
      const { data: outcomes } = await supabase
        .from('outcomes')
        .select('session_id, what_decided, council_helped')
        .in('session_id', pastSessionIds)

      outcomesMap = Object.fromEntries(
        (outcomes ?? []).map(o => [o.session_id, {
          what_decided:   decrypt(o.what_decided) ?? '',
          council_helped: o.council_helped,
        }])
      )
    }

    // ── 7. Build snapshots ──────────────────────────────────────
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
    const pastSnapshots: OntologySnapshot[] = (pastOntologies ?? []).map((o: any) => ({
      session_id:              o.session_id,
      decision_text:           decrypt(o.sessions?.decision_text) ?? '',
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
      outcome:                 outcomesMap[o.session_id] ?? null,
    }))

    // ── 8. Write pairwise scores into structural_scores + graph_edges ──────
    // structural_scores: traceability table, all pairs regardless of threshold.
    // graph_edges (Sprint G1): only qualifying pairs (total >= MATCH_THRESHOLD),
    //   with dimension_breakdown for explainability. Writes are additive and
    //   never block the route response — errors are caught and logged only.
    // SCHEMA NOTE: structural_scores has no threshold_met column — dropped.
    //   threshold_met is derivable as (total_score >= 45) from stored data.
    //   user_email is stored for per-user traceability queries.
    if (pastSnapshots.length > 0) {
      const MATCH_THRESHOLD = Number(process.env.MATCH_THRESHOLD ?? 45)
      const scoreRows: Record<string, unknown>[] = []
      const graphEdgePromises: Promise<void>[] = []

      for (const past of pastSnapshots) {
        const breakdown = scoreStructuralSimilarity(currentSnapshot, past)

        scoreRows.push({
          session_id_a:         sessionId,
          session_id_b:         past.session_id,
          user_email:           userEmail ?? null,  // for traceability queries
          total_score:          breakdown.total,
          decision_type_score:  breakdown.decision_type,
          register_score:       breakdown.register,
          stakes_score:         breakdown.stakes,
          counterparty_score:   breakdown.counterparty,
          time_pressure_score:  breakdown.time_pressure,
          scoring_mode:         breakdown.scoring_mode,
          vector_similarity:    breakdown.vector_similarity ?? null,
          computed_at:          new Date().toISOString(),
        })

        // Sprint G1: materialise qualifying pairs as graph edges live.
        // userId may be null for pre-auth / device-id-only sessions — skip those
        // (graph is strictly per authenticated user, same gate as bias scoring).
        if (userId && breakdown.total >= MATCH_THRESHOLD) {
          graphEdgePromises.push(
            upsertStructuralEdge(supabase, userId, sessionId, past.session_id, breakdown)
          )
        }
      }

      // Insert structural_scores in batches of 20 to avoid payload limits
      for (let i = 0; i < scoreRows.length; i += 20) {
        const batch = scoreRows.slice(i, i + 20)
        const { error: scoresErr } = await supabase
          .from('structural_scores')
          .upsert(batch, { onConflict: 'session_id_a,session_id_b' })

        if (scoresErr) {
          // Most common cause: table missing or unique constraint not created.
          // Fix: run supabase/sprint5b_structural_scores_fix.sql in Supabase SQL Editor.
          console.error('[StructuralMatch] structural_scores upsert FAILED:', scoresErr.message, '| code:', scoresErr.code)
        } else {
          console.log(`[StructuralMatch] Wrote ${batch.length} rows to structural_scores`)
        }
      }

      // Sprint G1: write graph edges — awaited inside the background route,
      // never delays the route's own NextResponse (structural-match itself is
      // called fire-and-forget from the client after Council completes).
      if (graphEdgePromises.length > 0) {
        await Promise.all(graphEdgePromises).catch(err => {
          console.error('[StructuralMatch] Graph edge writes partially failed (non-blocking):', err)
        })
        console.log(`[StructuralMatch] Wrote ${graphEdgePromises.length} graph edge(s)`)
      }
    }

    // ── 9. Run retrieval (annotation + context block) ───────────
    const result = await retrieveStructuralMatches(currentSnapshot, pastSnapshots)

    // ── 10. Cache result in structural_matches ──────────────────
    await supabase
      .from('structural_matches')
      .upsert({
        session_id:          sessionId,
        user_email:          userEmail ?? null,
        user_id:             userId    ?? null,
        context_block:       encrypt(result.context_block),
        matches_json:        encryptJson(result.matches),
        session_count_used:  result.session_count_used,
        threshold_met:       result.threshold_met,
        computed_at:         new Date().toISOString(),
      }, { onConflict: 'session_id' })

    console.log(`[StructuralMatch] Done — ${result.matches.length} matches, threshold_met: ${result.threshold_met}, sessions_scored: ${pastCount}`)

    return NextResponse.json({
      context_block:      result.context_block,
      matches:            result.matches,
      session_count_used: result.session_count_used,
      threshold_met:      result.threshold_met,
      from_cache:         false,
      ontology_ready:     true,
      rule_engine_result: currentOntology.rule_engine_result ?? null,
      ontology_vector:    currentOntology.ontology_vector    ?? null,
      decision_type_primary:  currentOntology.decision_type_primary  ?? null,
      stakes_reversibility:   currentOntology.stakes_reversibility   ?? null,
      best_match_date:    result.threshold_met && result.matches.length > 0
        ? result.matches[0].created_at
        : null,
      // (d) — every surfaced insight needs an attached action. S1-07's structural echo
      // banner was purely informational ("Pattern Analyst is drawing on a decision you
      // brought in March 2025") with nothing to click. This exposes the matched session's
      // id so the banner can link straight to that past decision's record page.
      best_match_session_id: result.threshold_met && result.matches.length > 0
        ? result.matches[0].session_id
        : null,
    })

  } catch (err) {
    console.error('[StructuralMatch] Route error:', err)
    return NextResponse.json({ error: 'Internal server error', detail: String(err) }, { status: 500 })
  }
}
/**
 * QUORUM — Ontology Tagger API Route
 * Sprint 11a — v2.0 (14-dim scored vector + rule engine)
 *
 * CHANGES FROM v1.0:
 *   - tagToInsert now includes `ontology_vector` (scored_vector as JSONB)
 *     and `rule_engine_result` (deterministic R1–R5 evaluation)
 *   - tagger_version written as 'v2.0' for all new sessions
 *   - validateTag now also checks scored_vector presence
 *   - All existing columns still written identically (backward compat)
 *
 * POST /api/ontology  — internal, called after session creation
 * GET  /api/ontology?sessionId=xxx — debug/examiner reads
 */

import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { tagDecision } from '@/lib/ontology-tagger'
import { evaluateRules } from '@/lib/rule-engine'
import type { OntologyTag } from '@/lib/ontology-tagger'

// ── Validation ─────────────────────────────────────────────────────────────────

function validateTag(tag: OntologyTag): boolean {
  const validTypes = [
    'commitment', 'allocation', 'transition',
    'acquisition', 'renunciation', 'governance', 'delegation',
  ]
  if (!validTypes.includes(tag.decision_type_primary)) return false
  if (typeof tag.instrumental_weight !== 'number')     return false
  if (typeof tag.constitutive_weight !== 'number')     return false
  if (!tag.examiner_gap_1 || !tag.examiner_gap_2 || !tag.examiner_gap_3) return false
  // v2.0: also require scored_vector
  if (!tag.scored_vector || typeof tag.scored_vector !== 'object')        return false
  if (typeof tag.scored_vector.upstream_dependency?.score !== 'number') return false
  if (typeof tag.scored_vector.identity_alignment?.score !== 'number')  return false
  if (typeof tag.scored_vector.regret_asymmetry?.score !== 'number')    return false
  return true
}

// ── DB insert shape ────────────────────────────────────────────────────────────

function tagToInsert(sessionId: string, tag: OntologyTag, ruleResult: ReturnType<typeof evaluateRules>) {
  return {
    // ── Existing categorical fields (v1.0, unchanged) ──────────────────────
    session_id:                     sessionId,
    decision_type_primary:          tag.decision_type_primary,
    decision_type_secondary:        tag.decision_type_secondary ?? [],
    stakes_reversibility:           tag.stakes_reversibility,
    stakes_bearer:                  tag.stakes_bearer,
    stakes_timeline:                tag.stakes_timeline,
    has_stated_deadline:            tag.has_stated_deadline,
    deadline_source:                tag.deadline_source,
    deadline_credibility:           tag.deadline_credibility,
    known_unknowns_surfaced:        tag.known_unknowns_surfaced,
    unknown_unknown_categories:     tag.unknown_unknown_categories ?? [],
    counterparty_present:           tag.counterparty_present,
    counterparty_alignment:         tag.counterparty_alignment,
    info_asymmetry:                 tag.info_asymmetry,
    relationship_type:              tag.relationship_type,
    dominant_emotion:               tag.dominant_emotion,
    emotion_source:                 tag.emotion_source,
    emotion_analysis_aligned:       tag.emotion_analysis_aligned,
    stakeholder_count:              tag.stakeholder_count,
    hidden_stakeholder_probability: tag.hidden_stakeholder_probability,
    instrumental_weight:            tag.instrumental_weight,
    constitutive_weight:            tag.constitutive_weight,
    examiner_gap_1:                 tag.examiner_gap_1,
    examiner_gap_2:                 tag.examiner_gap_2,
    examiner_gap_3:                 tag.examiner_gap_3,
    raw_ontology_json:              tag,         // full tag including scored_vector

    // ── New in v2.0 ────────────────────────────────────────────────────────
    ontology_vector:                tag.scored_vector,     // 14-dim scored JSONB
    rule_engine_result:             ruleResult,            // REDIRECT/GATE/OPEN + triggered rules

    // ── Metadata ───────────────────────────────────────────────────────────
    tagger_status:                  'complete',
    tagger_version:                 'v2.0',
  }
}

// ── POST handler ───────────────────────────────────────────────────────────────
//
// Bug fix (TAGGER-1): previously, two failure paths left sessions_ontology
// stuck at tagger_status:'pending' permanently — (a) the final upsert failing
// (DB error) and (b) any uncaught exception (e.g. an Anthropic API timeout/
// rate-limit/network error inside tagDecision(), which has no retry wrapper).
// A row stuck at 'pending' is a dead end: /api/examiner retries a fixed
// budget waiting for 'complete', never gets it, and silently skips — and on
// every future load of that same session, the exact same thing happens again,
// forever, since nothing ever re-fires the tagger. sessionId is now hoisted
// so both the try body and the catch block can reach it, and every failure
// path does a best-effort upsert to 'failed' — a real terminal state instead
// of a permanent hang.

export async function POST(req: Request) {
  // S5-03: internal route — only accessible from server-side fetch with INTERNAL_API_SECRET
  const internalSecret = process.env.INTERNAL_API_SECRET
  const incoming = req.headers.get('x-internal-secret')
  if (internalSecret && incoming !== internalSecret) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const supabase = createServiceClient()
  let sessionId: string | undefined

  try {
    
    const body = await req.json()
    
    sessionId = body.sessionId
    const decisionText: string | undefined = body.decisionText
    const contextText: string | null = body.contextText ?? null

    if (!sessionId || !decisionText) {
      return NextResponse.json(
        { error: 'sessionId and decisionText are required' },
        { status: 400 }
      )
    }

    // Mark pending immediately (prevents double-tag on retry)
    await supabase.from('sessions_ontology').upsert(
      { session_id: sessionId, tagger_status: 'pending' },
      { onConflict: 'session_id' }
    )

    // ── 1. Run 14-dim tagger ──────────────────────────────────────────────────
    const tag = await tagDecision(decisionText, contextText)

    if (!tag || !validateTag(tag)) {
      await supabase.from('sessions_ontology').upsert(
        { session_id: sessionId, tagger_status: 'failed' },
        { onConflict: 'session_id' }
      )
      console.error(`[Ontology] Tagging failed for session ${sessionId}`)
      return NextResponse.json({ ok: false, error: 'Tagging failed' }, { status: 500 })
    }

    // ── 2. Run rule engine (deterministic, no AI call) ────────────────────────
    const ruleResult = evaluateRules(tag.scored_vector)

    console.log(
      `[Ontology] Session ${sessionId} | ` +
      `type: ${tag.decision_type_primary} | ` +
      `mode: ${ruleResult.mode} | ` +
      `rules: ${ruleResult.triggered_rules.map(r => r.rule_id).join(',') || 'none'} | ` +
      `flags: ${ruleResult.flag_rules.map(r => r.rule_id).join(',') || 'none'} | ` +
      `identity: ${tag.scored_vector.identity_alignment.score} | ` +
      `regret: ${tag.scored_vector.regret_asymmetry.score} | ` +
      `upstream: ${tag.scored_vector.upstream_dependency.score}`
    )

    // ── 3. Persist everything ─────────────────────────────────────────────────
    const { error: upsertError } = await supabase
      .from('sessions_ontology')
      .upsert(tagToInsert(sessionId, tag, ruleResult), { onConflict: 'session_id' })

    if (upsertError) {
      console.error('[Ontology] Supabase upsert error:', upsertError)
      // TAGGER-1: don't leave this stuck at 'pending' — see note above.
      await supabase.from('sessions_ontology').upsert(
        { session_id: sessionId, tagger_status: 'failed' },
        { onConflict: 'session_id' }
      ).catch(() => {})
      return NextResponse.json({ ok: false, error: 'DB insert failed' }, { status: 500 })
    }

    return NextResponse.json({
      ok:          true,
      mode:        ruleResult.mode,
      rules_fired: ruleResult.triggered_rules.map(r => r.rule_id),
      flags_fired: ruleResult.flag_rules.map(r => r.rule_id),
    })

  } catch (err) {
    console.error('[Ontology] Route error:', err)
    // TAGGER-1: best-effort mark 'failed' so this session isn't stuck at
    // 'pending' forever. Guarded — sessionId may be undefined if req.json()
    // itself threw (malformed body), in which case no row was ever created
    // and there's nothing to recover.
    if (sessionId) {
      try {
        await supabase.from('sessions_ontology').upsert(
          { session_id: sessionId, tagger_status: 'failed' },
          { onConflict: 'session_id' }
        )
      } catch { /* best-effort only — don't let this mask the original error */ }
    }
    return NextResponse.json({ ok: false, error: 'Internal error' }, { status: 500 })
  }
}

// ── GET handler (debug + examiner reads) ──────────────────────────────────────

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const sessionId = searchParams.get('sessionId')

  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId required' }, { status: 400 })
  }

  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('sessions_ontology')
    .select('*')
    .eq('session_id', sessionId)
    .single()

  if (error) {
    return NextResponse.json({ tag: null, status: 'not_found' })
  }

  return NextResponse.json({ tag: data })
}

// ── PATCH handler — log user redirect override (Sprint 16b Fix 1) ─────────────
// Called when the user clicks "This doesn't apply — continue to Council" on
// an R1 REDIRECT. Writes user_overrode_redirect: true into raw_ontology_json
// so mis-fire frequency can be tracked without a schema migration.

export async function PATCH(req: Request) {
  try {
    const { sessionId } = await req.json()
    if (!sessionId) {
      return NextResponse.json({ error: 'sessionId required' }, { status: 400 })
    }

    const supabase = createServiceClient()

    // Fetch current raw_ontology_json, merge in override flag
    const { data: existing } = await supabase
      .from('sessions_ontology')
      .select('raw_ontology_json')
      .eq('session_id', sessionId)
      .single()

    const current = (existing?.raw_ontology_json as Record<string, unknown>) ?? {}
    const updated  = { ...current, user_overrode_redirect: true, user_overrode_redirect_at: new Date().toISOString() }

    const { error } = await supabase
      .from('sessions_ontology')
      .update({ raw_ontology_json: updated })
      .eq('session_id', sessionId)

    if (error) {
      console.error('[Ontology PATCH] Override log failed:', error)
      return NextResponse.json({ ok: false }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[Ontology PATCH] Error:', err)
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}

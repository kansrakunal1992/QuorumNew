/**
 * QUORUM — Examiner Route (Sprint 12 patch)
 *
 * WHAT CHANGED vs Sprint 12 delivery:
 *   - Removed inline triggerBiasScoring() — it called scoreBiasesForSession
 *     directly and tried to insert with wrong bias_library column names
 *     (bias_key, prosecutor_score, etc. don't exist; table uses bias_parameter,
 *     detection_count, asymmetry_score_avg etc. with accumulation logic)
 *   - Replaced with background HTTP call to /api/bias-score (the dedicated
 *     accumulation endpoint that handles identity resolution + correct schema)
 *   - Removed scoreBiasesForSession import (no longer needed here)
 *
 * GET handler — unchanged from Sprint 12 (contextual rule question personalisation)
 */

import { NextResponse }        from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { createCompletion }    from '@/lib/ai-client'

// ─────────────────────────────────────────────────────────────────────────────
// GET — serve Examiner questions (unchanged from Sprint 12)
// ─────────────────────────────────────────────────────────────────────────────

const PERSONALISE_PROMPT = (ruleId: string, template: string, decision: string) => `
You are the Quorum Examiner. Rewrite the diagnostic question below so it is specific to the decision described.

RULES:
- Keep the core intent identical — do not change what information is being sought
- Replace generic language with concrete details from the decision text (e.g. names, assets, amounts, relationships, domains) wherever they are present
- Maximum 28 words
- Return ONLY the rewritten question — no quotes, no explanation, no preamble

DECISION: "${decision.slice(0, 450)}"

TEMPLATE QUESTION (${ruleId}): "${template}"

REWRITTEN QUESTION:`.trim()

async function personaliseRuleQuestion(
  ruleId:   string,
  template: string,
  decision: string,
): Promise<string> {
  try {
    const raw   = await createCompletion(PERSONALISE_PROMPT(ruleId, template, decision), 80)
    const clean = raw.trim().replace(/^["']|["']$/g, '').trim()
    if (!clean || clean.split(' ').length > 40) return template
    return clean
  } catch (err) {
    console.error(`[Examiner GET] personaliseRuleQuestion failed for ${ruleId}:`, err)
    return template
  }
}

const GAP_QUESTION_PROMPT = (gaps: string[]) => `You convert terse "unknown-unknown" gap descriptions into 3 concise, conversational diagnostic questions for a high-stakes decision-maker.

Rules:
- Each question must target the specific gap provided — do not genericise
- Write in second person ("What...?", "Have you...?", "Who...?")
- Maximum 20 words per question — tight, specific, no preamble
- Return ONLY a JSON array of 3 strings, nothing else, no markdown fences

Gaps to convert:
${gaps.map((g, i) => `gap_${i + 1}: "${g}"`).join('\n')}`

async function generateGapQuestions(gaps: string[]): Promise<string[]> {
  const nonEmpty = gaps.filter(Boolean)
  if (nonEmpty.length === 0) return []
  try {
    const raw    = await createCompletion(GAP_QUESTION_PROMPT(nonEmpty), 400)
    const clean  = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim()
    const parsed = JSON.parse(clean)
    return Array.isArray(parsed) ? parsed.slice(0, 3).map(String) : []
  } catch (err) {
    console.error('[Examiner GET] generateGapQuestions failed:', err)
    return []
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const sessionId = searchParams.get('sessionId')

  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId required' }, { status: 400 })
  }

  const supabase = createServiceClient()

  const [ontologyRes, sessionRes] = await Promise.all([
    supabase
      .from('sessions_ontology')
      .select('examiner_gap_1, examiner_gap_2, examiner_gap_3, tagger_status, tagger_version, rule_engine_result, ontology_vector')
      .eq('session_id', sessionId)
      .single(),
    supabase
      .from('sessions')
      .select('decision_text')
      .eq('id', sessionId)
      .single(),
  ])

  const data         = ontologyRes.data
  const decisionText = sessionRes.data?.decision_text ?? ''

  if (ontologyRes.error || !data || data.tagger_status !== 'complete') {
    return NextResponse.json({
      questions: null,
      rule_mode: null,
      status:    data?.tagger_status ?? 'not_found',
    })
  }

  if (data.tagger_version === 'v2.0' && data.rule_engine_result) {
    const ruleResult = data.rule_engine_result as {
      mode:            string
      triggered_rules: Array<{ rule_id: string; mode: string; question: string; low_confidence?: boolean }>
      flag_rules:      Array<{ rule_id: string; mode: string; question: string }>
    }

    // Only expose upstream_dependency rationale when R1 specifically fires.
    // R7 (information-first redirect) also sets mode='REDIRECT' but is unrelated
    // to upstream dependency — surfacing upstream_dependency.rationale for R7
    // produces contradictory copy ("no external blocking element" inside a block).
    const redirectRule: string | null =
      ruleResult.mode === 'REDIRECT'
        ? (ruleResult.triggered_rules ?? []).find(r => r.mode === 'REDIRECT')?.rule_id ?? null
        : null

    const upstreamRationale: string | null =
      redirectRule === 'R1' && data.ontology_vector
        ? (data.ontology_vector as Record<string, { rationale?: string }>)
            ?.upstream_dependency?.rationale ?? null
        : null

    const allRules = [
      ...(ruleResult.triggered_rules ?? []),
      ...(ruleResult.flag_rules ?? []),
    ].slice(0, 3)

    if (allRules.length === 0) {
      return NextResponse.json({ questions: [], rule_mode: 'OPEN', status: 'no_rules' })
    }

    const personalisedTexts = decisionText
      ? await Promise.all(
          allRules.map(rule =>
            personaliseRuleQuestion(rule.rule_id, rule.question, decisionText)
          )
        )
      : allRules.map(r => r.question)

    const questions = allRules.map((rule, i) => ({
      order:   i + 1,
      text:    personalisedTexts[i],
      gap:     `${rule.rule_id} — ${rule.mode}`,
      rule_id: rule.rule_id,
    }))

    console.log(
      `[Examiner GET] v2.0 | session ${sessionId} | mode: ${ruleResult.mode} | ` +
      `rules: ${questions.map(q => q.rule_id).join(',')}`
    )

    return NextResponse.json({
      questions,
      rule_mode:          ruleResult.mode,
      redirect_rule:      redirectRule,       // 'R1' | 'R7' | null — used by UI to select correct banner copy
      upstream_rationale: upstreamRationale,  // only populated for R1; null for R7
      status:             'ready',
    })
  }

  // v1.0 fallback
  const gaps = [data.examiner_gap_1, data.examiner_gap_2, data.examiner_gap_3]
    .filter(Boolean) as string[]

  if (gaps.length === 0) {
    return NextResponse.json({ questions: [], rule_mode: null, status: 'no_gaps' })
  }

  const questionTexts = await generateGapQuestions(gaps)
  const questions = questionTexts.map((text, i) => ({
    order:   i + 1,
    text,
    gap:     gaps[i] ?? '',
    rule_id: null,
  }))

  return NextResponse.json({ questions, rule_mode: null, status: 'ready' })
}

// ─────────────────────────────────────────────────────────────────────────────
// POST — save examiner responses + fire bias scoring via /api/bias-score
// ─────────────────────────────────────────────────────────────────────────────

type ExaminerResponseRow = {
  question_text:       string
  response_text:       string | null
  question_order:      number
  unknown_unknown_gap: string
  rule_id:             string | null
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { sessionId, responses, skipped } = body as {
      sessionId:  string
      responses?: ExaminerResponseRow[]
      skipped?:   boolean
    }

    if (!sessionId) {
      return NextResponse.json({ error: 'sessionId required' }, { status: 400 })
    }

    const supabase = createServiceClient()

    // ── Skipped path ──────────────────────────────────────────────────────────
    if (skipped) {
      await supabase
        .from('sessions_ontology')
        .update({ examiner_status: 'submitted' })
        .eq('session_id', sessionId)

      // Still trigger bias scoring on skip — personas + ontology are enough
      fireBiasScore(sessionId, req).catch(err =>
        console.error('[Examiner POST] Bias trigger (skip) error:', err)
      )
      fireIndependenceScore(sessionId, req).catch(err =>
        console.error('[Examiner POST] Independence trigger (skip) error:', err)
      )
      fireContradictions(sessionId, req).catch(err =>
        console.error('[Examiner POST] Contradictions trigger (skip) error:', err)
      )

      return NextResponse.json({ ok: true })
    }

    if (!responses?.length) {
      return NextResponse.json({ error: 'responses required' }, { status: 400 })
    }

    // ── Save examiner_responses ───────────────────────────────────────────────
    const rows = responses.map(r => ({
      session_id:           sessionId,
      question_text:        r.question_text,
      response_text:        r.response_text,
      question_order:       r.question_order,
      unknown_unknown_gap:  r.unknown_unknown_gap,
      bias_parameter_probed: null,
      rule_id:              r.rule_id ?? null,
    }))

    const { error: insertError } = await supabase.from('examiner_responses').insert(rows)
    if (insertError) {
      console.error('[Examiner POST] examiner_responses insert failed:', insertError)
      return NextResponse.json({ error: 'Failed to save responses' }, { status: 500 })
    }

    // ── Update examiner status ────────────────────────────────────────────────
    await supabase
      .from('sessions_ontology')
      .update({ examiner_status: 'submitted' })
      .eq('session_id', sessionId)

    // ── Trigger bias scoring via dedicated endpoint (non-blocking) ────────────
    fireBiasScore(sessionId, req).catch(err =>
      console.error('[Examiner POST] Bias trigger error:', err)
    )
    fireIndependenceScore(sessionId, req).catch(err =>
      console.error('[Examiner POST] Independence trigger error:', err)
    )
    fireContradictions(sessionId, req).catch(err =>
      console.error('[Examiner POST] Contradictions trigger error:', err)
    )

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[Examiner POST] Unexpected error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

/**
 * Fire-and-forget HTTP call to /api/bias-score.
 * /api/bias-score owns all bias_library accumulation logic — schema-correct,
 * handles identity resolution (user_id → user_email → device_id → anonymous).
 * Derives base URL from the incoming request so it works across envs.
 */
async function fireBiasScore(sessionId: string, req: Request): Promise<void> {
  // Use localhost to avoid SSL termination errors on Railway self-calls.
  // Railway exposes PORT (default 8080); INTERNAL_API_URL overrides for other envs.
  const port = process.env.PORT ?? '8080'
  const base = process.env.INTERNAL_API_URL ?? `http://localhost:${port}`
  const res = await fetch(`${base}/api/bias-score`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ sessionId }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    console.error(`[Examiner POST] /api/bias-score returned ${res.status}:`, body)
  } else {
    console.log(`[Examiner POST] Bias score triggered for session ${sessionId}`)
  }
}

/**
 * Fire-and-forget HTTP call to /api/mirror/independence.
 * Recalculates Decision Independence Score for the session owner.
 * Upserts one row per session_id — idempotent, safe to call every submit.
 * No-ops silently if session has no user_id (anonymous session).
 */
async function fireIndependenceScore(sessionId: string, _req: Request): Promise<void> {
  const port = process.env.PORT ?? '8080'
  const base = process.env.INTERNAL_API_URL ?? `http://localhost:${port}`
  const res = await fetch(`${base}/api/mirror/independence`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ sessionId }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    console.error(`[Examiner POST] /api/mirror/independence returned ${res.status}:`, body)
  } else {
    console.log(`[Examiner POST] Independence score triggered for session ${sessionId}`)
  }
}

/**
 * Fire-and-forget HTTP call to /api/mirror/contradictions.
 * Runs two-pass contradiction detection pipeline if ≥5 sessions with evidence
 * AND last run was >7 days ago (RERUN_DAYS_THRESHOLD inside the route).
 * The 7-day throttle is intentional — the AI pipeline is expensive and
 * contradictions do not change meaningfully session-to-session.
 * No-ops silently if session has no user_id (anonymous session).
 */
async function fireContradictions(sessionId: string, _req: Request): Promise<void> {
  const port = process.env.PORT ?? '8080'
  const base = process.env.INTERNAL_API_URL ?? `http://localhost:${port}`
  const res = await fetch(`${base}/api/mirror/contradictions`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ sessionId }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    console.error(`[Examiner POST] /api/mirror/contradictions returned ${res.status}:`, body)
  } else {
    console.log(`[Examiner POST] Contradictions triggered for session ${sessionId}`)
  }
}

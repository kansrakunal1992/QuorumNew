/**
 * QUORUM — Examiner Route (Sprint 12 update)
 *
 * CHANGES vs Sprint 11a:
 *
 *   GET — Contextual Rule Questions (Sprint 12 Item 1)
 *     v2.0 sessions: hardcoded rule.question is now personalised to the specific
 *     decision_text via a fast parallel AI call (personaliseRuleQuestion).
 *     Falls back to the template question on any error — zero downside risk.
 *     v1.0 sessions: unchanged (gap-based questions are already AI-generated).
 *
 *   POST — Reconstructed handler (was missing from Sprint 11a paste)
 *     Saves examiner_responses with rule_id, updates examiner_status,
 *     triggers bias scoring as a non-blocking background job.
 */

import { NextResponse }          from 'next/server'
import { createServiceClient }   from '@/lib/supabase'
import { scoreBiasesForSession } from '@/lib/bias-scorer'
import { createCompletion }      from '@/lib/ai-client'

// ─────────────────────────────────────────────────────────────────────────────
// GET — serve Examiner questions
// ─────────────────────────────────────────────────────────────────────────────

/** Prompt kept tight — this is a micro-rewrite call, not an analysis call. */
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

/**
 * Personalise a single rule question to the specific decision.
 * Falls back to the template question on any failure.
 */
async function personaliseRuleQuestion(
  ruleId:   string,
  template: string,
  decision: string,
): Promise<string> {
  try {
    const raw    = await createCompletion(PERSONALISE_PROMPT(ruleId, template, decision), 80)
    const clean  = raw.trim().replace(/^["']|["']$/g, '').trim()
    // Sanity: if output is empty or suspiciously long, fall back
    if (!clean || clean.split(' ').length > 40) return template
    return clean
  } catch (err) {
    console.error(`[Examiner GET] personaliseRuleQuestion failed for ${ruleId}:`, err)
    return template
  }
}

/** Shared question generator for v1.0 sessions — unchanged from Sprint 11a. */
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

  // Fetch ontology + decision text in parallel
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

  const data        = ontologyRes.data
  const decisionText = sessionRes.data?.decision_text ?? ''

  if (ontologyRes.error || !data || data.tagger_status !== 'complete') {
    return NextResponse.json({
      questions: null,
      rule_mode: null,
      status:    data?.tagger_status ?? 'not_found',
    })
  }

  // ── PATH A: v2.0 session — use rule engine result ─────────────────────────
  if (data.tagger_version === 'v2.0' && data.rule_engine_result) {
    const ruleResult = data.rule_engine_result as {
      mode:            string
      triggered_rules: Array<{ rule_id: string; mode: string; question: string; low_confidence?: boolean }>
      flag_rules:      Array<{ rule_id: string; mode: string; question: string }>
    }

    const upstreamRationale: string | null =
      ruleResult.mode === 'REDIRECT' && data.ontology_vector
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

    // ── Sprint 12: personalise each question in parallel ──────────────────
    const personalisedTexts = decisionText
      ? await Promise.all(
          allRules.map(rule =>
            personaliseRuleQuestion(rule.rule_id, rule.question, decisionText)
          )
        )
      : allRules.map(r => r.question)   // fallback: no decision text available

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
      upstream_rationale: upstreamRationale,
      status:             'ready',
    })
  }

  // ── PATH B: v1.0 session — gap-based questions (unchanged) ───────────────
  const gaps = [data.examiner_gap_1, data.examiner_gap_2, data.examiner_gap_3]
    .filter(Boolean) as string[]

  if (gaps.length === 0) {
    return NextResponse.json({ questions: [], rule_mode: null, status: 'no_gaps' })
  }

  const questionTexts = await generateGapQuestions(gaps)
  const questions     = questionTexts.map((text, i) => ({
    order:   i + 1,
    text,
    gap:     gaps[i] ?? '',
    rule_id: null,
  }))

  return NextResponse.json({ questions, rule_mode: null, status: 'ready' })
}

// ─────────────────────────────────────────────────────────────────────────────
// POST — save examiner responses + trigger bias scoring
// ─────────────────────────────────────────────────────────────────────────────

type ExaminerResponseRow = {
  question_text:       string
  response_text:       string | null
  question_order:      number
  unknown_unknown_gap: string
  rule_id:             string | null
}

/**
 * Background bias scoring — fires after POST response is returned.
 * Non-blocking: any failure is logged and swallowed.
 */
async function triggerBiasScoring(
  sessionId:        string,
  examinerResponses: ExaminerResponseRow[],
  supabase:         ReturnType<typeof createServiceClient>,
) {
  // Fetch everything needed in parallel
  const [sessionRes, messagesRes, ontologyRes] = await Promise.all([
    supabase
      .from('sessions')
      .select('decision_text, context_text, user_id')
      .eq('id', sessionId)
      .single(),
    supabase
      .from('messages')
      .select('persona, role, content')
      .eq('session_id', sessionId)
      .eq('role', 'assistant'),
    supabase
      .from('sessions_ontology')
      .select('ontology_vector')
      .eq('session_id', sessionId)
      .single(),
  ])

  if (!sessionRes.data) {
    console.error('[Examiner POST] Bias trigger: session not found', sessionId)
    return
  }

  const { decision_text, context_text, user_id } = sessionRes.data

  // Build persona responses map (last write per persona wins — correct for message ordering)
  const personaResponses: Record<string, string> = {}
  for (const msg of (messagesRes.data ?? [])) {
    personaResponses[msg.persona] = msg.content
  }

  // Build examiner QA
  const examinerQA = examinerResponses
    .filter(r => r.response_text?.trim())
    .map(r => ({ question: r.question_text, answer: r.response_text! }))

  // Resolve user_email for bias_library (required for Mirror module identity)
  let user_email: string | null = null
  if (user_id) {
    const { data: authUser } = await supabase.auth.admin.getUserById(user_id)
    user_email = authUser?.user?.email ?? null
  }

  const result = await scoreBiasesForSession({
    sessionId,
    decisionText:    decision_text,
    contextText:     context_text ?? null,
    personaResponses,
    examinerQA,
    ontologyJson:    (ontologyRes.data?.ontology_vector as Record<string, unknown> | null) ?? null,
  })

  // Insert one row per bias score
  const biasRows = result.scores.map(s => ({
    session_id:         sessionId,
    user_email,                         // null for anonymous users
    bias_key:           s.bias_key,
    prosecutor_score:   s.prosecutor_score,
    defense_score:      s.defense_score,
    asymmetry:          s.asymmetry,
    detected:           s.detected,
    reasoning:          s.reasoning,
    activation_context: s.activation_context ?? null,
    scored_at:          result.scored_at,
    model_used:         result.model_used,
  }))

  const { error: biasInsertError } = await supabase.from('bias_library').insert(biasRows)
  if (biasInsertError) {
    console.error('[Examiner POST] bias_library insert failed:', biasInsertError)
  } else {
    console.log(`[Examiner POST] Bias scoring complete for session ${sessionId} — ${biasRows.length} rows`)
  }
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

    // ── Skipped path — mark as submitted without saving responses ────────────
    if (skipped) {
      await supabase
        .from('sessions_ontology')
        .update({ examiner_status: 'submitted' })
        .eq('session_id', sessionId)
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
      bias_parameter_probed: null,      // populated retroactively by bias scorer
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

    // ── Trigger bias scoring in background (non-blocking) ────────────────────
    triggerBiasScoring(sessionId, responses, supabase).catch(err =>
      console.error('[Examiner POST] Background bias scoring error:', err)
    )

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[Examiner POST] Unexpected error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

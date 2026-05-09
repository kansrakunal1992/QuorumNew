/**
 * QUORUM — Examiner Route (Sprint 11a update)
 *
 * GET /api/examiner?sessionId=xxx
 *
 * WHAT CHANGED:
 *   v2.0 sessions (tagger_version = 'v2.0'): questions derived from rule_engine_result.
 *     - REDIRECT rules → surfaces redirect question, signals Council should not fire
 *     - GATE rules     → surfaces gate question before Council
 *     - FLAG rules     → included after GATE questions (enrichment)
 *   v1.0 sessions (tagger_version = 'v1.0' or null): falls back to gap-based questions
 *     (existing behaviour, unchanged)
 *
 *   Both paths return the same response shape so ExaminerPanel needs NO changes.
 *   New field: `rule_mode` ('REDIRECT' | 'GATE' | 'OPEN' | null)
 *     - ExaminerPanel can use this to signal SessionView whether to suppress Council.
 *
 * POST /api/examiner — unchanged (saves responses, triggers background jobs)
 *   Now also writes rule_id to examiner_responses if derived from rule engine.
 *
 * ── PASTE INSTRUCTIONS ──────────────────────────────────────────────────────
 * Replace only the GET handler in app/api/examiner/route.ts.
 * POST handler and all background trigger helpers remain identical.
 * Add import for buildCouncilContext at top of file (used in POST to enrich Council).
 */

// ── ADD to imports at top of app/api/examiner/route.ts ───────────────────────

// import { buildCouncilContext } from '@/lib/rule-engine'
// (used in POST handler to pass council context — see note at bottom)

// ── REPLACE the GET handler ───────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'

const PROVIDER        = (process.env.AI_PROVIDER ?? 'anthropic').toLowerCase()
const ANTHROPIC_MODEL = process.env.AI_MODEL ?? 'claude-sonnet-4-20250514'
const DEEPSEEK_MODEL  = process.env.AI_MODEL ?? 'deepseek-chat'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? '' })
const deepseek  = new OpenAI({
  apiKey:  process.env.DEEPSEEK_API_KEY ?? '',
  baseURL: 'https://api.deepseek.com',
})

// ── Shared question generator (v1 gap path — unchanged) ───────────────────────

const QUESTION_SYSTEM = `You convert terse "unknown-unknown" gap descriptions into 3 concise, conversational diagnostic questions for a high-stakes decision-maker.

Rules:
- Each question must target the specific gap provided — do not genericise
- Write in second person ("What...?", "Have you...?", "Who...?")
- Maximum 20 words per question — tight, specific, no preamble
- Return ONLY a JSON array of 3 strings, nothing else, no markdown fences`

async function generateGapQuestions(gaps: string[]): Promise<string[]> {
  const nonEmpty = gaps.filter(Boolean)
  if (nonEmpty.length === 0) return []

  const userMsg = `Gaps to convert:\n${nonEmpty.map((g, i) => `gap_${i + 1}: "${g}"`).join('\n')}`

  try {
    let raw: string
    if (PROVIDER === 'deepseek') {
      const res = await deepseek.chat.completions.create({
        model: DEEPSEEK_MODEL, max_tokens: 400, temperature: 0.3,
        messages: [{ role: 'system', content: QUESTION_SYSTEM }, { role: 'user', content: userMsg }],
      })
      raw = res.choices[0]?.message?.content ?? '[]'
    } else {
      const res = await anthropic.messages.create({
        model: ANTHROPIC_MODEL, max_tokens: 400, system: QUESTION_SYSTEM,
        messages: [{ role: 'user', content: userMsg }],
      })
      raw = res.content.filter(b => b.type === 'text').map(b => (b as { type:'text'; text:string }).text).join('')
    }
    const clean  = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim()
    const parsed = JSON.parse(clean)
    return Array.isArray(parsed) ? parsed.slice(0, 3).map(String) : []
  } catch (err) {
    console.error('[Examiner] generateGapQuestions failed:', err)
    return []
  }
}

// ── GET handler ────────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const sessionId = searchParams.get('sessionId')

  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId required' }, { status: 400 })
  }

  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('sessions_ontology')
    .select(`
      examiner_gap_1,
      examiner_gap_2,
      examiner_gap_3,
      tagger_status,
      tagger_version,
      rule_engine_result,
      ontology_vector
    `)
    .eq('session_id', sessionId)
    .single()

  if (error || !data || data.tagger_status !== 'complete') {
    return NextResponse.json({
      questions:  null,
      rule_mode:  null,
      status:     data?.tagger_status ?? 'not_found',
    })
  }

  // ── PATH A: v2.0 session — use rule engine result ─────────────────────────
  if (data.tagger_version === 'v2.0' && data.rule_engine_result) {
    const ruleResult = data.rule_engine_result as {
      mode:            string
      triggered_rules: Array<{ rule_id: string; mode: string; question: string; low_confidence?: boolean }>
      flag_rules:      Array<{ rule_id: string; mode: string; question: string }>
    }

    const allRules = [
      ...(ruleResult.triggered_rules ?? []),
      ...(ruleResult.flag_rules ?? []),
    ]

    if (allRules.length === 0) {
      // No rules fired — OPEN mode, skip Examiner
      return NextResponse.json({
        questions:  [],
        rule_mode:  'OPEN',
        status:     'no_rules',
      })
    }

    // Map rules → question objects (same shape as gap path for ExaminerPanel compat)
    const questions = allRules.slice(0, 3).map((rule, i) => ({
      order:   i + 1,
      text:    rule.question,
      gap:     `${rule.rule_id} — ${rule.mode}`,  // used for display in ExaminerPanel gap field
      rule_id: rule.rule_id,                       // NEW field — stored to examiner_responses
    }))

    console.log(
      `[Examiner] v2.0 session ${sessionId} | mode: ${ruleResult.mode} | ` +
      `rules: ${questions.map(q => q.rule_id).join(',')}`
    )

    return NextResponse.json({
      questions,
      rule_mode: ruleResult.mode,   // 'REDIRECT' | 'GATE' | 'OPEN'
      status:    'ready',
    })
  }

  // ── PATH B: v1.0 session — fall back to gap-based questions (unchanged) ────
  const gaps = [data.examiner_gap_1, data.examiner_gap_2, data.examiner_gap_3].filter(Boolean) as string[]

  if (gaps.length === 0) {
    return NextResponse.json({ questions: [], rule_mode: null, status: 'no_gaps' })
  }

  const questionTexts = await generateGapQuestions(gaps)

  const questions = questionTexts.map((text, i) => ({
    order:   i + 1,
    text,
    gap:     gaps[i] ?? '',
    rule_id: null,    // v1.0 sessions have no rule_id
  }))

  return NextResponse.json({
    questions,
    rule_mode: null,    // v1.0 sessions have no rule mode
    status:    'ready',
  })
}

/*
 * ── POST handler — ADD rule_id to examiner_responses ──────────────────────────
 *
 * In the POST handler's rows array, the existing shape is:
 *   { session_id, question_text, response_text, question_order, unknown_unknown_gap, bias_parameter_probed }
 *
 * ADD rule_id to each row:
 *   rule_id: r.rule_id || null
 *
 * The client (ExaminerPanel) already passes rule_id through onComplete → SessionView → POST body
 * if you add it to the response shape above. No ExaminerPanel changes needed if you
 * also pass it through the onComplete callback.
 *
 * ── Council enrichment — where to call buildCouncilContext ────────────────────
 *
 * In the POST handler, AFTER saving examiner responses, fetch the ontology_vector
 * and rule_engine_result from sessions_ontology, then call:
 *
 *   const councilContext = buildCouncilContext(sv, ruleResult)
 *
 * Store councilContext as a session-level context block (e.g., in a `council_context`
 * column on sessions, or pass it at persona invocation time).
 *
 * The persona API route (app/api/persona/route.ts) should prepend councilContext
 * to each persona's system prompt. This is Sprint 11b — scope separately.
 */

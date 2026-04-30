/**
 * QUORUM LEDGER — Examiner Phase 1 API Route
 * Sprint 3 + Sprint 5 fix
 *
 * GET  /api/examiner?sessionId=xxx
 *   Reads examiner_gap_1/2/3 from sessions_ontology.
 *   Calls AI to convert raw gap text into 3 user-facing diagnostic questions.
 *   Returns { questions: [{ order, text, gap }] }
 *
 * POST /api/examiner
 *   Saves user answers to examiner_responses table.
 *   Triggers bias scoring (Sprint 4) server-side.
 *   Triggers structural matching (Sprint 5) server-side — FIX: added here
 *   so structural_matches table gets populated after ontology is guaranteed
 *   complete. Previously only fired client-side before ontology was ready.
 */

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

const QUESTION_SYSTEM = `You convert terse "unknown-unknown" gap descriptions into 3 concise, conversational diagnostic questions for a high-stakes decision-maker.

Rules:
- Each question must target the specific gap provided — do not genericise
- Write in second person ("What...?", "Have you...?", "Who...?")
- Maximum 20 words per question — tight, specific, no preamble
- Return ONLY a JSON array of 3 strings, nothing else, no markdown fences

Example input gaps:
  gap_1: "Exit conditions and personal financial liquidity not examined"
  gap_2: "Key decision-maker relationship dynamics not surfaced"
  gap_3: "Success criteria post-commitment unclear"

Example output:
["What personal liquidity event would you need before this is worth the lock-up?","Who in the deal has authority to block or reshape the terms — and what do they want?","How will you know, 18 months in, whether this was the right call?"]`

async function generateQuestions(gaps: string[]): Promise<string[]> {
  const nonEmpty = gaps.filter(Boolean)
  if (nonEmpty.length === 0) return []

  const userMsg = `Gaps to convert:\n${nonEmpty.map((g, i) => `gap_${i + 1}: "${g}"`).join('\n')}`

  try {
    let raw: string
    if (PROVIDER === 'deepseek') {
      const res = await deepseek.chat.completions.create({
        model:       DEEPSEEK_MODEL,
        max_tokens:  400,
        temperature: 0.3,
        messages: [
          { role: 'system', content: QUESTION_SYSTEM },
          { role: 'user',   content: userMsg },
        ],
      })
      raw = res.choices[0]?.message?.content ?? '[]'
    } else {
      const res = await anthropic.messages.create({
        model:      ANTHROPIC_MODEL,
        max_tokens: 400,
        system:     QUESTION_SYSTEM,
        messages:   [{ role: 'user', content: userMsg }],
      })
      raw = res.content.filter(b => b.type === 'text').map(b => (b as { type:'text'; text:string }).text).join('')
    }

    const clean  = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim()
    const parsed = JSON.parse(clean)
    return Array.isArray(parsed) ? parsed.slice(0, 3).map(String) : []
  } catch (err) {
    console.error('[Examiner] generateQuestions failed:', err)
    return []
  }
}

// ── GET ─────────────────────────────────────────────────────────

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const sessionId = searchParams.get('sessionId')

  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId required' }, { status: 400 })
  }

  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('sessions_ontology')
    .select('examiner_gap_1, examiner_gap_2, examiner_gap_3, tagger_status')
    .eq('session_id', sessionId)
    .single()

  if (error || !data || data.tagger_status !== 'complete') {
    return NextResponse.json({ questions: null, status: data?.tagger_status ?? 'not_found' })
  }

  const gaps = [data.examiner_gap_1, data.examiner_gap_2, data.examiner_gap_3].filter(Boolean) as string[]

  if (gaps.length === 0) {
    return NextResponse.json({ questions: [], status: 'no_gaps' })
  }

  const questionTexts = await generateQuestions(gaps)

  const questions = questionTexts.map((text, i) => ({
    order: i + 1,
    text,
    gap: gaps[i] ?? '',
  }))

  return NextResponse.json({ questions, status: 'ready' })
}

// ── POST ─────────────────────────────────────────────────────────

export async function POST(req: Request) {
  try {
    const { sessionId, responses, skipped } = await req.json() as {
      sessionId: string
      responses?: Array<{
        question_text:       string
        response_text:       string | null
        question_order:      number
        unknown_unknown_gap: string
      }>
      skipped?: boolean
    }

    if (!sessionId) {
      return NextResponse.json({ error: 'sessionId required' }, { status: 400 })
    }

    const supabase = createServiceClient()

    await supabase
      .from('sessions_ontology')
      .update({ examiner_status: skipped ? 'skipped' : 'submitted' })
      .eq('session_id', sessionId)

    if (!skipped && responses && responses.length > 0) {
      const rows = responses.map(r => ({
        session_id:           sessionId,
        question_text:        r.question_text,
        response_text:        r.response_text || null,
        question_order:       r.question_order,
        unknown_unknown_gap:  r.unknown_unknown_gap,
        bias_parameter_probed: null,
      }))

      const { error } = await supabase
        .from('examiner_responses')
        .upsert(rows, { onConflict: 'session_id,question_order' })

      if (error) {
        console.error('[Examiner] Supabase insert error:', error)
        return NextResponse.json({ ok: false, error: 'DB insert failed' }, { status: 500 })
      }
    }

    // Sprint 4: Fire bias scoring server-side — fire-and-forget
    triggerBiasScoring(sessionId).catch(err =>
      console.error('[Examiner] Bias scoring trigger failed (non-blocking):', err)
    )

    // Sprint 5: Fire structural matching server-side — fire-and-forget
    // This is the critical fix: by the time the examiner POST fires,
    // the ontology tagger is always complete. The client-side call in
    // SessionView fires too early (before ontology finishes). This
    // server-side trigger guarantees structural_matches gets populated.
    triggerStructuralMatch(sessionId).catch(err =>
      console.error('[Examiner] Structural match trigger failed (non-blocking):', err)
    )

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[Examiner] Route error:', err)
    return NextResponse.json({ ok: false, error: 'Internal error' }, { status: 500 })
  }
}

// ── Background helpers ────────────────────────────────────────────

function getBaseUrl(): string {
  // Prefer the explicit app URL env var (set in Railway)
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL
  // Fallback for local dev
  return 'http://localhost:3000'
}

async function triggerBiasScoring(sessionId: string): Promise<void> {
  await fetch(`${getBaseUrl()}/api/bias-score`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ sessionId }),
  })
}

async function triggerStructuralMatch(sessionId: string): Promise<void> {
  // Session identity is read from the sessions table server-side —
  // no need to pass userEmail/userId from here.
  await fetch(`${getBaseUrl()}/api/structural-match`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ sessionId }),
  })
}

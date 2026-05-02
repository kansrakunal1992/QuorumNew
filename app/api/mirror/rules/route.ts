// app/api/mirror/rules/route.ts
// ── Mirror Module: Decision Rules Route (Sprint 7d) ──────────────────────────
//
// GET /api/mirror/rules
//
// Auth-gated: requires valid Bearer token (user_id)
// Access-gated: requires mirror_access row
// Session threshold: requires >= 8 sessions
//
// One AI call reads all examiner_responses + user pushback messages
// for this user and extracts 3–7 implicit first-person operating principles.
//
// Returns:
//   { rules: string[], sessionCount: number, basedOnDecisions: number }
//   or { rules: null } if threshold not met
//
// Generation is ~3–5s. Not cached server-side; client should call once
// per page visit and hold the result in state.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse }          from 'next/server'
import { createServiceClient }    from '@/lib/supabase'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { createCompletion }       from '@/lib/ai-client'

const RULES_SESSION_THRESHOLD = 8

// ── Auth helper ───────────────────────────────────────────────────────────────

async function resolveUserId(req: Request): Promise<string | null> {
  const authHeader = req.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) return null
  const token = authHeader.slice(7)
  try {
    const anonClient = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    )
    const { data: { user } } = await anonClient.auth.getUser(token)
    return user?.id ?? null
  } catch {
    return null
  }
}

// ── Prompt ────────────────────────────────────────────────────────────────────

const RULES_SYSTEM = `You are the Quorum Mirror Engine. Your task is to extract implicit operating principles from a decision-maker's actual behavior — their Examiner responses and pushback messages across multiple decisions.

These are NOT personality traits. These are behavioral rules the person is implicitly following, revealed through their reasoning patterns and what they push back on.

Rules for extraction:
- Write in first person ("Never...", "Always...", "Get...", "Separate...")
- Each rule must be concrete and specific — not generic wisdom
- Derive rules from patterns across multiple decisions, not single instances
- If a pattern appears only once, skip it
- Maximum 20 words per rule
- Return ONLY a JSON array of strings. No markdown, no preamble, no explanation.
- If you cannot find at least 3 clear rules, return the rules you can confidently extract
- Never mention "Quorum", "AI", or "bias" in the rules

Example output:
["Never accept the first deadline without checking if it's real", "Separate what makes financial sense from what you actually want", "Get one disconfirming view before any irreversible commitment", "Check who benefits from your urgency before you act on it"]`

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  // ── 1. Auth ───────────────────────────────────────────────────────────────
  const userId = await resolveUserId(req)
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient()

  // ── 2. Mirror access gate ─────────────────────────────────────────────────
  const { data: accessRow } = await supabase
    .from('mirror_access')
    .select('id, expires_at')
    .eq('user_id', userId)
    .maybeSingle()

  if (!accessRow) {
    return NextResponse.json({ error: 'Mirror access required' }, { status: 403 })
  }

  if (accessRow.expires_at && new Date(accessRow.expires_at) < new Date()) {
    return NextResponse.json({ error: 'Mirror access has expired' }, { status: 403 })
  }

  // ── 3. Session count gate ─────────────────────────────────────────────────
  const { count: sessionCount } = await supabase
    .from('sessions')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)

  if (!sessionCount || sessionCount < RULES_SESSION_THRESHOLD) {
    return NextResponse.json({
      rules:        null,
      sessionCount: sessionCount ?? 0,
      threshold:    RULES_SESSION_THRESHOLD,
    })
  }

  // ── 4. Fetch user session IDs ─────────────────────────────────────────────
  const { data: sessionRows } = await supabase
    .from('sessions')
    .select('id, decision_text, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .limit(50)

  if (!sessionRows || sessionRows.length === 0) {
    return NextResponse.json({ rules: null, sessionCount: 0, threshold: RULES_SESSION_THRESHOLD })
  }

  const sessionIds = sessionRows.map(s => s.id)

  // ── 5. Fetch examiner responses ───────────────────────────────────────────
  const { data: examinerRows } = await supabase
    .from('examiner_responses')
    .select('session_id, question_text, response_text, question_order')
    .in('session_id', sessionIds)
    .not('response_text', 'is', null)
    .order('created_at', { ascending: true })

  // ── 6. Fetch user pushback messages ──────────────────────────────────────
  // role='user' messages are pushbacks where user challenged an advisor's view
  const { data: pushbackRows } = await supabase
    .from('messages')
    .select('session_id, content, persona')
    .in('session_id', sessionIds)
    .eq('role', 'user')
    .order('created_at', { ascending: true })

  // ── 7. Build evidence corpus ──────────────────────────────────────────────
  const decisionMap = new Map(sessionRows.map(s => [s.id, s.decision_text]))

  // Group examiner responses by session
  const examinerBySession: Record<string, Array<{ q: string; a: string }>> = {}
  for (const row of (examinerRows ?? [])) {
    if (!row.response_text?.trim()) continue
    if (!examinerBySession[row.session_id]) examinerBySession[row.session_id] = []
    examinerBySession[row.session_id].push({
      q: row.question_text,
      a: row.response_text,
    })
  }

  // Group pushbacks by session
  const pushbackBySession: Record<string, string[]> = {}
  for (const row of (pushbackRows ?? [])) {
    if (!row.content?.trim()) continue
    if (!pushbackBySession[row.session_id]) pushbackBySession[row.session_id] = []
    pushbackBySession[row.session_id].push(row.content)
  }

  // Build the corpus text — cap at 20 sessions to stay within token budget
  const corpusSessions = sessionRows.slice(0, 20)
  const corpusLines: string[] = []

  for (const session of corpusSessions) {
    const sid          = session.id
    const decisionText = decisionMap.get(sid) ?? ''
    const examiner     = examinerBySession[sid] ?? []
    const pushbacks    = pushbackBySession[sid] ?? []

    if (examiner.length === 0 && pushbacks.length === 0) continue

    corpusLines.push(`\n--- Decision: "${decisionText.slice(0, 100)}" ---`)

    for (const { q, a } of examiner) {
      corpusLines.push(`Examiner Q: ${q}`)
      corpusLines.push(`User response: ${a}`)
    }

    for (const pb of pushbacks) {
      corpusLines.push(`User pushback: ${pb.slice(0, 300)}`)
    }
  }

  if (corpusLines.length === 0) {
    // No examiner/pushback data — can't extract rules
    return NextResponse.json({
      rules:        null,
      sessionCount,
      threshold:    RULES_SESSION_THRESHOLD,
      reason:       'insufficient_examiner_data',
    })
  }

  const corpus = corpusLines.join('\n')

  // ── 8. AI call — extract rules ────────────────────────────────────────────
  try {
    const rawText = await createCompletion({
      system: RULES_SYSTEM,
      prompt: `Here are the user's examiner responses and pushbacks across ${corpusSessions.length} decisions:\n\n${corpus}\n\nExtract their implicit operating principles as a JSON array of first-person rule strings.`,
      max_tokens: 600,
    })

    // Parse JSON — strip any accidental markdown fences
    const cleaned = rawText.replace(/```json|```/g, '').trim()
    let rules: string[] = []

    try {
      const parsed = JSON.parse(cleaned)
      if (Array.isArray(parsed)) {
        rules = parsed
          .filter((r): r is string => typeof r === 'string' && r.trim().length > 0)
          .slice(0, 7)  // cap at 7
      }
    } catch {
      console.error('[mirror/rules] JSON parse error:', cleaned.slice(0, 200))
      return NextResponse.json({ error: 'Parse error' }, { status: 500 })
    }

    return NextResponse.json({
      rules,
      sessionCount,
      basedOnDecisions: corpusSessions.length,
    })
  } catch (err) {
    console.error('[mirror/rules] AI call error:', err)
    return NextResponse.json({ error: 'Generation failed' }, { status: 500 })
  }
}

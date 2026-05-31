// app/api/mirror/contradictions/route.ts
// ── Sprint 9: Contradiction Detector API ────────────────────────────────────
//
// GET  /api/mirror/contradictions
//   Auth + mirror_access gated.
//   Returns active (non-dismissed) contradictions for the user.
//   Also returns { sessionCount, meetsThreshold, lastRanAt }.
//
// POST /api/mirror/contradictions
//   Internal — called from /api/examiner after session completion.
//   Runs the detection pipeline if conditions are met:
//     - user_id must be known
//     - >= MIN_SESSIONS sessions with examiner evidence
//     - last run was > RERUN_DAYS_THRESHOLD days ago (or never)
//   Upserts results into contradictions table.
//
// DELETE /api/mirror/contradictions?id=<contradiction_id>
//   Dismisses a single contradiction (sets dismissed_at = now()).
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse }          from 'next/server'
import { createServiceClient }    from '@/lib/supabase'
import { createClient as anonClient } from '@supabase/supabase-js'
import { detectContradictions }  from '@/lib/contradiction-detector'
import type { SessionEvidence }  from '@/lib/contradiction-detector'
import { getMirrorAccessState } from '@/lib/mirror-access'

// R11 fix: configurable via Railway env vars. Defaults match original heuristics.
const MIN_SESSIONS          = Number(process.env.MIN_SESSIONS         ?? '5')
const RERUN_DAYS_THRESHOLD  = Number(process.env.RERUN_DAYS_THRESHOLD ?? '7')

// ── Auth helper ───────────────────────────────────────────────────────────────

async function resolveUserId(req: Request): Promise<string | null> {
  const auth = req.headers.get('authorization')
  if (!auth?.startsWith('Bearer ')) return null
  try {
    const client = anonClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    )
    const { data: { user } } = await client.auth.getUser(auth.slice(7))
    return user?.id ?? null
  } catch { return null }
}

// ── GET — return active contradictions ────────────────────────────────────────

export async function GET(req: Request) {
  const userId = await resolveUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = createServiceClient()

  // Mirror access gate
  const accessState = await getMirrorAccessState(userId, supabase)
  if (accessState !== 'unlocked') {
    return NextResponse.json({ error: 'Mirror access required' }, { status: 403 })
  }

  // Session count
  const { count: sessionCount } = await supabase
    .from('sessions')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)

  // Last run info
  const { data: runRow } = await supabase
    .from('contradiction_runs')
    .select('ran_at, session_count_at_run')
    .eq('user_id', userId)
    .maybeSingle()

  // Active contradictions
  const { data: rows } = await supabase
    .from('contradictions')
    .select(`
      id, principle_text, principle_session_id, violation_text,
      violation_session_id, severity, category, generated_at
    `)
    .eq('user_id', userId)
    .is('dismissed_at', null)
    .order('generated_at', { ascending: false })
    .limit(5)

  // Enrich with decision_text for each referenced session
  const sessionIds = new Set<string>()
  for (const row of rows ?? []) {
    if (row.principle_session_id) sessionIds.add(row.principle_session_id)
    if (row.violation_session_id) sessionIds.add(row.violation_session_id)
  }

  let decisionMap: Record<string, string> = {}
  if (sessionIds.size > 0) {
    const { data: sessions } = await supabase
      .from('sessions')
      .select('id, decision_text')
      .in('id', Array.from(sessionIds))
    for (const s of sessions ?? []) decisionMap[s.id] = s.decision_text
  }

  const contradictions = (rows ?? []).map(row => ({
    id:                    row.id,
    principleText:         row.principle_text,
    principleSessionId:    row.principle_session_id,
    principleDecision:     row.principle_session_id ? (decisionMap[row.principle_session_id] ?? '').slice(0, 80) : null,
    violationText:         row.violation_text,
    violationSessionId:    row.violation_session_id,
    violationDecision:     row.violation_session_id ? (decisionMap[row.violation_session_id] ?? '').slice(0, 80) : null,
    severity:              row.severity,
    category:              row.category,
    generatedAt:           row.generated_at,
  }))

  return NextResponse.json({
    contradictions,
    sessionCount:      sessionCount ?? 0,
    meetsThreshold:    (sessionCount ?? 0) >= MIN_SESSIONS,
    threshold:         MIN_SESSIONS,
    lastRanAt:         runRow?.ran_at ?? null,
    sessionCountAtRun: runRow?.session_count_at_run ?? null,
  })
}

// ── POST — run detection pipeline ─────────────────────────────────────────────

export async function POST(req: Request) {
  let userId: string | null = null
  let force = false

  try {
    const body = await req.json() as { userId?: string; sessionId?: string; force?: boolean }
    force = body.force ?? false

    if (body.userId) {
      userId = body.userId
    } else if (body.sessionId) {
      // Called from examiner route — resolve user_id from session row
      const supabaseR = createServiceClient()
      const { data: sessionRow } = await supabaseR
        .from('sessions')
        .select('user_id')
        .eq('id', body.sessionId)
        .single()
      userId = sessionRow?.user_id ?? null
    }
  } catch { /* body may be empty */ }

  if (!userId) return NextResponse.json({ ok: false, reason: 'no_user_id' })

  const supabase = createServiceClient()

  // ── Check if we should run ───────────────────────────────────────────────
  const { data: runRow } = await supabase
    .from('contradiction_runs')
    .select('ran_at, session_count_at_run')
    .eq('user_id', userId)
    .maybeSingle()

  if (!force && runRow?.ran_at) {
    const daysSince = (Date.now() - new Date(runRow.ran_at).getTime()) / (1000 * 60 * 60 * 24)
    if (daysSince < RERUN_DAYS_THRESHOLD) {
      return NextResponse.json({ ok: true, reason: 'skipped_recent_run', ranAt: runRow.ran_at })
    }
  }

  // ── Fetch sessions + evidence ───────────────────────────────────────────
  const { data: sessions } = await supabase
    .from('sessions')
    .select('id, decision_text, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .limit(30)

  if (!sessions || sessions.length < MIN_SESSIONS) {
    return NextResponse.json({ ok: true, reason: 'insufficient_sessions', count: sessions?.length ?? 0 })
  }

  const sessionIds = sessions.map(s => s.id)

  // Examiner responses
  const { data: examinerRows } = await supabase
    .from('examiner_responses')
    .select('session_id, question_text, response_text')
    .in('session_id', sessionIds)
    .not('response_text', 'is', null)

  // User pushback messages
  const { data: pushbackRows } = await supabase
    .from('messages')
    .select('session_id, content')
    .in('session_id', sessionIds)
    .eq('role', 'user')

  // Build evidence map
  const evidenceMap: Record<string, string[]> = {}
  for (const row of (examinerRows ?? [])) {
    if (!row.response_text?.trim() || row.response_text.trim().length < 15) continue
    if (!evidenceMap[row.session_id]) evidenceMap[row.session_id] = []
    evidenceMap[row.session_id].push(`Q: ${row.question_text}\nA: ${row.response_text}`)
  }
  for (const row of (pushbackRows ?? [])) {
    if (!row.content?.trim()) continue
    if (!evidenceMap[row.session_id]) evidenceMap[row.session_id] = []
    evidenceMap[row.session_id].push(`Pushback: ${row.content.slice(0, 400)}`)
  }

  // Only pass sessions that have actual evidence
  const evidence: SessionEvidence[] = sessions
    .filter(s => evidenceMap[s.id] && evidenceMap[s.id].length > 0)
    .map(s => ({
      sessionId:    s.id,
      decisionText: s.decision_text,
      createdAt:    s.created_at,
      responses:    evidenceMap[s.id],
    }))

  if (evidence.length < MIN_SESSIONS) {
    await supabase.from('contradiction_runs').upsert({
      user_id:               userId,
      ran_at:                new Date().toISOString(),
      session_count_at_run:  sessions.length,
    }, { onConflict: 'user_id' })
    return NextResponse.json({ ok: true, reason: 'insufficient_evidence', evidenceCount: evidence.length })
  }

  // ── Run detection ──────────────────────────────────────────────────────
  const results = await detectContradictions(evidence)

  // ── Upsert into DB ─────────────────────────────────────────────────────
  // Match session IDs from AI output (may be short UUIDs from prompt)
  const resolveSessionId = (shortId: string): string | null => {
    if (shortId.length === 36) return sessionIds.includes(shortId) ? shortId : null
    const match = sessions.find(s => s.id.startsWith(shortId) || s.id.slice(0, 8) === shortId)
    return match?.id ?? null
  }

  let inserted = 0
  for (const c of results) {
    const principleId = resolveSessionId(c.principleSessionId)
    const violationId = resolveSessionId(c.violationSessionId)
    if (!principleId || !violationId || principleId === violationId) continue

    const { error } = await supabase
      .from('contradictions')
      .upsert({
        user_id:              userId,
        principle_text:       c.principleText,
        principle_session_id: principleId,
        violation_text:       c.violationText,
        violation_session_id: violationId,
        severity:             c.severity,
        category:             c.category ?? 'process',
        generated_at:         new Date().toISOString(),
        dismissed_at:         null,
      }, { onConflict: 'user_id,principle_session_id,violation_session_id' })

    if (!error) inserted++
  }

  // Record run
  await supabase.from('contradiction_runs').upsert({
    user_id:               userId,
    ran_at:                new Date().toISOString(),
    session_count_at_run:  sessions.length,
  }, { onConflict: 'user_id' })

  console.log(`[contradictions] user=${userId} evidence=${evidence.length} found=${results.length} inserted=${inserted}`)
  return NextResponse.json({ ok: true, found: results.length, inserted })
}

// ── DELETE — dismiss a contradiction ─────────────────────────────────────────

export async function DELETE(req: Request) {
  const userId = await resolveUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const supabase = createServiceClient()

  const { error } = await supabase
    .from('contradictions')
    .update({ dismissed_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', userId)   // RLS belt + suspenders

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

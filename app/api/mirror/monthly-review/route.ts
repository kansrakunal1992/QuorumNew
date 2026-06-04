// app/api/mirror/monthly-review/route.ts
// ── Mirror: Monthly Judgment Review (Chunk 2) ─────────────────────────────────
//
// Returns a rolling 30-day summary of the user's decision loop closure.
// Falls back to all-time window when total session count < 10 — ensures the
// module is useful from the first day rather than showing empty data.
//
// Response shape:
//   {
//     window:            'last_30_days' | 'all_time'
//     windowStart:       string            // ISO date
//     decisionsTotal:    number            // sessions in window
//     loopsClosed:       number            // sessions in window with an outcome row
//     loopsClosedPct:    number            // 0–100
//     ruleRecallApplied: number            // sessions in window where rule_recall_choice = 'applied'
//     confirmedPatterns: number            // bias_library rows with detection_count >= 3
//     openLoops:         OpenLoop[]        // past-due review dates + older decisions with no outcome
//   }
//
// Open loop definition — a session qualifies if EITHER:
//   (a) commitment_review_date is set and < today (past the user's stated review date), OR
//   (b) created_at > 14 days ago with no outcome row and no commitment_review_date
//       (catch-all for decisions the user never committed a review date for)
//
// Auth: Bearer token → user_id (same pattern as all mirror routes).
// Gate: mirror_access = unlocked.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse }         from 'next/server'
import { createServiceClient }  from '@/lib/supabase'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { getMirrorAccessState } from '@/lib/mirror-access'
import { decrypt }              from '@/lib/encryption'

const WINDOW_DAYS      = 30
const FALLBACK_MIN     = 10   // use all-time when session count < this
const CATCHALL_DAYS    = 14   // sessions older than this with no outcome = open loop

export interface OpenLoop {
  session_id:   string
  decision_text: string        // decrypted, truncated to 80 chars
  created_at:   string
  review_date:  string | null  // commitment_review_date (ISO date)
  days_overdue: number | null  // null if no review_date; else days past review_date
  days_open:    number         // days since session created
}

export interface MonthlyReviewData {
  window:             'last_30_days' | 'all_time'
  window_start:       string
  decisions_total:    number
  loops_closed:       number
  loops_closed_pct:   number
  rule_recall_applied: number
  confirmed_patterns: number
  open_loops:         OpenLoop[]
}

export async function GET(req: Request) {
  const supabase = createServiceClient()

  // ── 1. Auth ─────────────────────────────────────────────────────────────────
  let userId: string | null = null
  const authHeader = req.headers.get('authorization')
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7)
    try {
      const anonClient = createSupabaseClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      )
      const { data: { user } } = await anonClient.auth.getUser(token)
      userId = user?.id ?? null
    } catch { /* fall through */ }
  }
  if (!userId) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  // ── 2. Mirror access gate ────────────────────────────────────────────────────
  const accessState = await getMirrorAccessState(userId, supabase)
  if (accessState !== 'unlocked') {
    return NextResponse.json({ error: 'Mirror access required' }, { status: 403 })
  }

  // ── 3. Determine window ──────────────────────────────────────────────────────
  // Count all user sessions first to decide whether to use rolling window
  // or all-time fallback.
  const { count: totalCount } = await supabase
    .from('sessions')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)

  const useAllTime    = (totalCount ?? 0) < FALLBACK_MIN
  const windowStart   = new Date()
  if (!useAllTime) windowStart.setDate(windowStart.getDate() - WINDOW_DAYS)
  if (useAllTime) windowStart.setFullYear(windowStart.getFullYear() - 10)  // far past
  const windowStartISO = windowStart.toISOString()

  // ── 4. Fetch sessions in window ──────────────────────────────────────────────
  const { data: sessionRows } = await supabase
    .from('sessions')
    .select('id, decision_text, created_at, commitment_review_date, rule_recall_choice')
    .eq('user_id', userId)
    .gte('created_at', windowStartISO)
    .order('created_at', { ascending: false })

  interface SessionRow {
    id:                      string
    decision_text:           string | null
    created_at:              string
    commitment_review_date:  string | null
    rule_recall_choice:      string | null
  }

  const sessions = (sessionRows ?? []) as SessionRow[]
  const sessionIds = sessions.map(s => s.id as string)

  if (sessionIds.length === 0) {
    return NextResponse.json({
      window:             useAllTime ? 'all_time' : 'last_30_days',
      window_start:       windowStartISO,
      decisions_total:    0,
      loops_closed:       0,
      loops_closed_pct:   0,
      rule_recall_applied: 0,
      confirmed_patterns: 0,
      open_loops:         [],
    } satisfies MonthlyReviewData)
  }

  // ── 5. Fetch outcomes + confirmed patterns in parallel ───────────────────────
  const [outcomesResult, patternsResult] = await Promise.all([
    supabase
      .from('outcomes')
      .select('session_id')
      .in('session_id', sessionIds),
    supabase
      .from('bias_library')
      .select('bias_parameter', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('detection_count', 3),
  ])

  const closedSessionIds = new Set(
    (outcomesResult.data ?? []).map((r: { session_id: string }) => r.session_id),
  )
  const confirmedPatterns = patternsResult.count ?? 0

  // ── 6. Compute summary metrics ───────────────────────────────────────────────
  const decisionsTotal    = sessions.length
  const loopsClosed       = sessions.filter(s => closedSessionIds.has(s.id)).length
  const loopsClosedPct    = decisionsTotal > 0
    ? Math.round((loopsClosed / decisionsTotal) * 100)
    : 0
  const ruleRecallApplied = sessions.filter(s => s.rule_recall_choice === 'applied').length

  // ── 7. Build open loops list ─────────────────────────────────────────────────
  const today      = new Date()
  today.setHours(0, 0, 0, 0)
  const catchallCutoff = new Date()
  catchallCutoff.setDate(catchallCutoff.getDate() - CATCHALL_DAYS)

  const openLoops: OpenLoop[] = []

  for (const s of sessions) {
    if (closedSessionIds.has(s.id)) continue  // loop already closed — skip

    const sessionDate  = new Date(s.created_at)
    const daysOpen     = Math.floor((today.getTime() - sessionDate.getTime()) / 86_400_000)
    const reviewDate   = s.commitment_review_date

    let daysOverdue: number | null = null
    let qualifies = false

    if (reviewDate) {
      // (a) Past review date
      const rd = new Date(reviewDate + 'T00:00:00')
      if (rd < today) {
        daysOverdue = Math.floor((today.getTime() - rd.getTime()) / 86_400_000)
        qualifies = true
      }
    } else if (sessionDate < catchallCutoff) {
      // (b) No review date + older than 14 days
      qualifies = true
    }

    if (!qualifies) continue

    const decisionText = decrypt(s.decision_text) ?? ''

    openLoops.push({
      session_id:   s.id as string,
      decision_text: decisionText.slice(0, 80) + (decisionText.length > 80 ? '…' : ''),
      created_at:   s.created_at as string,
      review_date:  reviewDate ?? null,
      days_overdue: daysOverdue,
      days_open:    daysOpen,
    })
  }

  // Sort: past-due review dates first (by days overdue desc), then by days_open desc
  openLoops.sort((a, b) => {
    if (a.days_overdue !== null && b.days_overdue !== null) return b.days_overdue - a.days_overdue
    if (a.days_overdue !== null) return -1
    if (b.days_overdue !== null) return  1
    return b.days_open - a.days_open
  })

  return NextResponse.json({
    window:             useAllTime ? 'all_time' : 'last_30_days',
    window_start:       windowStartISO,
    decisions_total:    decisionsTotal,
    loops_closed:       loopsClosed,
    loops_closed_pct:   loopsClosedPct,
    rule_recall_applied: ruleRecallApplied,
    confirmed_patterns: confirmedPatterns,
    open_loops:         openLoops,
  } satisfies MonthlyReviewData)
}

// app/api/cron/reanalyze-email/route.ts
// ── Cron: Reanalyze Nudge Emails (Engagement Pull) ───────────────────────────
//
// POST /api/cron/reanalyze-email
//
// Auth: Authorization: Bearer <CRON_SECRET>   (same pattern as avoidance-detect)
//
// Called by: Railway Cron Job — daily at 04:00 UTC (9:30 AM IST)
//   Railway Dashboard → your service → Settings → Cron Jobs:
//     Schedule : 0 8 * * *
//     Command  : curl -s -X POST https://<your-app>.railway.app/api/cron/reanalyze-email \
//                     -H "Authorization: Bearer $CRON_SECRET"
//
// Logic:
//   PASS A — Commitment review date (Quick Win, Sprint QW-1):
//     If a session has commitment_leaning captured (Sprint Chunk 1), the user
//     set commitment_review_date themselves — "when do you want to revisit
//     this?" — a stronger signal than an arbitrary fixed milestone. This pass
//     fires ONE email/push on (or shortly after) that self-chosen date:
//       • user_id is set
//       • commitment_review_date IS NOT NULL
//       • commitment_review_date has arrived: <= today AND >= today - REVIEW_DATE_LOOKBACK_DAYS
//         (the lower bound guards against a backlog of old dates suddenly
//         firing the first time this pass runs, or after any downtime)
//       • no outcome has been logged yet
//       • we haven't already sent the review-date email (email_send_log,
//         email_type = 'reanalyze_review_date')
//     Sessions handled by Pass A are EXCLUDED from Pass B below — the user's
//     own chosen date takes priority over the generic fixed schedule.
//
//   PASS B — Fixed milestones (7d / 14d / 30d), default/fallback:
//     For sessions with NO commitment_review_date set (the field is only
//     populated when the user completes the Sprint Chunk 1 commitment capture
//     — plenty of sessions never reach it), keep the original behavior:
//       • user_id is set (authenticated user — has an email)
//       • created_at falls within a ±12h window of the milestone
//       • no outcome has been logged yet
//       • we haven't already sent this milestone email (email_send_log)
//   Then: fetch user email → decrypt decision_text → send via Resend → log send.
//
// Email format (intentionally minimal):
//   Pass A  : "You said you'd revisit this on [date]." + the commitment
//             leaning/switch the user captured, if present.
//   Pass B  : "It's been 14 days. You were X/10 confident. How's it sitting?"
//             Both: single CTA link to /record/<sessionId>
//
// Environment variables required:
//   RESEND_API_KEY   — Resend API key (https://resend.com, free tier: 3,000/mo)
//   FROM_EMAIL       — e.g. "Quorum <quorum@quorumvault.org>"
//                      The domain must be verified in Resend before use.
//   CRON_SECRET      — already set for avoidance-detect
//   NEXT_PUBLIC_APP_URL — already set (used to build record links)
//
// Response:
//   200: { ok: true, sent, skipped, errors, elapsed_ms }
//   401: { error: 'Unauthorized' }
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse }      from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { decrypt }           from '@/lib/encryption'
import { sendPushToUser }    from '@/lib/push'

// ── Milestones (Pass B — fallback for sessions with no review date) ───────────
const MILESTONES = [7, 14, 30] as const
type Milestone   = (typeof MILESTONES)[number]
type EmailType   = `reanalyze_${Milestone}d`

// ±12h window around each milestone — absorbs daily cron timing drift
const WINDOW_HOURS = 12

// ── Commitment review date (Pass A — takes priority when set) ─────────────────
const REVIEW_DATE_EMAIL_TYPE = 'reanalyze_review_date' as const
// How far in the past a commitment_review_date can be and still fire. Bounds
// the backlog on first deploy / after downtime — an 18-month-old review date
// firing today would read as broken, not helpful.
const REVIEW_DATE_LOOKBACK_DAYS = 60

// ── Email sender (Resend REST — no extra package) ─────────────────────────────
async function sendEmail({
  to, subject, html,
}: {
  to: string; subject: string; html: string
}): Promise<boolean> {
  const apiKey  = process.env.RESEND_API_KEY
   const rawFrom = process.env.FROM_EMAIL ?? 'Quorum <quorum@quorumvault.org>'
   // Safety net: if FROM_EMAIL is a bare address with no "Name <email>"
   // wrapper, prepend "Quorum" so clients don't fall back to showing the
   // local-part (e.g. "auth@...") as the sender name.
   const from = rawFrom.includes('<') ? rawFrom : `Quorum <${rawFrom.trim()}>`

  if (!apiKey) {
    console.error('[ReanalyzeEmail] RESEND_API_KEY not set — email not sent')
    return false
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method:  'POST',
      headers: {
        Authorization:  `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from, to, subject, html }),
    })

    if (!res.ok) {
      const err = await res.text().catch(() => '?')
      console.error(`[ReanalyzeEmail] Resend error ${res.status}:`, err)
      return false
    }

    return true
  } catch (err) {
    console.error('[ReanalyzeEmail] Network error sending email:', err)
    return false
  }
}

// ── Email template ────────────────────────────────────────────────────────────
// Deliberately minimal. The decision text and the question are the only content.
// No Quorum feature promos. No unsubscribe noise above the fold.
function buildEmailHtml({
  decisionSnippet,
  daysAgo,
  confidence,
  sessionId,
  appUrl,
}: {
  decisionSnippet: string
  daysAgo: Milestone
  confidence: number | null
  sessionId: string
  appUrl: string
}): string {
  const confidenceLine = confidence !== null
    ? `<p style="color:#888;font-size:14px;margin:0 0 24px;line-height:1.6">
         You were <strong style="color:#c9a84c">${confidence}/10</strong> confident going in.
       </p>`
    : ''

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Your decision — ${daysAgo} days later</title>
</head>
<body style="background:#f5f4f0;margin:0;padding:48px 20px;font-family:'DM Sans',Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased">
  <div style="max-width:480px;margin:0 auto">

    <!-- Wordmark -->
    <p style="color:#999;font-size:10px;letter-spacing:0.22em;text-transform:uppercase;margin:0 0 40px;font-family:monospace">
      Quorum &middot; Judgment Record
    </p>

    <!-- Hook -->
    <p style="color:#1a1a1a;font-size:20px;line-height:1.45;margin:0 0 10px;font-weight:400">
      It&rsquo;s been ${daysAgo} days.
    </p>

    <!-- Decision snippet -->
    <p style="color:#666;font-size:14px;margin:0 0 20px;line-height:1.65;font-style:italic;border-left:2px solid #dddad0;padding-left:14px">
      &ldquo;${decisionSnippet}&rdquo;
    </p>

    ${confidenceLine}

    <!-- The question -->
    <p style="color:#1a1a1a;font-size:17px;margin:0 0 32px;line-height:1.5;font-weight:400">
      How&rsquo;s it sitting?
    </p>

    <!-- CTA -->
    <a href="${appUrl}/record/${sessionId}"
       style="display:inline-block;background:#c9a84c;color:#0a0a12;text-decoration:none;
              padding:13px 28px;border-radius:8px;font-size:14px;font-weight:700;
              letter-spacing:0.04em">
      Log what happened &rarr;
    </a>

    <!-- Footer -->
    <p style="color:#bbb;font-size:11px;margin:48px 0 0;line-height:1.7">
      One nudge per milestone. No further reminders for this decision.<br>
      <a href="${appUrl}" style="color:#aaa;text-decoration:none">Quorum</a>
    </p>

  </div>
</body>
</html>`
}

// ── Email template — Pass A (commitment review date) ───────────────────────────
// Same visual shell as buildEmailHtml, different hook: this isn't "time has
// passed," it's "you told us this was the day." If the user captured a
// leaning/switch condition at session end (Sprint Chunk 1), surface it back —
// it's the single most useful thing we can remind them of, and it already
// exists in the schema, just unused until now.
function buildReviewDateEmailHtml({
  decisionSnippet,
  reviewDateLabel,
  leaning,
  switchCondition,
  sessionId,
  appUrl,
}: {
  decisionSnippet: string
  reviewDateLabel: string   // e.g. "March 14"
  leaning: string | null
  switchCondition: string | null
  sessionId: string
  appUrl: string
}): string {
  const leaningLine = leaning
    ? `<p style="color:#888;font-size:14px;margin:0 0 12px;line-height:1.6">
         Where you were leaning: <strong style="color:#c9a84c">${leaning}</strong>
       </p>`
    : ''
  const switchLine = switchCondition
    ? `<p style="color:#888;font-size:14px;margin:0 0 24px;line-height:1.6">
         What you said would change your course: <strong style="color:#c9a84c">${switchCondition}</strong>
       </p>`
    : ''

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Your decision — review date</title>
</head>
<body style="background:#f5f4f0;margin:0;padding:48px 20px;font-family:'DM Sans',Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased">
  <div style="max-width:480px;margin:0 auto">

    <!-- Wordmark -->
    <p style="color:#999;font-size:10px;letter-spacing:0.22em;text-transform:uppercase;margin:0 0 40px;font-family:monospace">
      Quorum &middot; Judgment Record
    </p>

    <!-- Hook -->
    <p style="color:#1a1a1a;font-size:20px;line-height:1.45;margin:0 0 10px;font-weight:400">
      You said you&rsquo;d revisit this on ${reviewDateLabel}.
    </p>

    <!-- Decision snippet -->
    <p style="color:#666;font-size:14px;margin:0 0 20px;line-height:1.65;font-style:italic;border-left:2px solid #dddad0;padding-left:14px">
      &ldquo;${decisionSnippet}&rdquo;
    </p>

    ${leaningLine}
    ${switchLine}

    <!-- The question -->
    <p style="color:#1a1a1a;font-size:17px;margin:0 0 32px;line-height:1.5;font-weight:400">
      How&rsquo;s it sitting?
    </p>

    <!-- CTA -->
    <a href="${appUrl}/record/${sessionId}"
       style="display:inline-block;background:#c9a84c;color:#0a0a12;text-decoration:none;
              padding:13px 28px;border-radius:8px;font-size:14px;font-weight:700;
              letter-spacing:0.04em">
      Log what happened &rarr;
    </a>

    <!-- Footer -->
    <p style="color:#bbb;font-size:11px;margin:48px 0 0;line-height:1.7">
      One nudge for the date you chose. No further reminders for this decision.<br>
      <a href="${appUrl}" style="color:#aaa;text-decoration:none">Quorum</a>
    </p>

  </div>
</body>
</html>`
}

// ── Pass A handler — commitment review date ─────────────────────────────────
// Runs before the milestone loop. Sessions it claims are excluded from Pass B
// via the commitment_review_date filter added to the Pass B query below.
async function processReviewDateNudges(
  supabase: ReturnType<typeof createServiceClient>,
  appUrl:   string,
  now:      Date,
): Promise<{ sent: number; skipped: number; errors: number }> {
  let sent = 0, skipped = 0, errors = 0

  const today          = now.toISOString().slice(0, 10) // YYYY-MM-DD
  const lookbackFloor   = new Date(now.getTime() - REVIEW_DATE_LOOKBACK_DAYS * 24 * 3_600_000)
    .toISOString().slice(0, 10)

  const { data: candidates, error: queryErr } = await supabase
    .from('sessions')
    .select('id, user_id, decision_text, commitment_review_date, commitment_leaning, commitment_switch')
    .not('user_id', 'is', null)
    .not('commitment_review_date', 'is', null)
    .lte('commitment_review_date', today)
    .gte('commitment_review_date', lookbackFloor)

  if (queryErr) {
    console.error('[ReanalyzeEmail] Review-date query failed:', queryErr)
    return { sent: 0, skipped: 0, errors: 1 }
  }
  if (!candidates || candidates.length === 0) return { sent: 0, skipped: 0, errors: 0 }

  const sessionIds = candidates.map(s => s.id)

  const [outcomesRes, logRes] = await Promise.all([
    supabase.from('outcomes').select('session_id').in('session_id', sessionIds),
    supabase.from('email_send_log').select('session_id')
      .in('session_id', sessionIds).eq('email_type', REVIEW_DATE_EMAIL_TYPE),
  ])

  const hasOutcome  = new Set((outcomesRes.data ?? []).map(o => o.session_id as string))
  const alreadySent = new Set((logRes.data ?? []).map(l => l.session_id as string))

  const eligible = candidates.filter(s => !hasOutcome.has(s.id) && !alreadySent.has(s.id))

  for (const session of eligible) {
    try {
      const { data: { user }, error: userErr } = await supabase.auth.admin.getUserById(
        session.user_id as string,
      )
      if (userErr || !user?.email) { skipped++; continue }

      const rawDecision = (decrypt(session.decision_text) ?? '').trim()
      if (!rawDecision) { skipped++; continue }

      const leaning = decrypt(session.commitment_leaning as string | null) ?? null
      const switchCondition = decrypt(session.commitment_switch as string | null) ?? null

      const bodySnippet = rawDecision.length > 80
        ? rawDecision.slice(0, 80).trimEnd() + '…'
        : rawDecision
      const subjectSnippet = rawDecision.length > 55
        ? rawDecision.slice(0, 55).trimEnd() + '…'
        : rawDecision

      const reviewDateLabel = new Date(`${session.commitment_review_date}T00:00:00Z`)
        .toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' })

      const subject = `${subjectSnippet} — the date you set to revisit this`
      const html    = buildReviewDateEmailHtml({
        decisionSnippet: bodySnippet,
        reviewDateLabel,
        leaning,
        switchCondition,
        sessionId: session.id,
        appUrl,
      })

      const ok = await sendEmail({ to: user.email, subject, html })
      if (!ok) { errors++; continue }

      const { error: logErr } = await supabase.from('email_send_log').insert({
        user_id:    session.user_id,
        session_id: session.id,
        email_type: REVIEW_DATE_EMAIL_TYPE,
      })
      if (logErr) {
        console.warn(`[ReanalyzeEmail] email_send_log insert failed (review-date) for ${session.id.slice(0, 8)}:`, logErr.message)
      }

      sent++
      console.log(
        `[ReanalyzeEmail] Sent ${REVIEW_DATE_EMAIL_TYPE} → ${user.email.slice(0, 3)}***@*** ` +
        `(session ${session.id.slice(0, 8)})`,
      )

      sendPushToUser(session.user_id as string, {
        title: `Revisit: ${reviewDateLabel}`,
        body:  `"${bodySnippet}" — how's it sitting?`,
        url:   `${appUrl}/record/${session.id}`,
      }).catch(err => console.error('[ReanalyzeEmail] Push failed (review-date):', err))
    } catch (err) {
      console.error(`[ReanalyzeEmail] Unhandled error (review-date) for session ${session.id.slice(0, 8)}:`, err)
      errors++
    }
  }

  return { sent, skipped, errors }
}

// ── Main handler ──────────────────────────────────────────────────────────────
export async function POST(req: Request) {

  // ── 1. Auth ───────────────────────────────────────────────────────────────
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (!cronSecret) {
    console.error('[ReanalyzeEmail] CRON_SECRET env var not set — endpoint disabled')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!authHeader?.startsWith('Bearer ') || authHeader.slice(7) !== cronSecret) {
    console.warn('[ReanalyzeEmail] Unauthorized request — bad or missing CRON_SECRET')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const appUrl   = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.quorumvault.org').replace(/\/$/, '')
  const supabase = createServiceClient()
  const now      = new Date()
  const start    = Date.now()

  let sent = 0, skipped = 0, errors = 0

  // ── 2. Pass A — commitment review date (takes priority when set) ──────────
  const reviewPass = await processReviewDateNudges(supabase, appUrl, now)
  sent    += reviewPass.sent
  skipped += reviewPass.skipped
  errors  += reviewPass.errors

  // ── 3. Pass B — fixed milestones, fallback for sessions with no review date ─
  for (const days of MILESTONES) {
    const emailType: EmailType = `reanalyze_${days}d`

    // ±12h window so daily cron never misses a milestone due to timing drift
    const lower = new Date(now.getTime() - (days * 24 + WINDOW_HOURS) * 3_600_000).toISOString()
    const upper = new Date(now.getTime() - (days * 24 - WINDOW_HOURS) * 3_600_000).toISOString()

    // Find candidate sessions: authenticated user, in time window.
    // commitment_review_date IS NULL — sessions where the user set their own
    // review date are owned entirely by Pass A above; this fixed-milestone
    // pass is the fallback for sessions that never captured one.
    const { data: candidates, error: queryErr } = await supabase
      .from('sessions')
      .select('id, user_id, decision_text, pre_decision_confidence')
      .not('user_id', 'is', null)
      .is('commitment_review_date', null)
      .gte('created_at', lower)
      .lte('created_at', upper)

    if (queryErr) {
      console.error(`[ReanalyzeEmail] Session query failed (${days}d):`, queryErr)
      errors++
      continue
    }
    if (!candidates || candidates.length === 0) continue

    const sessionIds = candidates.map(s => s.id)

    // Fetch in parallel: which sessions already have outcomes or sent emails
    const [outcomesRes, logRes] = await Promise.all([
      supabase
        .from('outcomes')
        .select('session_id')
        .in('session_id', sessionIds),
      supabase
        .from('email_send_log')
        .select('session_id')
        .in('session_id', sessionIds)
        .eq('email_type', emailType),
    ])

    const hasOutcome  = new Set((outcomesRes.data  ?? []).map(o => o.session_id as string))
    const alreadySent = new Set((logRes.data ?? []).map(l => l.session_id as string))

    const eligible = candidates.filter(
      s => !hasOutcome.has(s.id) && !alreadySent.has(s.id),
    )

    // ── 3. Send email for each eligible session ───────────────────────────
    for (const session of eligible) {
      try {
        // Resolve user email via admin API
        const { data: { user }, error: userErr } = await supabase.auth.admin.getUserById(
          session.user_id as string,
        )
        if (userErr || !user?.email) {
          skipped++
          continue
        }

        const email = user.email

        // Decrypt decision text (stored as enc:... in production)
        const rawDecision   = (decrypt(session.decision_text) ?? '').trim()
        if (!rawDecision) { skipped++; continue }

        // Subject: first 55 chars of decision text
        const subjectSnippet = rawDecision.length > 55
          ? rawDecision.slice(0, 55).trimEnd() + '…'
          : rawDecision
        // Body snippet: first 80 chars (quoted)
        const bodySnippet = rawDecision.length > 80
          ? rawDecision.slice(0, 80).trimEnd() + '…'
          : rawDecision

        const subject = `${subjectSnippet} — ${days} days later`
        const html    = buildEmailHtml({
          decisionSnippet: bodySnippet,
          daysAgo:         days,
          confidence:      typeof session.pre_decision_confidence === 'number'
            ? session.pre_decision_confidence
            : null,
          sessionId: session.id,
          appUrl,
        })

        const ok = await sendEmail({ to: email, subject, html })
        if (!ok) { errors++; continue }

        // Log the send — prevents re-sends on future cron runs
        const { error: logErr } = await supabase.from('email_send_log').insert({
          user_id:    session.user_id,
          session_id: session.id,
          email_type: emailType,
        })
        if (logErr) {
          // Duplicate constraint = already sent (race condition). Log and move on.
          console.warn(`[ReanalyzeEmail] email_send_log insert failed for ${session.id.slice(0, 8)}:`, logErr.message)
        }

        sent++
        console.log(
          `[ReanalyzeEmail] Sent ${emailType} → ${email.slice(0, 3)}***@*** ` +
          `(session ${session.id.slice(0, 8)})`,
        )

        // Also fire a push notification (non-blocking — email is the primary channel)
        sendPushToUser(session.user_id as string, {
          title: `${days} days later`,
          body:  `"${bodySnippet}" — how's it sitting?`,
          url:   `${appUrl}/record/${session.id}`,
        }).catch(err => console.error('[ReanalyzeEmail] Push failed:', err))
      } catch (err) {
        console.error(`[ReanalyzeEmail] Unhandled error for session ${session.id.slice(0, 8)}:`, err)
        errors++
      }
    }
  }

  const elapsed_ms = Date.now() - start
  console.log(
    `[ReanalyzeEmail] Pass complete in ${elapsed_ms}ms — ` +
    `sent: ${sent}, skipped: ${skipped}, errors: ${errors}`,
  )

  return NextResponse.json({ ok: true, sent, skipped, errors, elapsed_ms })
}

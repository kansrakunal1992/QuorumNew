// app/api/cron/council-nudge/route.ts
// ── Cron: "Your decision is still open" — Council stall nudge (Natural Intake v4)
//
// POST /api/cron/council-nudge
//
// Auth: Authorization: Bearer <CRON_SECRET>
//
// Called by: cron-job.org — daily at 03:00 UTC (add alongside the existing jobs)
//   URL     : https://app.quorumvault.org/api/cron/council-nudge
//   Method  : POST
//   Header  : Authorization: Bearer <CRON_SECRET>
//   Schedule: 0 3 * * *
//
//   Runs between validation-nudge (02:00 UTC) and daily-nudge (04:00 UTC).
//   It shares the same cross-cron throttle (lib/notification-throttle.ts), so a
//   person who already got a nudge in the shared window is deferred, never
//   double-messaged.
//
// Who gets it (all must hold):
//   • chat-intake session (intake_mode = 'chat') with a saved prediction —
//     the whole point of the message is "we predicted X", so no prediction,
//     no nudge
//   • signed-in user (needs an email + push subscription)
//   • created 24 hours to 7 days ago
//   • the Council never produced a synthesis (no messages row with
//     persona='synthesis', role='assistant') — i.e. they stopped before the
//     end, whether at the checkpoint, at "I'm done", or mid-Council
//   • no final decision locked
//   • council_nudge_sent_at IS NULL (this exact session never nudged)
//   • not opted out (reuses the validation nudge opt-out: both are "check-in"
//     nudges, and the email's unsubscribe link uses the same token type)
//
// One nudge per user per run (their most recent qualifying session).
//
// Needs: supabase/sprint_council_nudge_v4.sql (council_nudge_sent_at).
// Env: RESEND_API_KEY, FROM_EMAIL, CRON_SECRET, NEXT_PUBLIC_APP_URL, VAPID keys
// — all already set for the other nudge crons; nothing new.
//
// Response:
//   200: { ok: true, sent, skipped, deferred, errors, elapsed_ms }
//   401: { error: 'Unauthorized' }
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse }        from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { sendPushToUser }      from '@/lib/push'
import { canSendNudge, recordNudge } from '@/lib/notification-throttle'
import { generateUnsubToken }  from '@/lib/nudge-token'

const MIN_AGE_HOURS = 24
const MAX_AGE_DAYS  = 7

function esc(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

async function sendEmail({ to, subject, html }: { to: string; subject: string; html: string }): Promise<boolean> {
  const apiKey  = process.env.RESEND_API_KEY
  const rawFrom = process.env.FROM_EMAIL ?? 'Quorum <quorum@quorumvault.org>'
  const from    = rawFrom.includes('<') ? rawFrom : `Quorum <${rawFrom.trim()}>`

  if (!apiKey) {
    console.error('[CouncilNudge] RESEND_API_KEY not set — email not sent')
    return false
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method:  'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ from, to, subject, html }),
    })
    if (!res.ok) {
      console.error(`[CouncilNudge] Resend error ${res.status}:`, await res.text().catch(() => '?'))
      return false
    }
    return true
  } catch (err) {
    console.error('[CouncilNudge] Network error sending email:', err)
    return false
  }
}

function buildEmailHtml({ bodyText, sessionUrl, unsubUrl }: { bodyText: string; sessionUrl: string; unsubUrl: string }): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Your decision is still open</title>
</head>
<body style="background:#f5f4f0;margin:0;padding:48px 20px;font-family:'DM Sans',Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased">
  <div style="max-width:480px;margin:0 auto">
    <p style="color:#999;font-size:10px;letter-spacing:0.22em;text-transform:uppercase;margin:0 0 40px;font-family:monospace">
      Quorum &middot; Judgment Record
    </p>
    <p style="color:#1a1a1a;font-size:17px;line-height:1.65;margin:0 0 36px;font-weight:400">
      ${esc(bodyText)}
    </p>
    <a href="${sessionUrl}"
       style="display:inline-block;background:#c9a84c;color:#0a0a12;text-decoration:none;
              padding:13px 28px;border-radius:8px;font-size:14px;font-weight:700;
              letter-spacing:0.04em">
      See what the Council says &rarr;
    </a>
    <p style="color:#bbb;font-size:11px;margin:48px 0 0;line-height:1.8">
      You&rsquo;re receiving this because you use Quorum.<br>
      <a href="${unsubUrl}" style="color:#aaa;text-decoration:underline">Stop these nudges</a>
      &nbsp;&middot;&nbsp;
      <a href="${sessionUrl}" style="color:#aaa;text-decoration:none">Quorum</a>
    </p>
  </div>
</body>
</html>`
}

export async function POST(req: Request) {
  // ── 1. Auth ───────────────────────────────────────────────────────────────
  const cronSecret = process.env.CRON_SECRET
  const authHeader = req.headers.get('authorization')

  if (!cronSecret) {
    console.error('[CouncilNudge] CRON_SECRET env var not set — endpoint disabled')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!authHeader?.startsWith('Bearer ') || authHeader.slice(7) !== cronSecret) {
    console.warn('[CouncilNudge] Unauthorized request')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const appUrl   = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.quorumvault.org').replace(/\/$/, '')
  const supabase = createServiceClient()
  const now      = new Date()
  const start    = Date.now()
  const empty    = () => NextResponse.json({ ok: true, sent: 0, skipped: 0, deferred: 0, errors: 0, elapsed_ms: Date.now() - start })

  let sent = 0, skipped = 0, deferred = 0, errors = 0

  // ── 2. Candidates — predicted, never convened, in the age window ──────────
  const minAgeCutoff = new Date(now.getTime() - MIN_AGE_HOURS * 3_600_000).toISOString()
  const maxAgeCutoff = new Date(now.getTime() - MAX_AGE_DAYS * 24 * 3_600_000).toISOString()

  const { data: candidateRows, error: candErr } = await supabase
    .from('sessions')
    .select('id, user_id, created_at, quorum_predicted_choice')
    .eq('intake_mode', 'chat')
    .not('user_id', 'is', null)
    .not('quorum_predicted_choice', 'is', null)
    .is('final_decision_locked_at', null)
    .is('council_nudge_sent_at', null)
    .lte('created_at', minAgeCutoff)
    .gte('created_at', maxAgeCutoff)
    .order('created_at', { ascending: false })

  if (candErr) {
    console.error('[CouncilNudge] Candidate query failed:', candErr)
    return NextResponse.json({ error: 'DB error' }, { status: 500 })
  }
  if (!candidateRows?.length) return empty()

  // ── 3. Drop sessions where the Council already produced a synthesis ───────
  const candidateIds = candidateRows.map(r => r.id as string)
  const { data: synthesisRows } = await supabase
    .from('messages')
    .select('session_id')
    .in('session_id', candidateIds)
    .eq('persona', 'synthesis')
    .eq('role', 'assistant')

  const withSynthesis = new Set((synthesisRows ?? []).map(r => r.session_id as string))
  const stalled = candidateRows.filter(r => !withSynthesis.has(r.id as string))
  if (!stalled.length) return empty()

  // ── 4. One target per user — most recent stalled session ──────────────────
  const targetByUser = new Map<string, { id: string; predicted: string }>()
  for (const row of stalled) {
    const uid = row.user_id as string
    if (!targetByUser.has(uid)) {
      targetByUser.set(uid, { id: row.id as string, predicted: String(row.quorum_predicted_choice ?? '').trim() })
    }
  }
  const candidateUserIds = [...targetByUser.keys()]

  // ── 5. Opt-out filter (shared with the validation nudge) ──────────────────
  const { data: optedOutRows } = await supabase
    .from('user_preferences')
    .select('user_id')
    .in('user_id', candidateUserIds)
    .eq('validation_nudge_opted_out', true)

  const optedOut    = new Set((optedOutRows ?? []).map(r => r.user_id as string))
  const eligibleIds = candidateUserIds.filter(uid => !optedOut.has(uid))

  console.log(
    `[CouncilNudge] Candidates: ${candidateRows.length}, stalled: ${stalled.length}, ` +
    `unique users: ${candidateUserIds.length}, after opt-out: ${eligibleIds.length}`,
  )

  // ── 6. Send ───────────────────────────────────────────────────────────────
  for (const userId of eligibleIds) {
    try {
      const target = targetByUser.get(userId)!
      if (!target.predicted) { skipped++; continue }

      if (!(await canSendNudge(userId))) { deferred++; continue }

      const { data: authRes } = await supabase.auth.admin.getUserById(userId)
      const email = authRes?.user?.email ?? null
      if (!email) { skipped++; continue }

      const body       = `Your decision is still open. We predicted you'd choose "${target.predicted}". Want to see if the Council agrees?`
      const sessionUrl = `${appUrl}/session/${target.id}`
      const unsubUrl   = `${appUrl}/api/cron/unsubscribe?token=${encodeURIComponent(generateUnsubToken(userId, 'validation'))}`

      const ok = await sendEmail({
        to:      email,
        subject: 'Your decision is still open',
        html:    buildEmailHtml({ bodyText: body, sessionUrl, unsubUrl }),
      })
      if (!ok) { errors++; continue }

      sendPushToUser(userId, {
        title: 'Your decision is still open',
        body:  `We predicted you'd choose "${target.predicted}". See if the Council agrees.`,
        url:   sessionUrl,
      }).catch(err => console.error('[CouncilNudge] Push failed:', err))

      await recordNudge(userId, 'validation_nudge')
      await supabase
        .from('sessions')
        .update({ council_nudge_sent_at: now.toISOString() })
        .eq('id', target.id)

      sent++
    } catch (err) {
      console.error(`[CouncilNudge] Unhandled error for user ${userId.slice(0, 8)}:`, err)
      errors++
    }
  }

  const elapsed_ms = Date.now() - start
  console.log(`[CouncilNudge] Complete in ${elapsed_ms}ms — sent: ${sent}, skipped: ${skipped}, deferred: ${deferred}, errors: ${errors}`)
  return NextResponse.json({ ok: true, sent, skipped, deferred, errors, elapsed_ms })
}

// app/api/cron/validation-nudge/route.ts
// ── Cron: Validation-Pending Re-engagement Nudge ─────────────────────────────
//
// POST /api/cron/validation-nudge
//
// Auth: Authorization: Bearer <CRON_SECRET>
//
// Called by: cron-job.org — daily at 02:00 UTC (07:30 AM IST / 06:00 AM GST)
//   URL     : https://app.quorumvault.org/api/cron/validation-nudge
//   Method  : POST
//   Header  : Authorization: Bearer <CRON_SECRET>
//   Schedule: 0 2 * * *
//
//   Scheduled BEFORE daily-nudge's 04:00 UTC run on purpose — this source
//   takes PRIORITY when both want the same user in the same window. Running
//   first means this claims the shared slot (see lib/notification-throttle.ts)
//   before daily-nudge's later run even checks it.
//
// Targeting (all conditions must pass):
//   • session.user_id IS NOT NULL (authenticated — needs an email + push sub)
//   • session.validation_state = 'pending'
//   • session.validation_nudge_sent_at IS NULL (this exact session never nudged)
//   • session is 7-60 days old (own minimum spacing per the original ask —
//     "at least 7 days" — and a 60-day outer bound so this doesn't reach
//     back into ancient history)
//   • session actually completed synthesis — proven by a messages row with
//     persona='synthesis', role='assistant' for that session_id. Without
//     this check, REDIRECT-blocked sessions (which never run the Council
//     and default to validation_state='pending' at creation since nothing
//     ever moves them out of it) would get nudged about validating an
//     inference that was never made — nonsensical and a trust problem.
//   • validation_nudge_opted_out IS NOT TRUE in user_preferences
//   • canSendNudge(userId) — shared cross-cron gate clear (see above)
//
// One nudge per user per run, even if they have multiple pending sessions —
// targets their single most recent pending+validated-synthesis session.
//
// Content: reuses the 3 existing 'validation_pending' variants in
// lib/nudge-copy.ts (added in SB-1) — no new copy needed. Variant choice is
// deterministic per session id (not per day), since this fires once per
// qualifying session rather than on a daily rotation.
//
// On send: stamps sessions.validation_nudge_sent_at (per-session — so this
// exact session is never re-targeted) and records the shared-gate slot via
// recordNudge() (cross-source — so daily-nudge defers if it's due the same
// window).
//
// Environment variables (all already set — no new vars needed):
//   RESEND_API_KEY, FROM_EMAIL, CRON_SECRET, NEXT_PUBLIC_APP_URL, VAPID keys
//
// Response:
//   200: { ok: true, sent, skipped, deferred, errors, elapsed_ms }
//   401: { error: 'Unauthorized' }
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse }        from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { sendPushToUser }      from '@/lib/push'
import { canSendNudge, recordNudge } from '@/lib/notification-throttle'
import { NUDGE_VARIANTS, resolveVariantTokens } from '@/lib/nudge-copy'
import { generateUnsubToken }  from '@/lib/nudge-token'

// ── Constants ─────────────────────────────────────────────────────────────────
const MIN_AGE_DAYS = 7    // own minimum spacing — never nudge before a session is this old
const MAX_AGE_DAYS = 60   // outer bound — don't reach back into ancient pending sessions

const VALIDATION_VARIANTS = NUDGE_VARIANTS.filter(v => v.theme === 'validation_pending')

// ── Deterministic per-session variant pick (not per-day — this fires once
// per qualifying session, so the rotation axis is the session, not the date) ──
function sessionIdHash(sessionId: string): number {
  let h = 0
  for (let i = 0; i < sessionId.length; i++) {
    h = (Math.imul(31, h) + sessionId.charCodeAt(i)) | 0
  }
  return Math.abs(h)
}

function pickValidationVariant(sessionId: string) {
  const idx = sessionIdHash(sessionId) % VALIDATION_VARIANTS.length
  return VALIDATION_VARIANTS[idx]
}

// ── HTML escape ────────────────────────────────────────────────────────────────
function esc(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// ── Email sender ──────────────────────────────────────────────────────────────
async function sendEmail({
  to, subject, html,
}: {
  to: string; subject: string; html: string
}): Promise<boolean> {
  const apiKey  = process.env.RESEND_API_KEY
  const rawFrom = process.env.FROM_EMAIL ?? 'Quorum <quorum@quorumvault.org>'
  const from    = rawFrom.includes('<') ? rawFrom : `Quorum <${rawFrom.trim()}>`

  if (!apiKey) {
    console.error('[ValidationNudge] RESEND_API_KEY not set — email not sent')
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
      console.error(`[ValidationNudge] Resend error ${res.status}:`, err)
      return false
    }
    return true
  } catch (err) {
    console.error('[ValidationNudge] Network error sending email:', err)
    return false
  }
}

// ── Email template — same light-theme visual language as daily-nudge ─────────
function buildValidationEmailHtml({
  bodyText, sessionUrl, unsubUrl,
}: {
  bodyText:   string
  sessionUrl: string
  unsubUrl:   string
}): string {
  const safeBody = esc(bodyText)

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Validate your last session</title>
</head>
<body style="background:#f5f4f0;margin:0;padding:48px 20px;font-family:'DM Sans',Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased">
  <div style="max-width:480px;margin:0 auto">

    <p style="color:#999;font-size:10px;letter-spacing:0.22em;text-transform:uppercase;margin:0 0 40px;font-family:monospace">
      Quorum &middot; Judgment Record
    </p>

    <p style="color:#1a1a1a;font-size:17px;line-height:1.65;margin:0 0 36px;font-weight:400">
      ${safeBody}
    </p>

    <a href="${sessionUrl}"
       style="display:inline-block;background:#c9a84c;color:#0a0a12;text-decoration:none;
              padding:13px 28px;border-radius:8px;font-size:14px;font-weight:700;
              letter-spacing:0.04em">
      Open your last session &rarr;
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

// ── Main handler ──────────────────────────────────────────────────────────────
export async function POST(req: Request) {

  // ── 1. Auth ───────────────────────────────────────────────────────────────
  const cronSecret = process.env.CRON_SECRET
  const authHeader = req.headers.get('authorization')

  if (!cronSecret) {
    console.error('[ValidationNudge] CRON_SECRET env var not set — endpoint disabled')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!authHeader?.startsWith('Bearer ') || authHeader.slice(7) !== cronSecret) {
    console.warn('[ValidationNudge] Unauthorized request')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const appUrl   = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.quorumvault.org').replace(/\/$/, '')
  const supabase = createServiceClient()
  const now      = new Date()
  const start    = Date.now()

  let sent = 0, skipped = 0, deferred = 0, errors = 0

  // ── 2. Candidate sessions — pending, never nudged, in the age window ──────
  const minAgeCutoff = new Date(now.getTime() - MIN_AGE_DAYS * 24 * 3_600_000).toISOString()
  const maxAgeCutoff = new Date(now.getTime() - MAX_AGE_DAYS * 24 * 3_600_000).toISOString()

  const { data: candidateRows, error: candErr } = await supabase
    .from('sessions')
    .select('id, user_id, created_at')
    .not('user_id', 'is', null)
    .eq('validation_state', 'pending')
    .is('validation_nudge_sent_at', null)
    .lte('created_at', minAgeCutoff)
    .gte('created_at', maxAgeCutoff)
    .order('created_at', { ascending: false })

  if (candErr) {
    console.error('[ValidationNudge] Candidate query failed:', candErr)
    return NextResponse.json({ error: 'DB error' }, { status: 500 })
  }
  if (!candidateRows?.length) {
    return NextResponse.json({ ok: true, sent: 0, skipped: 0, deferred: 0, errors: 0, elapsed_ms: Date.now() - start })
  }

  // ── 3. Exclude sessions that never actually ran synthesis ─────────────────
  // (REDIRECT-blocked sessions default to validation_state='pending' at
  // creation and nothing ever moves them out of it — but the Council never
  // ran, so there's nothing to validate. A messages row with
  // persona='synthesis' is proof synthesis actually completed.)
  const candidateSessionIds = candidateRows.map(r => r.id as string)

  const { data: synthesisRows } = await supabase
    .from('messages')
    .select('session_id')
    .in('session_id', candidateSessionIds)
    .eq('persona', 'synthesis')
    .eq('role', 'assistant')

  const sessionsWithSynthesis = new Set((synthesisRows ?? []).map(r => r.session_id as string))
  const validCandidates = candidateRows.filter(r => sessionsWithSynthesis.has(r.id as string))

  if (validCandidates.length === 0) {
    return NextResponse.json({ ok: true, sent: 0, skipped: 0, deferred: 0, errors: 0, elapsed_ms: Date.now() - start })
  }

  // ── 4. One target session per user — most recent qualifying ───────────────
  const targetByUser = new Map<string, { id: string; created_at: string }>()
  for (const row of validCandidates) {
    const uid = row.user_id as string
    if (!targetByUser.has(uid)) {
      targetByUser.set(uid, { id: row.id as string, created_at: row.created_at as string })
    }
  }

  const candidateUserIds = [...targetByUser.keys()]

  // ── 5. Opt-out filter ──────────────────────────────────────────────────────
  const { data: optedOutRows } = await supabase
    .from('user_preferences')
    .select('user_id')
    .in('user_id', candidateUserIds)
    .eq('validation_nudge_opted_out', true)

  const optedOut    = new Set((optedOutRows ?? []).map(r => r.user_id as string))
  const eligibleIds = candidateUserIds.filter(uid => !optedOut.has(uid))

  console.log(
    `[ValidationNudge] Candidates: ${candidateRows.length}, with synthesis: ${validCandidates.length}, ` +
    `unique users: ${candidateUserIds.length}, after opt-out: ${eligibleIds.length}`,
  )

  if (eligibleIds.length === 0) {
    return NextResponse.json({ ok: true, sent: 0, skipped: 0, deferred: 0, errors: 0, elapsed_ms: Date.now() - start })
  }

  // ── 6. Process each eligible user ──────────────────────────────────────────
  for (const userId of eligibleIds) {
    try {
      const target = targetByUser.get(userId)!

      // ── 6a. Shared cross-cron gate — claimed first since this cron runs
      // earliest in the day (priority over daily-nudge).
      const clearToSend = await canSendNudge(userId)
      if (!clearToSend) {
        deferred++
        continue
      }

      const { data: authRes } = await supabase.auth.admin.getUserById(userId)
      const email = authRes?.user?.email ?? null

      if (!email) {
        console.warn(`[ValidationNudge] No email for user ${userId.slice(0, 8)} — skipping`)
        skipped++
        continue
      }

      const variant  = pickValidationVariant(target.id)
      const resolved = resolveVariantTokens(variant, 0, '') // no tokens used by this theme

      const unsubToken = generateUnsubToken(userId, 'validation')
      const unsubUrl    = `${appUrl}/api/cron/unsubscribe?token=${encodeURIComponent(unsubToken)}`
      const sessionUrl  = `${appUrl}/record/${target.id}`

      const html = buildValidationEmailHtml({ bodyText: resolved.email.body, sessionUrl, unsubUrl })
      const ok   = await sendEmail({ to: email, subject: resolved.email.subject, html })

      if (!ok) {
        errors++
        continue
      }

      sendPushToUser(userId, {
        title: resolved.push.title,
        body:  resolved.push.body,
        url:   sessionUrl,
      }).catch(err => console.error('[ValidationNudge] Push failed:', err))

      // ── 6b. Claim the shared slot + stamp this specific session ─────────
      await recordNudge(userId, 'validation_nudge')

      await supabase
        .from('sessions')
        .update({ validation_nudge_sent_at: now.toISOString() })
        .eq('id', target.id)

      sent++
      console.log(
        `[ValidationNudge] Sent for session ${target.id.slice(0, 8)} → ` +
        `${email.slice(0, 3)}***@*** (user ${userId.slice(0, 8)})`,
      )

    } catch (err) {
      console.error(`[ValidationNudge] Unhandled error for user ${userId.slice(0, 8)}:`, err)
      errors++
    }
  }

  const elapsed_ms = Date.now() - start
  console.log(
    `[ValidationNudge] Complete in ${elapsed_ms}ms — ` +
    `sent: ${sent}, skipped: ${skipped}, deferred (gate): ${deferred}, errors: ${errors}`,
  )

  return NextResponse.json({ ok: true, sent, skipped, deferred, errors, elapsed_ms })
}

// app/api/cron/daily-nudge/route.ts
// ── Cron: Lapsed-User Re-engagement Nudge (formerly "Daily Nudge") ───────────
//
// POST /api/cron/daily-nudge
//
// Auth: Authorization: Bearer <CRON_SECRET>   (same pattern as all cron routes)
//
// Called by: cron-job.org — daily at 04:00 UTC (9:30 AM IST / 8:00 AM GST)
//   URL     : https://app.quorumvault.org/api/cron/daily-nudge
//   Method  : POST
//   Header  : Authorization: Bearer <CRON_SECRET>
//   Schedule: 0 4 * * *   (unchanged — runs AFTER validation-nudge's 02:00 UTC
//             run, so on any day both want the same user, validation-nudge —
//             see app/api/cron/validation-nudge/route.ts — has already
//             claimed the shared slot and this run correctly defers.)
//
// ── Why this changed from literal-daily ──────────────────────────────────────
// The old version fired every single day, forever, to any user who'd gone
// quiet for 24h+ — the 30-variant copy bank was explicitly sized for that
// cadence. In practice that reads as nagging for a product where decisions
// aren't a daily habit. This version sends a DECAYING, CAPPED sequence per
// lapse instead: contact attempts at day 2, 5, 10, and 18 of inactivity,
// then stop entirely until the user logs a new session (which resets the
// clock). Front-loaded while win-back odds are highest, tapering as they
// drop — same logic the existing reanalyze-email 7/14/30 milestone cron
// already uses, applied to a different trigger.
//
// Sequence state lives on user_preferences, NOT a separate log table:
//   • lapse_anchor_session_at — the most-recent-session date this sequence
//     is counting from. If the user's actual most-recent session is NEWER
//     than this anchor, the lapse is over — reset to step 0 automatically,
//     no separate "user came back" webhook needed; this cron re-derives
//     last-session-date fresh every run anyway.
//   • lapse_sequence_step — how many of the 4 sequence attempts have been
//     SENT for the current lapse. >= LAPSE_SEQUENCE_DAYS.length means the
//     sequence is exhausted; no more attempts until a new session resets it.
//
// Targeting (all conditions must pass):
//   • Authenticated user (user_id IS NOT NULL in sessions)
//   • At least 1 session ever, most recent within the 180-day active window
//   • daily_nudge_opted_out IS NOT TRUE in user_preferences
//   • Current days-since-last-session has crossed the NEXT threshold in
//     LAPSE_SEQUENCE_DAYS for that user's current step
//   • canSendNudge(userId) — shared cross-cron gate (lib/notification-throttle.ts)
//     is clear; if another gated source (validation-nudge) claimed the
//     shared slot more recently than SHARED_NUDGE_GATE_DAYS, this run skips
//     and retries next time it's due — the sequence step is NOT consumed by
//     a skip, only by an actual send.
//
// Per-user logic:
//   1. Resolve email via auth.admin.getUserById()
//   2. Get session count (for {{session_count}} token)
//   3. Get top bias via bias_library.user_email (for {{bias_label}} token)
//   4. Deterministically select variant: (dayOfYear + hash(userId)) % eligiblePool
//   5. Resolve personalisation tokens
//   6. Send email + push together as one combo (see lib/notification-throttle.ts —
//      no more "email primary, push best-effort companion": if the gate says
//      send, both go; if it says no, neither does)
//   7. Record the combo in notification_log + advance the sequence step
//
// Copy bank: lib/nudge-copy.ts — 30 variants, 7 themes, reviewed for tone.
// (Originally sized for daily delivery; at this cadence a user sees a new
// variant roughly every 1-3 lapses rather than cycling monthly — still fine,
// just slower rotation than originally planned for.)
//
// Environment variables (all already set — no new vars needed):
//   RESEND_API_KEY, FROM_EMAIL, CRON_SECRET, NEXT_PUBLIC_APP_URL, VAPID keys
//
// Resend free tier: 3,000 emails/month ≈ 100/day.
// If active user count approaches 80+, upgrade Resend plan before this fires.
//
// Response:
//   200: { ok: true, sent, skipped, deferred, errors, elapsed_ms }
//   401: { error: 'Unauthorized' }
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse }        from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { BIAS_PARAMETERS }     from '@/lib/bias-scorer'
import { sendPushToUser }      from '@/lib/push'
import { canSendNudge, recordNudge } from '@/lib/notification-throttle'
import {
  NUDGE_VARIANTS,
  selectNudgeVariant,
  resolveVariantTokens,
  toInlineBiasLabel,
} from '@/lib/nudge-copy'
import { generateUnsubToken }  from '@/lib/nudge-token'

// ── Constants ─────────────────────────────────────────────────────────────────
const ACTIVE_WINDOW_DAYS   = 180  // users with no session in 180d are skipped entirely
const LAPSE_SEQUENCE_DAYS  = [2, 5, 10, 18]  // days-since-last-session thresholds, in order

// ── HTML escape (body text from copy bank is safe, but defence-in-depth) ──────
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
    console.error('[LapseNudge] RESEND_API_KEY not set — email not sent')
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
      console.error(`[LapseNudge] Resend error ${res.status}:`, err)
      return false
    }

    return true
  } catch (err) {
    console.error('[LapseNudge] Network error sending email:', err)
    return false
  }
}

// ── Email template ────────────────────────────────────────────────────────────
// Matches the Quorum email visual language used across all light-themed
// nudge/milestone emails. Deliberately minimal: the nudge copy IS the email.
function buildNudgeEmailHtml({
  bodyText,
  appUrl,
  unsubUrl,
}: {
  bodyText: string
  appUrl:   string
  unsubUrl: string
}): string {
  const safeBody = esc(bodyText)

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Log a decision today</title>
</head>
<body style="background:#f5f4f0;margin:0;padding:48px 20px;font-family:'DM Sans',Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased">
  <div style="max-width:480px;margin:0 auto">

    <!-- Wordmark -->
    <p style="color:#999;font-size:10px;letter-spacing:0.22em;text-transform:uppercase;margin:0 0 40px;font-family:monospace">
      Quorum &middot; Judgment Record
    </p>

    <!-- Nudge copy body -->
    <p style="color:#1a1a1a;font-size:17px;line-height:1.65;margin:0 0 36px;font-weight:400">
      ${safeBody}
    </p>

    <!-- CTA -->
    <a href="${appUrl}"
       style="display:inline-block;background:#c9a84c;color:#0a0a12;text-decoration:none;
              padding:13px 28px;border-radius:8px;font-size:14px;font-weight:700;
              letter-spacing:0.04em">
      Log a decision &rarr;
    </a>

    <!-- Footer -->
    <p style="color:#bbb;font-size:11px;margin:48px 0 0;line-height:1.8">
      You&rsquo;re receiving this because you use Quorum.<br>
      <a href="${unsubUrl}" style="color:#aaa;text-decoration:underline">Stop these nudges</a>
      &nbsp;&middot;&nbsp;
      <a href="${appUrl}" style="color:#aaa;text-decoration:none">Quorum</a>
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
    console.error('[LapseNudge] CRON_SECRET env var not set — endpoint disabled')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!authHeader?.startsWith('Bearer ') || authHeader.slice(7) !== cronSecret) {
    console.warn('[LapseNudge] Unauthorized request — bad or missing CRON_SECRET')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const appUrl   = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.quorumvault.org').replace(/\/$/, '')
  const supabase = createServiceClient()
  const now      = new Date()
  const start    = Date.now()

  let sent = 0, skipped = 0, deferred = 0, errors = 0

  // ── 2. Fetch sessions within active window ────────────────────────────────
  const activeWindowCutoff = new Date(
    now.getTime() - ACTIVE_WINDOW_DAYS * 24 * 3_600_000,
  ).toISOString()

  const { data: sessionRows, error: sessionErr } = await supabase
    .from('sessions')
    .select('user_id, created_at')
    .not('user_id', 'is', null)
    .gte('created_at', activeWindowCutoff)
    .order('created_at', { ascending: false })

  if (sessionErr || !sessionRows) {
    console.error('[LapseNudge] Session query failed:', sessionErr)
    return NextResponse.json({ error: 'DB error' }, { status: 500 })
  }

  // Build Map<userId, mostRecentSessionDate> — first occurrence per user_id
  // is the most recent (rows ordered desc above).
  const userLastSession = new Map<string, Date>()
  for (const row of sessionRows) {
    const uid = row.user_id as string
    if (!userLastSession.has(uid)) {
      userLastSession.set(uid, new Date(row.created_at as string))
    }
  }

  const allUserIds = [...userLastSession.keys()]
  if (allUserIds.length === 0) {
    return NextResponse.json({ ok: true, sent: 0, skipped: 0, deferred: 0, errors: 0, elapsed_ms: Date.now() - start })
  }

  // ── 3. Pull sequence state + opt-out for every active user in one query ───
  const { data: prefRows } = await supabase
    .from('user_preferences')
    .select('user_id, daily_nudge_opted_out, lapse_sequence_step, lapse_anchor_session_at')
    .in('user_id', allUserIds)

  const prefsByUser = new Map(
    (prefRows ?? []).map(r => [r.user_id as string, r]),
  )

  // ── 4. Determine who's actually due for the next step in their sequence ───
  const DAY_MS = 24 * 3_600_000
  const dueUserIds: string[] = []

  for (const userId of allUserIds) {
    const pref = prefsByUser.get(userId)

    if (pref?.daily_nudge_opted_out) continue

    const lastSessionDate = userLastSession.get(userId)!
    const daysSinceSession = Math.floor((now.getTime() - lastSessionDate.getTime()) / DAY_MS)

    const anchor = pref?.lapse_anchor_session_at ? new Date(pref.lapse_anchor_session_at) : null
    const isFreshLapse = !anchor || lastSessionDate.getTime() > anchor.getTime()
    const currentStep  = isFreshLapse ? 0 : (pref?.lapse_sequence_step ?? 0)

    if (currentStep >= LAPSE_SEQUENCE_DAYS.length) continue // sequence exhausted this lapse

    const requiredDays = LAPSE_SEQUENCE_DAYS[currentStep]
    if (daysSinceSession < requiredDays) continue // not due yet

    dueUserIds.push(userId)
  }

  console.log(
    `[LapseNudge] Active: ${allUserIds.length}, due for next sequence step: ${dueUserIds.length}`,
  )

  if (dueUserIds.length === 0) {
    return NextResponse.json({ ok: true, sent: 0, skipped: 0, deferred: 0, errors: 0, elapsed_ms: Date.now() - start })
  }

  // ── 5. Process each due user ───────────────────────────────────────────────
  for (const userId of dueUserIds) {
    try {
      const lastSessionDate = userLastSession.get(userId)!
      const pref = prefsByUser.get(userId)
      const anchor = pref?.lapse_anchor_session_at ? new Date(pref.lapse_anchor_session_at) : null
      const isFreshLapse = !anchor || lastSessionDate.getTime() > anchor.getTime()
      const currentStep  = isFreshLapse ? 0 : (pref?.lapse_sequence_step ?? 0)

      // ── 5a. Shared cross-cron gate — validation-nudge may have already
      // claimed this user's slot this window. Defer, don't consume the step.
      const clearToSend = await canSendNudge(userId)
      if (!clearToSend) {
        deferred++
        continue
      }

      // ── 5b. Resolve email + session count in parallel ──────────────────
      const [authRes, countRes] = await Promise.all([
        supabase.auth.admin.getUserById(userId),
        supabase
          .from('sessions')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', userId),
      ])

      const email        = authRes.data?.user?.email ?? null
      const sessionCount = countRes.count ?? 0

      if (!email) {
        console.warn(`[LapseNudge] No email for user ${userId.slice(0, 8)} — skipping`)
        skipped++
        continue
      }

      // ── 5c. Resolve top bias (bias_library is keyed by user_email) ─────
      const { data: biasRows } = await supabase
        .from('bias_library')
        .select('bias_parameter, detection_count')
        .eq('user_email', email)
        .gte('detection_count', 1)
        .order('detection_count', { ascending: false })
        .limit(1)

      const topBiasKey   = biasRows?.[0]?.bias_parameter as string | undefined
      const rawBiasLabel = topBiasKey
        ? (BIAS_PARAMETERS.find(b => b.key === topBiasKey)?.label ?? null)
        : null
      const inlineBiasLabel = rawBiasLabel ? toInlineBiasLabel(rawBiasLabel) : ''
      const hasBiasLabel    = !!inlineBiasLabel

      // ── 5d. Select variant deterministically ───────────────────────────
      const variant      = selectNudgeVariant(userId, now, hasBiasLabel)
      const variantIndex = NUDGE_VARIANTS.indexOf(variant)
      const resolved     = resolveVariantTokens(variant, sessionCount, inlineBiasLabel)

      // ── 5e. Build + send email ──────────────────────────────────────────
      // NOTE: real path is /api/cron/unsubscribe — fixing a pre-existing
      // bug where this pointed at /api/nudge/unsubscribe, which never existed.
      const unsubToken = generateUnsubToken(userId, 'daily')
      const unsubUrl   = `${appUrl}/api/cron/unsubscribe?token=${encodeURIComponent(unsubToken)}`

      const html = buildNudgeEmailHtml({ bodyText: resolved.email.body, appUrl, unsubUrl })

      const ok = await sendEmail({ to: email, subject: resolved.email.subject, html })

      if (!ok) {
        errors++
        continue
      }

      // ── 5f. Push — sent as part of the same combo, not gated separately ─
      sendPushToUser(userId, {
        title: resolved.push.title,
        body:  resolved.push.body,
        url:   appUrl,
      }).catch(err => console.error('[LapseNudge] Push failed:', err))

      // ── 5g. Claim the shared slot + advance this user's sequence step ──
      await recordNudge(userId, 'daily_nudge')

      await supabase
        .from('user_preferences')
        .upsert(
          {
            user_id: userId,
            lapse_anchor_session_at:    lastSessionDate.toISOString(),
            lapse_sequence_step:        currentStep + 1,
            lapse_sequence_last_sent_at: now.toISOString(),
          },
          { onConflict: 'user_id' },
        )

      sent++
      console.log(
        `[LapseNudge] Sent step ${currentStep + 1}/${LAPSE_SEQUENCE_DAYS.length} ` +
        `(variant #${variantIndex}, ${variant.theme}) → ` +
        `${email.slice(0, 3)}***@*** (user ${userId.slice(0, 8)})`,
      )

    } catch (err) {
      console.error(`[LapseNudge] Unhandled error for user ${userId.slice(0, 8)}:`, err)
      errors++
    }
  }

  const elapsed_ms = Date.now() - start
  console.log(
    `[LapseNudge] Complete in ${elapsed_ms}ms — ` +
    `sent: ${sent}, skipped: ${skipped}, deferred (gate): ${deferred}, errors: ${errors}`,
  )

  return NextResponse.json({ ok: true, sent, skipped, deferred, errors, elapsed_ms })
}

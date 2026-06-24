// app/api/cron/daily-nudge/route.ts
// ── Cron: Daily Decision-Logging Nudge ───────────────────────────────────────
//
// POST /api/cron/daily-nudge
//
// Auth: Authorization: Bearer <CRON_SECRET>   (same pattern as all cron routes)
//
// Called by: cron-job.org — daily at 04:00 UTC (9:30 AM IST / 8:00 AM GST)
//   URL     : https://app.quorumvault.org/api/cron/daily-nudge
//   Method  : POST
//   Header  : Authorization: Bearer <CRON_SECRET>
//   Schedule: 0 4 * * *
//
// Targeting (all conditions must pass):
//   • Authenticated user (user_id IS NOT NULL in sessions)
//   • At least 1 session ever
//   • Most recent session within last 180 days (active window)
//   • No session logged in the last 24h (didn't log today — skip)
//   • No nudge sent in the last 22h (dedup window absorbs cron drift)
//   • daily_nudge_opted_out IS NOT TRUE in user_preferences
//
// Per-user logic:
//   1. Resolve email via auth.admin.getUserById()
//   2. Get session count (for {{session_count}} token)
//   3. Get top bias via bias_library.user_email (for {{bias_label}} token)
//   4. Deterministically select variant: (dayOfYear + hash(userId)) % eligiblePool
//   5. Resolve personalisation tokens
//   6. Send email (primary) via Resend
//   7. Fire push (non-blocking companion) via sendPushToUser()
//   8. Log send to daily_nudge_log
//
// Copy bank: lib/nudge-copy.ts — 30 variants, 7 themes, reviewed for tone.
// TD: Re-review copy mix at 20-user corpus milestone (variant_index analytics).
//
// Environment variables (all already set — no new vars needed):
//   RESEND_API_KEY, FROM_EMAIL, CRON_SECRET, NEXT_PUBLIC_APP_URL, VAPID keys
//
// Resend free tier: 3,000 emails/month ≈ 100/day.
// If active user count approaches 80+, upgrade Resend plan before this fires.
//
// Response:
//   200: { ok: true, sent, skipped, errors, elapsed_ms }
//   401: { error: 'Unauthorized' }
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse }        from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { BIAS_PARAMETERS }     from '@/lib/bias-scorer'
import { sendPushToUser }      from '@/lib/push'
import {
  NUDGE_VARIANTS,
  selectNudgeVariant,
  resolveVariantTokens,
  toInlineBiasLabel,
} from '@/lib/nudge-copy'
import { generateUnsubToken }  from '@/lib/nudge-token'

// ── Constants ─────────────────────────────────────────────────────────────────
const ACTIVE_WINDOW_DAYS  = 180  // users with no session in 180d are skipped
const LOGGED_TODAY_HOURS  = 24   // skip users who logged a decision in last 24h
const NUDGE_COOLDOWN_HOURS = 22  // dedup window — absorbs daily cron timing drift

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
    console.error('[DailyNudge] RESEND_API_KEY not set — email not sent')
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
      console.error(`[DailyNudge] Resend error ${res.status}:`, err)
      return false
    }

    return true
  } catch (err) {
    console.error('[DailyNudge] Network error sending email:', err)
    return false
  }
}

// ── Email template ────────────────────────────────────────────────────────────
// Matches the Quorum email visual language from reanalyze-email.
// Deliberately minimal: the nudge copy IS the email — no feature promos.
// CTA links to the app root to invite a new decision log (not a specific record).
function buildNudgeEmailHtml({
  bodyText,
  appUrl,
  unsubUrl,
}: {
  bodyText: string
  appUrl:   string
  unsubUrl: string
}): string {
  // Body text may contain em-dashes and smart quotes — safe as Unicode in UTF-8 email
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
    console.error('[DailyNudge] CRON_SECRET env var not set — endpoint disabled')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!authHeader?.startsWith('Bearer ') || authHeader.slice(7) !== cronSecret) {
    console.warn('[DailyNudge] Unauthorized request — bad or missing CRON_SECRET')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const appUrl   = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.quorumvault.org').replace(/\/$/, '')
  const supabase = createServiceClient()
  const now      = new Date()
  const start    = Date.now()

  let sent = 0, skipped = 0, errors = 0

  // ── 2. Fetch sessions within active window ────────────────────────────────
  // Get user_id + created_at for all sessions in the last 180 days.
  // Ordered desc so first occurrence per user_id = most recent session.
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
    console.error('[DailyNudge] Session query failed:', sessionErr)
    return NextResponse.json({ error: 'DB error' }, { status: 500 })
  }

  // Build Map<userId, mostRecentSessionDate>
  // First occurrence per user_id is the most recent (ordered desc above).
  const userLastSession = new Map<string, Date>()
  for (const row of sessionRows) {
    const uid = row.user_id as string
    if (!userLastSession.has(uid)) {
      userLastSession.set(uid, new Date(row.created_at as string))
    }
  }

  // ── 3. Filter: skip users who logged a decision in the last 24h ───────────
  const loggedTodayCutoff = new Date(now.getTime() - LOGGED_TODAY_HOURS * 3_600_000)
  const candidates = [...userLastSession.entries()]
    .filter(([, lastDate]) => lastDate < loggedTodayCutoff)
    .map(([uid]) => uid)

  if (candidates.length === 0) {
    console.log('[DailyNudge] No candidates after logged-today filter — exiting early')
    return NextResponse.json({ ok: true, sent: 0, skipped: 0, errors: 0, elapsed_ms: Date.now() - start })
  }

  // ── 4. Dedup: skip users nudged in the last 22h ───────────────────────────
  const cooldownCutoff = new Date(
    now.getTime() - NUDGE_COOLDOWN_HOURS * 3_600_000,
  ).toISOString()

  const { data: recentNudges } = await supabase
    .from('daily_nudge_log')
    .select('user_id')
    .in('user_id', candidates)
    .gte('sent_at', cooldownCutoff)

  const recentlyNudged = new Set((recentNudges ?? []).map(r => r.user_id as string))
  const afterCooldown  = candidates.filter(uid => !recentlyNudged.has(uid))

  // ── 5. Opt-out: skip users who unsubscribed ───────────────────────────────
  const { data: optedOutRows } = await supabase
    .from('user_preferences')
    .select('user_id')
    .in('user_id', afterCooldown)
    .eq('daily_nudge_opted_out', true)

  const optedOut     = new Set((optedOutRows ?? []).map(r => r.user_id as string))
  const eligibleIds  = afterCooldown.filter(uid => !optedOut.has(uid))

  console.log(
    `[DailyNudge] Targeting — active: ${userLastSession.size}, ` +
    `after 24h filter: ${candidates.length}, after cooldown: ${afterCooldown.length}, ` +
    `after opt-out: ${eligibleIds.length}`,
  )

  if (eligibleIds.length === 0) {
    return NextResponse.json({ ok: true, sent: 0, skipped: 0, errors: 0, elapsed_ms: Date.now() - start })
  }

  // ── 6. Process each eligible user ─────────────────────────────────────────
  for (const userId of eligibleIds) {
    try {

      // ── 6a. Resolve email + session count in parallel ──────────────────
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
        console.warn(`[DailyNudge] No email for user ${userId.slice(0, 8)} — skipping`)
        skipped++
        continue
      }

      // ── 6b. Resolve top bias (bias_library is keyed by user_email) ─────
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

      // ── 6c. Select variant deterministically ──────────────────────────
      const variant      = selectNudgeVariant(userId, now, hasBiasLabel)
      const variantIndex = NUDGE_VARIANTS.indexOf(variant) // 0-29 for log
      const resolved     = resolveVariantTokens(variant, sessionCount, inlineBiasLabel)

      // ── 6d. Build + send email ─────────────────────────────────────────
      const unsubToken = generateUnsubToken(userId)
      const unsubUrl   = `${appUrl}/api/nudge/unsubscribe?token=${encodeURIComponent(unsubToken)}`

      const html = buildNudgeEmailHtml({
        bodyText: resolved.email.body,
        appUrl,
        unsubUrl,
      })

      const ok = await sendEmail({ to: email, subject: resolved.email.subject, html })

      if (!ok) {
        errors++
        continue
      }

      // ── 6e. Fire push (non-blocking companion) ─────────────────────────
      sendPushToUser(userId, {
        title: resolved.push.title,
        body:  resolved.push.body,
        url:   appUrl,
      }).catch(err => console.error('[DailyNudge] Push failed:', err))

      // ── 6f. Log the send ───────────────────────────────────────────────
      const { error: logErr } = await supabase
        .from('daily_nudge_log')
        .insert({ user_id: userId, variant_index: variantIndex >= 0 ? variantIndex : 0 })

      if (logErr) {
        // Non-fatal: log and continue. Worst case: user gets a second nudge
        // tomorrow if the row failed to write (unlikely — not a unique constraint).
        console.warn(
          `[DailyNudge] daily_nudge_log insert failed for ${userId.slice(0, 8)}:`,
          logErr.message,
        )
      }

      sent++
      console.log(
        `[DailyNudge] Sent variant #${variantIndex} (${variant.theme}) → ` +
        `${email.slice(0, 3)}***@*** (user ${userId.slice(0, 8)})`,
      )

    } catch (err) {
      console.error(`[DailyNudge] Unhandled error for user ${userId.slice(0, 8)}:`, err)
      errors++
    }
  }

  const elapsed_ms = Date.now() - start
  console.log(
    `[DailyNudge] Complete in ${elapsed_ms}ms — ` +
    `sent: ${sent}, skipped: ${skipped}, errors: ${errors}`,
  )

  return NextResponse.json({ ok: true, sent, skipped, errors, elapsed_ms })
}

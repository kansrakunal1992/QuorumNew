// app/api/cron/mirror-insight-email/route.ts
// ── Cron: Mirror Insight Email (Feature 5 — Engagement Pull) ─────────────────
//
// POST /api/cron/mirror-insight-email
//
// Auth: Authorization: Bearer <CRON_SECRET>
//
// Railway Cron setup:
//   Dashboard → your service → Settings → Cron Jobs → Add Job
//   Schedule : 0 4 * * 1      (Mondays 04:00 UTC = 9:30 AM IST)
//   Command  : curl -s -X POST https://<your-app>.railway.app/api/cron/mirror-insight-email \
//                   -H "Authorization: Bearer $CRON_SECRET"
//
// Target users: teaser state only (≥3 sessions, no Mirror subscription).
//   • Unlocked users are already inside Mirror — email would be redundant.
//   • Locked users (<3 sessions) have nothing to show yet.
//
// Dedup: mirror_insight_email_log table (user_id, sent_at).
//   Skips any user sent an insight email in the last 7 days.
//   SQL to run once in Supabase:
//
//     create table if not exists mirror_insight_email_log (
//       id       uuid        primary key default uuid_generate_v4(),
//       user_id  uuid        references auth.users on delete cascade not null,
//       sent_at  timestamptz not null default now()
//     );
//     create index if not exists idx_mirror_insight_email_log_user
//       on mirror_insight_email_log (user_id);
//     alter table mirror_insight_email_log enable row level security;
//
// Email philosophy: the email IS the Mirror session — not a reminder to open one.
// The bias pattern labels + one-line definitions ARE the value delivered.
// "How does it know this about me?" is the reaction that drives conversion.
//
// Environment variables (already in env.example):
//   RESEND_API_KEY, FROM_EMAIL, CRON_SECRET, NEXT_PUBLIC_APP_URL
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse }        from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { BIAS_PARAMETERS }     from '@/lib/bias-scorer'
import { getMirrorAccessState, TEASER_THRESHOLD } from '@/lib/mirror-access'

// ── Constants ─────────────────────────────────────────────────────────────────
const RESEND_COOLDOWN_DAYS = 7   // never email the same user twice in a week

// ── Bias label → one-line plain-English definition ────────────────────────────
// Uses the first sentence of each bias definition from BIAS_PARAMETERS.
// Keeps email tight — just enough to create the "how does it know this?" reaction.
function getBiasOneLiner(key: string): string {
  const found = BIAS_PARAMETERS.find(b => b.key === key)
  if (!found) return ''
  // First sentence only
  const firstSentence = found.definition.split(/\.\s+/)[0]
  return firstSentence.endsWith('.') ? firstSentence : firstSentence + '.'
}

function getBiasLabel(key: string): string {
  const found = BIAS_PARAMETERS.find(b => b.key === key)
  return found?.label ?? key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

// ── Email sender ──────────────────────────────────────────────────────────────
async function sendEmail({
  to, subject, html,
}: { to: string; subject: string; html: string }): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY
  const from   = process.env.FROM_EMAIL ?? 'Quorum <quorum@quorumvault.org>'

  if (!apiKey) {
    console.error('[MirrorInsightEmail] RESEND_API_KEY not set')
    return false
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, subject, html }),
    })
    if (!res.ok) {
      console.error(`[MirrorInsightEmail] Resend error ${res.status}:`, await res.text().catch(() => '?'))
      return false
    }
    return true
  } catch (err) {
    console.error('[MirrorInsightEmail] Network error:', err)
    return false
  }
}

// ── Email template ────────────────────────────────────────────────────────────
// The bias block IS the value. No preamble marketing. No feature list.
// One sentence per bias — enough to trigger "how does it know this about me?"
function buildInsightEmailHtml({
  sessionCount,
  biasKeys,
  appUrl,
}: {
  sessionCount: number
  biasKeys:     string[]
  appUrl:       string
}): string {
  const patternWord = biasKeys.length === 1 ? 'pattern' : 'patterns'

  const biasRows = biasKeys.map(key => {
    const label    = getBiasLabel(key)
    const oneLiner = getBiasOneLiner(key)
    return `
      <div style="margin-bottom:20px;padding-left:14px;border-left:2px solid #dddad0">
        <p style="color:#c9a84c;font-size:12px;letter-spacing:0.1em;text-transform:uppercase;
                  font-family:monospace;margin:0 0 5px">${label}</p>
        <p style="color:#888;font-size:14px;line-height:1.65;margin:0">${oneLiner}</p>
      </div>`
  }).join('')

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Your Mirror detected ${biasKeys.length} ${patternWord}</title>
</head>
<body style="background:#f5f4f0;margin:0;padding:48px 20px;
             font-family:'DM Sans',Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased">
  <div style="max-width:480px;margin:0 auto">

    <!-- Wordmark -->
    <p style="color:#999;font-size:10px;letter-spacing:0.22em;text-transform:uppercase;
              margin:0 0 40px;font-family:monospace">
      Quorum &middot; Mirror
    </p>

    <!-- Hook -->
    <p style="color:#1a1a1a;font-size:19px;line-height:1.45;margin:0 0 6px;font-weight:400">
      Over your ${sessionCount} decisions, Mirror has been building a picture of how you think.
    </p>
    <p style="color:#666;font-size:13px;margin:0 0 32px;line-height:1.6">
      ${biasKeys.length} ${patternWord} detected so far.
    </p>

    <!-- Bias blocks -->
    ${biasRows}

    <!-- Trust line -->
    <p style="color:#666;font-size:13px;margin:28px 0 32px;line-height:1.65">
      These are your actual patterns &mdash; derived from decisions you&rsquo;ve brought here,
      not a questionnaire.
    </p>

    <!-- CTA -->
    <a href="${appUrl}/mirror"
       style="display:inline-block;background:#c9a84c;color:#0a0a12;text-decoration:none;
              padding:13px 28px;border-radius:8px;font-size:14px;font-weight:700;
              letter-spacing:0.04em">
      Activate Mirror to read your full profile &rarr;
    </a>

    <!-- Footer -->
    <p style="color:#bbb;font-size:11px;margin:48px 0 0;line-height:1.7">
      Weekly insight from your Judgment Record.<br>
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
    console.error('[MirrorInsightEmail] CRON_SECRET not set')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!authHeader?.startsWith('Bearer ') || authHeader.slice(7) !== cronSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const appUrl   = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.quorumvault.org').replace(/\/$/, '')
  const supabase = createServiceClient()
  const start    = Date.now()
  let sent = 0, skipped = 0, errors = 0

  // ── 2. Find all authenticated users with ≥ TEASER_THRESHOLD sessions ──────
  // We check mirror access state per user to confirm they're in 'teaser'.
  // Pull distinct user_ids who have sessions, then filter below.
  const { data: userRows, error: userErr } = await supabase
    .from('sessions')
    .select('user_id')
    .not('user_id', 'is', null)

  if (userErr || !userRows) {
    console.error('[MirrorInsightEmail] Failed to fetch user list:', userErr)
    return NextResponse.json({ error: 'DB error' }, { status: 500 })
  }

  // Deduplicate user_ids
  const allUserIds = [...new Set(userRows.map(r => r.user_id as string))]

  // ── 3. Cooldown check — skip users emailed in last 7 days ─────────────────
  const cutoff = new Date(Date.now() - RESEND_COOLDOWN_DAYS * 24 * 3_600_000).toISOString()

  const { data: recentLog } = await supabase
    .from('mirror_insight_email_log')
    .select('user_id')
    .gte('sent_at', cutoff)

  const recentlySent = new Set((recentLog ?? []).map(r => r.user_id as string))

  // ── 4. Process each eligible user ─────────────────────────────────────────
  for (const userId of allUserIds) {
    if (recentlySent.has(userId)) { skipped++; continue }

    try {
      // Confirm teaser state — skips locked and unlocked users
      const accessState = await getMirrorAccessState(userId, supabase)
      if (accessState !== 'teaser') { skipped++; continue }

      // Session count (for email copy)
      const { count: sessionCount } = await supabase
        .from('sessions')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)

      // Bias keys from bias_library — keyed by user_email
      const { data: { user: authUser } } = await supabase.auth.admin.getUserById(userId)
      const userEmail = authUser?.email ?? null
      if (!userEmail) { skipped++; continue }

      const { data: biasRows } = await supabase
        .from('bias_library')
        .select('bias_parameter, detection_count')
        .eq('user_email', userEmail)
        .order('detection_count', { ascending: false })
        .limit(3)

      const biasKeys = (biasRows ?? []).map(b => b.bias_parameter as string)

      // Nothing to show — skip silently
      if (biasKeys.length === 0) { skipped++; continue }

      const patternWord = biasKeys.length === 1 ? 'pattern' : 'patterns'
      const subject     = `Your Mirror detected ${biasKeys.length} ${patternWord} in your record`
      const html        = buildInsightEmailHtml({
        sessionCount: sessionCount ?? 0,
        biasKeys,
        appUrl,
      })

      const ok = await sendEmail({ to: userEmail, subject, html })
      if (!ok) { errors++; continue }

      // Log the send
      await supabase.from('mirror_insight_email_log').insert({ user_id: userId })

      sent++
      console.log(
        `[MirrorInsightEmail] Sent to ${userEmail.slice(0, 3)}***@*** ` +
        `(userId ${userId.slice(0, 8)}) — ${biasKeys.length} biases`,
      )
    } catch (err) {
      console.error(`[MirrorInsightEmail] Error for userId ${userId.slice(0, 8)}:`, err)
      errors++
    }
  }

  const elapsed_ms = Date.now() - start
  console.log(
    `[MirrorInsightEmail] Done in ${elapsed_ms}ms — ` +
    `sent: ${sent}, skipped: ${skipped}, errors: ${errors}`,
  )

  return NextResponse.json({ ok: true, sent, skipped, errors, elapsed_ms })
}

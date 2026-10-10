// app/api/cron/weekly-brief/route.ts
// -- Cron: weekly "anything you're weighing?" brief (Phase 2, retention work) ---
//
// POST /api/cron/weekly-brief       Authorization: Bearer <CRON_SECRET>
// Suggested schedule (cron-job.org, like the other crons): Sundays 04:00 UTC
//   0 4 * * 0
//
// WHO gets it -- all must hold:
//   o chose "Weekly" in the second-decision card (user_preferences.brief_cadence = 'weekly').
//     Nobody is enrolled by default; "only when I'm stuck" / "only for big
//     decisions" are real choices that mean no weekly email.
//   o weekly_brief_opted_out is not true (one-click unsubscribe in the email).
//   o has made a decision, but NOT in the last 3 days (already engaged -- do not nag).
//   o has not been sent a weekly brief in the last 6 days.
//   o the shared nudge gate is clear (lib/notification-throttle.ts, 3 days), so this
//     can never land back-to-back with a daily/validation nudge.
//
// WHAT it says: one question, the "when" they named in the cue (if any), and up
// to three open Watchlist items -- as plain text. Parked text is NEVER put in a
// URL; the single CTA goes to /q (opens the app with the input focused).
//
// Response: { ok, sent, skipped, deferred, errors, elapsed_ms }

import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { sendPushToUser } from '@/lib/push'
import { canSendNudge, recordNudge } from '@/lib/notification-throttle'
import { generateUnsubToken } from '@/lib/nudge-token'
import { buildSimpleEmailHtml, sendEmail } from '@/lib/cron-email'
import { decrypt } from '@/lib/encryption'
import { isWatchlistEnabled } from '@/lib/feature-flags'

const MAX_USERS_PER_RUN = 500
const QUIET_AFTER_SESSION_DAYS = 3
const MIN_DAYS_BETWEEN_BRIEFS  = 6

// Second person, because the email speaks to them (the chips are first person).
const CUE_PHRASE: Record<string, string> = {
  before_buying:    'before you buy something',
  stalling_message: "when you're stalling on a message",
  sunday_planning:  'when you plan your week',
  when_stuck:       "when you notice you're stuck",
}

function clip(text: string, n = 90): string {
  const t = text.trim().replace(/\s+/g, ' ')
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}\u2026` : t
}

export async function POST(req: Request) {
  const cronSecret = process.env.CRON_SECRET
  const authHeader = req.headers.get('authorization')
  if (!cronSecret || !authHeader?.startsWith('Bearer ') || authHeader.slice(7) !== cronSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const appUrl   = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.quorumvault.org').replace(/\/$/, '')
  const supabase = createServiceClient()
  const now      = Date.now()
  const started  = now
  let sent = 0, skipped = 0, deferred = 0, errors = 0

  const { data: prefs, error: prefsErr } = await supabase
    .from('user_preferences')
    .select('user_id, user_email, next_decision_cue')
    .eq('brief_cadence', 'weekly')
    .eq('weekly_brief_opted_out', false)
    .limit(MAX_USERS_PER_RUN)

  if (prefsErr) {
    console.error('[WeeklyBrief] preferences query failed:', prefsErr.message)
    return NextResponse.json({ ok: false, error: 'query failed' }, { status: 500 })
  }

  for (const p of prefs ?? []) {
    const userId = p.user_id as string
    try {
      // -- already briefed this week? ---------------------------------------
      const since = new Date(now - MIN_DAYS_BETWEEN_BRIEFS * 86_400_000).toISOString()
      const { data: recent } = await supabase
        .from('notification_log').select('id')
        .eq('user_id', userId).eq('source', 'weekly_brief').gte('sent_at', since).limit(1)
      if (recent?.length) { skipped++; continue }

      // -- has decisions, but not so recently that this would be a nag -------
      const { data: last } = await supabase
        .from('sessions').select('created_at')
        .eq('user_id', userId).order('created_at', { ascending: false }).limit(1)
      if (!last?.length) { skipped++; continue }
      const daysSince = (now - new Date(last[0].created_at as string).getTime()) / 86_400_000
      if (daysSince < QUIET_AFTER_SESSION_DAYS) { skipped++; continue }

      if (!(await canSendNudge(userId))) { deferred++; continue }

      // -- address ------------------------------------------------------------
      let email = (p.user_email as string | null) ?? null
      if (!email) {
        const { data: u } = await supabase.auth.admin.getUserById(userId)
        email = u?.user?.email ?? null
      }
      if (!email) { skipped++; continue }

      // -- parked items (plain text only) -------------------------------------
      let items: string[] = []
      if (isWatchlistEnabled()) {
        const { data: w } = await supabase
          .from('watchlist_items').select('text_encrypted')
          .eq('user_id', userId).eq('status', 'open')
          .order('created_at', { ascending: false }).limit(3)
        items = (w ?? [])
          .map(r => decrypt(r.text_encrypted as string) ?? '')
          .filter(Boolean)
          .map(t => clip(t))
      }

      const cuePhrase = p.next_decision_cue ? CUE_PHRASE[p.next_decision_cue as string] : null
      const detail = cuePhrase
        ? `You said you'd bring one here ${cuePhrase}. This is that moment, if it has come up.`
        : null

      const unsubToken = generateUnsubToken(userId, 'weekly')
      const unsubUrl   = `${appUrl}/api/cron/unsubscribe?token=${encodeURIComponent(unsubToken)}`
      const html = buildSimpleEmailHtml({
        title:      "Anything you're weighing this week?",
        lead:       "Anything you're weighing this week?",
        detail,
        listLabel:  items.length ? 'On your list' : null,
        listItems:  items,
        ctaLabel:   'Bring me one',
        ctaUrl:     `${appUrl}/q?n=weekly_brief`,
        appUrl,
        unsubUrl,
        unsubLabel: 'Stop the weekly brief',
      })

      const ok = await sendEmail({ to: email, subject: "Anything you're weighing this week?", html, tag: 'WeeklyBrief' })
      if (!ok) { errors++; continue }

      sendPushToUser(userId, {
        title: "Anything you're weighing this week?",
        body:  items.length ? `${items.length} on your list. Bring one to Quorum.` : 'Bring one to Quorum.',
        url:   `${appUrl}/q?n=weekly_brief`,
      }).catch(err => console.error('[WeeklyBrief] Push failed:', err))

      await recordNudge(userId, 'weekly_brief')
      sent++
    } catch (err) {
      console.error(`[WeeklyBrief] unhandled error for user ${userId.slice(0, 8)}:`, err)
      errors++
    }
  }

  return NextResponse.json({ ok: true, sent, skipped, deferred, errors, elapsed_ms: Date.now() - started })
}

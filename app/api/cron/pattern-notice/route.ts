// app/api/cron/pattern-notice/route.ts
// -- Cron: event-driven "Quorum noticed something" email (Phase 3, retention work) -
//
// POST /api/cron/pattern-notice     Authorization: Bearer <CRON_SECRET>
// Suggested schedule: daily, after the other nudge crons (e.g. 05:00 UTC).
//
// EVENT-DRIVEN, NOT SCHEDULED: runs daily but only ever looks at people who
// logged a decision in the last 2 days, and only sends when a NEW finding
// appears that has never been emailed to them (pattern_notice_log, unique per
// user + finding key). No new decision -> nothing to say -> no email.
//
// WHAT counts as a finding (lib/cross-decision-observations.ts -- deterministic,
// counts-only, no model-written text):
//   o priority repeat   -- same "what matters most" in >=3 of the last >=4 decisions
//   o instinct pattern  -- followed (or overrode) the first instinct in >=75% / <=25% of >=4
// The prediction record is excluded (it already has its own line in the app).
//
// GUARDS: >=4 decisions; pattern_notice_opted_out not true; at most one pattern
// email per 14 days; shared nudge gate (3 days) must be clear.
//
// Response: { ok, sent, skipped, deferred, errors, elapsed_ms }

import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { sendPushToUser } from '@/lib/push'
import { canSendNudge, recordNudge } from '@/lib/notification-throttle'
import { generateUnsubToken } from '@/lib/nudge-token'
import { buildSimpleEmailHtml, sendEmail } from '@/lib/cron-email'
import { loadDecisionRows } from '@/lib/decision-history'
import { computeObservations, type Observation } from '@/lib/cross-decision-observations'

const MAX_CANDIDATES      = 300
const MIN_DECISIONS       = 4
const MIN_DAYS_BETWEEN    = 14

// Keys are `priority:<value>:<count>` and `instinct:<followed>:<n>` (see
// lib/cross-decision-observations.ts), so the sample size is read from the key.
function strongEnough(o: Observation): boolean {
  const parts = o.key.split(':')
  if (o.kind === 'priority_repeat') return Number(parts[2]) >= 3 && o.strength >= 0.6
  if (o.kind === 'instinct_follow') return Number(parts[2]) >= MIN_DECISIONS && o.strength >= 0.5
  return false
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
  let sent = 0, skipped = 0, deferred = 0, errors = 0

  // Only people with a brand-new decision can have a brand-new finding.
  const since = new Date(now - 2 * 86_400_000).toISOString()
  const { data: recent, error } = await supabase
    .from('sessions').select('user_id')
    .not('user_id', 'is', null).gte('created_at', since).limit(MAX_CANDIDATES * 3)
  if (error) {
    console.error('[PatternNotice] candidate query failed:', error.message)
    return NextResponse.json({ ok: false, error: 'query failed' }, { status: 500 })
  }
  const candidates = Array.from(new Set((recent ?? []).map(r => r.user_id as string))).slice(0, MAX_CANDIDATES)

  for (const userId of candidates) {
    try {
      const { data: pref } = await supabase
        .from('user_preferences').select('user_email, pattern_notice_opted_out').eq('user_id', userId).maybeSingle()
      if (pref?.pattern_notice_opted_out) { skipped++; continue }

      const rows = await loadDecisionRows(supabase, { userId }, { limit: 12 })
      if (rows.length < MIN_DECISIONS) { skipped++; continue }

      const finding = computeObservations(rows, { window: 8 })
        .filter(strongEnough)
        .sort((a, b) => b.strength - a.strength)[0]
      if (!finding) { skipped++; continue }

      const { data: seen } = await supabase
        .from('pattern_notice_log').select('id').eq('user_id', userId).eq('pattern_key', finding.key).limit(1)
      if (seen?.length) { skipped++; continue }

      const cutoff = new Date(now - MIN_DAYS_BETWEEN * 86_400_000).toISOString()
      const { data: lately } = await supabase
        .from('pattern_notice_log').select('id').eq('user_id', userId).gte('sent_at', cutoff).limit(1)
      if (lately?.length) { skipped++; continue }

      if (!(await canSendNudge(userId))) { deferred++; continue }

      let email = (pref?.user_email as string | null) ?? null
      if (!email) {
        const { data: u } = await supabase.auth.admin.getUserById(userId)
        email = u?.user?.email ?? null
      }
      if (!email) { skipped++; continue }

      const unsubToken = generateUnsubToken(userId, 'pattern')
      const html = buildSimpleEmailHtml({
        title:      'Quorum noticed something',
        lead:       'Quorum noticed something across your decisions.',
        detail:     finding.line,
        ctaLabel:   'See what Quorum noticed',
        ctaUrl:     `${appUrl}/mirror`,
        appUrl,
        unsubUrl:   `${appUrl}/api/cron/unsubscribe?token=${encodeURIComponent(unsubToken)}`,
        unsubLabel: 'Stop these emails',
      })

      // Claim this finding BEFORE sending. The unique (user_id, pattern_key)
      // constraint makes "never twice" hold even if two runs overlap; if the
      // claim cannot be written for any reason (including the table not
      // existing yet), do not send -- fail closed rather than risk repeats.
      const { error: claimErr } = await supabase.from('pattern_notice_log').insert({ user_id: userId, pattern_key: finding.key })
      if (claimErr) {
        if (claimErr.code !== '23505') console.warn('[PatternNotice] claim failed, not sending:', claimErr.message)
        skipped++
        continue
      }

      const ok = await sendEmail({ to: email, subject: 'Quorum noticed something across your decisions', html, tag: 'PatternNotice' })
      if (!ok) {
        // Release the claim so the finding is retried on the next run.
        await supabase.from('pattern_notice_log').delete().eq('user_id', userId).eq('pattern_key', finding.key)
        errors++
        continue
      }

      sendPushToUser(userId, {
        title: 'Quorum noticed something',
        body:  finding.line,
        url:   `${appUrl}/mirror`,
      }).catch(err => console.error('[PatternNotice] Push failed:', err))

      await recordNudge(userId, 'pattern_notice')
      sent++
    } catch (err) {
      console.error(`[PatternNotice] unhandled error for user ${userId.slice(0, 8)}:`, err)
      errors++
    }
  }

  return NextResponse.json({ ok: true, sent, skipped, deferred, errors, elapsed_ms: Date.now() - now })
}

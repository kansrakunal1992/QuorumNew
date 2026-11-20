// app/api/cron/gtm-lifecycle/route.ts
// ── Cron: automatic lifecycle emails from the GTM OS ─────────────────────────
//
// POST /api/cron/gtm-lifecycle            (Authorization: Bearer <CRON_SECRET>)
// POST /api/cron/gtm-lifecycle?dry=1      → computes who WOULD be emailed; sends and writes nothing
//
// Called by: cron-job.org, daily (suggest 05:30 UTC = 11:00 IST, AFTER validation-nudge 02:00 and daily-nudge 04:00 so those keep priority
//            for the shared per-user gate in lib/notification-throttle.ts).
//
// Safety (all enforced here, none delegated to the GTM OS):
//   • OFF unless GTM_LIFECYCLE_ENABLED=true.
//   • Programs come from public.gtm_outbox (written by the GTM OS through a write-only role). Only copy + a segment KEY crosses over:
//     links are restricted to paths inside this app (lib/gtm-lifecycle.ts), copy is sanitised, the email carries a one-click unsubscribe.
//   • Opted-out users (user_preferences.lifecycle_opted_out), users already assigned to the program, and users emailed by ANY program within
//     cooldown_days are excluded inside the SQL function gtm_segment_users().
//   • The shared 3-day gate (canSendNudge) applies, so nobody gets two nudges back-to-back from different crons.
//   • Eligibility is decided BEFORE the holdout draw, so the delivered and holdout groups are comparable. Holdout users are recorded, never emailed.
//   • Per-program max_per_run and a global GTM_LIFECYCLE_DAILY_CAP (default 100) bound the volume. Programs stop at ends_at (default 45 days).
//   • A claim row (unique on program+user) is written BEFORE the send, so a retry or a second cron run can never double-send.
//
// Environment: RESEND_API_KEY, FROM_EMAIL, CRON_SECRET, NEXT_PUBLIC_APP_URL (all existing) + GTM_LIFECYCLE_ENABLED, GTM_LIFECYCLE_DAILY_CAP (new).
//
// Response: 200 { ok, dry, disabled?, programs, sent, holdout, deferred, skipped, errors, elapsed_ms }  |  401 { error }

import { NextResponse }        from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { canSendNudge, recordNudge } from '@/lib/notification-throttle'
import { generateUnsubToken }  from '@/lib/nudge-token'
import { buildSimpleEmailHtml, sendEmail } from '@/lib/cron-email'
import {
  buildCtaUrl, isHoldout, normalizeVariants, parseCap, pickVariantIndex, remainingDailyCap, safeSlug,
} from '@/lib/gtm-lifecycle'

const CANDIDATE_BATCH = 500

type Program = {
  id: string; slug: string; segment_key: string; holdout_pct: number
  max_per_run: number; cooldown_days: number; status: string; copy_variants: unknown
}

export async function POST(req: Request) {
  // ── 1. Auth (same pattern as the other crons) ─────────────────────────────
  const cronSecret = process.env.CRON_SECRET
  const authHeader = req.headers.get('authorization')
  if (!cronSecret) {
    console.error('[GtmLifecycle] CRON_SECRET env var not set — endpoint disabled')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!authHeader?.startsWith('Bearer ') || authHeader.slice(7) !== cronSecret) {
    console.warn('[GtmLifecycle] Unauthorized request')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const start = Date.now()
  const dry   = new URL(req.url).searchParams.get('dry') === '1'
  if (process.env.GTM_LIFECYCLE_ENABLED !== 'true') {
    return NextResponse.json({ ok: true, dry, disabled: true, note: 'Set GTM_LIFECYCLE_ENABLED=true to turn this on.' })
  }

  const appUrl   = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.quorumvault.org').replace(/\/$/, '')
  const supabase = createServiceClient()
  const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0)

  let sent = 0, holdout = 0, deferred = 0, skipped = 0, errors = 0, programsRun = 0

  // ── 2. Global daily cap ────────────────────────────────────────────────────
  const { count: sentTodayRaw, error: capErr } = await supabase
    .from('gtm_lifecycle_sends').select('id', { count: 'exact', head: true })
    .eq('status', 'sent').gte('sent_at', dayStart.toISOString())
  if (capErr) {
    console.error('[GtmLifecycle] daily-cap query failed — failing closed:', capErr.message)
    return NextResponse.json({ error: 'DB error' }, { status: 500 })
  }
  let remaining = remainingDailyCap(sentTodayRaw ?? 0, parseCap(process.env.GTM_LIFECYCLE_DAILY_CAP, 100))

  // ── 3. Live programs ─────────────────────────────────────────────────────────
  const { data: programs, error: progErr } = await supabase
    .from('gtm_outbox')
    .select('id, slug, segment_key, holdout_pct, max_per_run, cooldown_days, status, copy_variants')
    .in('status', ['pending', 'active'])
    .gt('ends_at', new Date().toISOString())
    .order('created_at', { ascending: true })
  if (progErr) {
    console.error('[GtmLifecycle] program query failed:', progErr.message)
    return NextResponse.json({ error: 'DB error' }, { status: 500 })
  }

  for (const program of (programs ?? []) as Program[]) {
    const variants = normalizeVariants(program.copy_variants)
    if (variants.length === 0) { console.warn(`[GtmLifecycle] ${program.slug}: no usable copy variants — skipped`); skipped++; continue }
    programsRun++
    if (!dry && program.status === 'pending') {
      await supabase.from('gtm_outbox').update({ status: 'active' }).eq('id', program.id).eq('status', 'pending')
    }

    // ── 4. Candidates (exclusions are applied inside the SQL function) ─────────
    const { data: cands, error: candErr } = await supabase.rpc('gtm_segment_users', {
      p_segment: program.segment_key, p_program: program.id, p_cooldown_days: program.cooldown_days, p_limit: CANDIDATE_BATCH,
    })
    if (candErr) { console.error(`[GtmLifecycle] ${program.slug}: segment query failed:`, candErr.message); errors++; continue }

    let sentThisProgram = 0
    for (const row of (cands ?? []) as { user_id: string }[]) {
      if (remaining <= 0 || sentThisProgram >= program.max_per_run) break
      const userId = row.user_id
      try {
        // 4a. Shared cross-cron gate — decided BEFORE the arm so both arms are drawn from the same eligible pool.
        if (!(await canSendNudge(userId))) { deferred++; continue }

        const arm = isHoldout(userId, program.id, program.holdout_pct) ? 'holdout' : 'delivered'

        if (arm === 'holdout') {
          if (dry) { holdout++; continue }
          const { error } = await supabase.from('gtm_lifecycle_sends')
            .insert({ program_id: program.id, user_id: userId, arm: 'holdout', status: 'holdout' })
          if (error && error.code !== '23505') { console.error(`[GtmLifecycle] holdout insert failed:`, error.message); errors++ } else holdout++
          continue
        }

        // 4b. Delivered arm: email address (never leaves this function), then claim → send → confirm.
        const { data: authRes } = await supabase.auth.admin.getUserById(userId)
        const email = authRes?.user?.email ?? null
        if (!email) { skipped++; continue }
        if (dry) { sent++; sentThisProgram++; remaining--; continue }

        const variantIdx = pickVariantIndex(userId, program.id, variants.length)
        const v          = variants[variantIdx]
        const { error: claimErr } = await supabase.from('gtm_lifecycle_sends')
          .insert({ program_id: program.id, user_id: userId, arm: 'delivered', status: 'claimed', variant: variantIdx })
        if (claimErr) { if (claimErr.code !== '23505') { console.error('[GtmLifecycle] claim failed:', claimErr.message); errors++ } else skipped++; continue }

        const slug     = safeSlug(program.slug)
        const unsubUrl = `${appUrl}/api/cron/unsubscribe?token=${encodeURIComponent(generateUnsubToken(userId, 'lifecycle'))}`
        const html = buildSimpleEmailHtml({
          title: v.subject, lead: v.lead, detail: v.detail, listLabel: v.listLabel, listItems: v.listItems,
          ctaLabel: v.ctaLabel, ctaUrl: buildCtaUrl(appUrl, v.ctaPath, slug), appUrl, unsubUrl, unsubLabel: 'Stop these emails',
        })
        const ok = await sendEmail({ to: email, subject: v.subject, html, tag: 'GtmLifecycle' })
        if (!ok) {
          await supabase.from('gtm_lifecycle_sends').delete().eq('program_id', program.id).eq('user_id', userId).eq('status', 'claimed')  // not sent → eligible again next run
          errors++
          continue
        }
        await supabase.from('gtm_lifecycle_sends').update({ status: 'sent', sent_at: new Date().toISOString() })
          .eq('program_id', program.id).eq('user_id', userId)
        await recordNudge(userId, 'gtm_lifecycle')
        sent++; sentThisProgram++; remaining--
      } catch (err) {
        console.error(`[GtmLifecycle] unhandled error for user ${userId.slice(0, 8)}:`, err)
        errors++
      }
    }
  }

  const elapsed_ms = Date.now() - start
  console.log(`[GtmLifecycle] ${dry ? 'DRY RUN ' : ''}programs: ${programsRun}, sent: ${sent}, holdout: ${holdout}, deferred: ${deferred}, skipped: ${skipped}, errors: ${errors}, ${elapsed_ms}ms`)
  return NextResponse.json({ ok: true, dry, programs: programsRun, sent, holdout, deferred, skipped, errors, elapsed_ms })
}

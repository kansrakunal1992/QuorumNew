// app/api/cron/avoidance-detect/route.ts
// ── Cron: R11 Avoidance Detection Pass (Sprint D2) ───────────────────────────
//
// POST /api/cron/avoidance-detect
//
// Auth: Authorization: Bearer <CRON_SECRET>
//   CRON_SECRET is a Railway environment variable (add to .env.example + Railway
//   Variables panel). Missing or wrong token → 401, logged, no detection runs.
//   Same pattern as /api/admin/dashboard (ADMIN_CODE).
//
// Called by: Railway Cron Job — daily at 02:00 UTC.
//   Railway Dashboard → your service → Settings → Cron Jobs:
//     Schedule: 0 2 * * *
//     Command:  curl -s -X POST https://<your-app>.railway.app/api/cron/avoidance-detect \
//                    -H "Authorization: Bearer $CRON_SECRET"
//
// On-demand (D3 Mirror surface — single user):
//   POST body: { userId: "<uuid>" }
//   Used by D3 to trigger a fresh detection pass for a specific user when
//   they open the Mirror, ensuring alerts are current before display.
//   Same auth required.
//
// Response:
//   200: { ok: true, detected, skipped, errors, elapsed_ms }
//   401: { error: 'Unauthorized' }
//   500: { error: 'Internal error', detail: string }
//
// Non-fatal: runAvoidanceDetectionPass always resolves. Any internal errors
// are counted in `errors` and logged but do not cause a 5xx response unless
// the function itself throws (which it should not — see avoidance-detector.ts).
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse }                 from 'next/server'
import { runAvoidanceDetectionPass }    from '@/lib/avoidance-detector'

export async function POST(req: Request) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (!cronSecret) {
    // Misconfigured environment — refuse to run silently
    console.error('[CronAvoidance] CRON_SECRET env var not set — endpoint disabled')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!authHeader?.startsWith('Bearer ') || authHeader.slice(7) !== cronSecret) {
    console.warn('[CronAvoidance] Unauthorized request — bad or missing CRON_SECRET')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // ── Parse optional userId (on-demand path for D3) ────────────────────────
  let targetUserId: string | undefined

  try {
    const body = await req.json().catch(() => ({}))
    if (body && typeof body.userId === 'string' && body.userId.length > 0) {
      targetUserId = body.userId
    }
  } catch {
    // Body parse failure → treat as full cron pass (no userId)
  }

  // ── Run detection ─────────────────────────────────────────────────────────
  const start = Date.now()

  try {
    const result = await runAvoidanceDetectionPass(targetUserId)
    const elapsed_ms = Date.now() - start

    console.log(
      `[CronAvoidance] Pass complete in ${elapsed_ms}ms — ` +
      `detected: ${result.detected}, skipped: ${result.skipped}, errors: ${result.errors}` +
      (targetUserId ? ` (on-demand: ${targetUserId.slice(0, 8)})` : ' (full cron pass)'),
    )

    return NextResponse.json({
      ok:         true,
      detected:   result.detected,
      skipped:    result.skipped,
      errors:     result.errors,
      elapsed_ms,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[CronAvoidance] Unexpected error:', message)
    return NextResponse.json({ error: 'Internal error', detail: message }, { status: 500 })
  }
}

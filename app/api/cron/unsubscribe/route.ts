// app/api/cron/unsubscribe/route.ts
// ── One-click unsubscribe for nudge emails (daily + validation) ──────────────
//
// GET /api/cron/unsubscribe?token=<signedToken>
//
// No auth required — the signed token is the credential.
// Token formats — see lib/nudge-token.ts:
//   legacy 'daily' type : `{userId}.{hmac}`
//   typed (e.g. 'validation') : `{userId}.{type}.{hmac}`
// Verified via HMAC-SHA256, timing-safe compare.
//
// On valid token:
//   • type='daily'      → sets user_preferences.daily_nudge_opted_out = true
//   • type='validation' → sets user_preferences.validation_nudge_opted_out = true
//   • Returns a minimal HTML confirmation page (no redirect needed)
//
// On invalid/missing token:
//   • Returns 400 with a plain error page (no information leaked)
//
// Idempotent: calling twice is safe — upsert sets the column regardless.
//
// Note: if CRON_SECRET ever rotates, existing unsubscribe links in already-sent
// emails will return 400. Users can reply to email as fallback. Low risk at
// current scale.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse }        from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { verifyUnsubToken }    from '@/lib/nudge-token'

// ── HTML responses ────────────────────────────────────────────────────────────

function confirmedHtml(appUrl: string, type: 'daily' | 'validation'): string {
  const message = type === 'validation'
    ? "You won&rsquo;t receive validation check-in nudges anymore."
    : "You won&rsquo;t receive daily nudges anymore."

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Unsubscribed — Quorum</title>
</head>
<body style="background:#f5f4f0;margin:0;padding:80px 20px;font-family:'DM Sans',Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased">
  <div style="max-width:400px;margin:0 auto;text-align:center">

    <p style="color:#999;font-size:10px;letter-spacing:0.22em;text-transform:uppercase;margin:0 0 40px;font-family:monospace">
      Quorum &middot; Judgment Record
    </p>

    <p style="color:#1a1a1a;font-size:20px;font-weight:400;margin:0 0 16px;line-height:1.4">
      You&rsquo;re unsubscribed.
    </p>

    <p style="color:#888;font-size:14px;margin:0 0 40px;line-height:1.6">
      ${message}<br>
      Your record and all your decisions are still there.
    </p>

    <a href="${appUrl}"
       style="display:inline-block;background:#c9a84c;color:#0a0a12;text-decoration:none;
              padding:12px 24px;border-radius:8px;font-size:13px;font-weight:700;
              letter-spacing:0.04em">
      Back to Quorum &rarr;
    </a>

  </div>
</body>
</html>`
}

function errorHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Invalid link — Quorum</title>
</head>
<body style="background:#f5f4f0;margin:0;padding:80px 20px;font-family:'DM Sans',Helvetica,Arial,sans-serif">
  <div style="max-width:400px;margin:0 auto;text-align:center">
    <p style="color:#999;font-size:10px;letter-spacing:0.22em;text-transform:uppercase;margin:0 0 40px;font-family:monospace">
      Quorum &middot; Judgment Record
    </p>
    <p style="color:#1a1a1a;font-size:18px;font-weight:400;margin:0 0 16px">
      This link is no longer valid.
    </p>
    <p style="color:#888;font-size:14px;margin:0 0 40px;line-height:1.6">
      It may have expired or already been used.<br>
      Reply to any Quorum email to stop nudges manually.
    </p>
  </div>
</body>
</html>`
}

// ── Handler ───────────────────────────────────────────────────────────────────
export async function GET(req: Request) {
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.quorumvault.org').replace(/\/$/, '')

  // ── 1. Extract + verify token ─────────────────────────────────────────────
  const { searchParams } = new URL(req.url)
  const token  = searchParams.get('token') ?? ''
  const result = verifyUnsubToken(token)

  if (!result) {
    console.warn('[NudgeUnsub] Invalid or missing token')
    return new NextResponse(errorHtml(), {
      status: 400,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
  }

  const { userId, type } = result

  // ── 2. Set the correct opted-out flag for this nudge type ─────────────────
  // Upsert so the row is created even if user_preferences hasn't been
  // touched for this user yet.
  const supabase = createServiceClient()

  const column = type === 'validation' ? 'validation_nudge_opted_out' : 'daily_nudge_opted_out'

  const { error } = await supabase
    .from('user_preferences')
    .upsert(
      { user_id: userId, [column]: true },
      { onConflict: 'user_id' },
    )

  if (error) {
    console.error(`[NudgeUnsub] DB error for user ${userId.slice(0, 8)}:`, error.message)
    // Still return the confirmation page — worst case they get one more email
    // and click again. Don't expose DB errors to the browser.
  } else {
    console.log(`[NudgeUnsub] Opted out user ${userId.slice(0, 8)} from '${type}' nudges`)
  }

  // ── 3. Confirm ────────────────────────────────────────────────────────────
  return new NextResponse(confirmedHtml(appUrl, type), {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}

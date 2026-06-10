// lib/push.ts
// ─────────────────────────────────────────────────────────────────────────────
// sendPushToUser — sends a Web Push notification to all active subscriptions
// for a given user.
//
// Used by:
//   • /api/cron/reanalyze-email — fires alongside the 7d/14d/30d nudge email
//   • Any future trigger (e.g. new Mirror pattern detected)
//
// Requires:
//   NEXT_PUBLIC_VAPID_PUBLIC_KEY  — VAPID public key (same value in both envs)
//   VAPID_PRIVATE_KEY             — VAPID private key (server only)
//   VAPID_SUBJECT                 — mailto: or https: contact URI
//
// Generate keys once: npx web-push generate-vapid-keys
// ─────────────────────────────────────────────────────────────────────────────

import webpush                  from 'web-push'
import { createServiceClient } from '@/lib/supabase'

// ── VAPID setup (runs once at module load) ────────────────────────────────────
const VAPID_PUBLIC  = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY  ?? ''
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY             ?? ''
const VAPID_SUBJECT = process.env.VAPID_SUBJECT                 ?? 'mailto:auth@quorumvault.org'

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE)
} else {
  console.warn('[Push] VAPID keys not set — push notifications disabled')
}


// ── Types ─────────────────────────────────────────────────────────────────────
export interface PushPayload {
  title: string
  body:  string
  url?:  string
}

export interface PushResult {
  sent:   number
  failed: number
}


// ── sendPushToUser ────────────────────────────────────────────────────────────
export async function sendPushToUser(
  userId:  string,
  payload: PushPayload,
): Promise<PushResult> {

  if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
    console.warn('[Push] Skipping — VAPID keys not configured')
    return { sent: 0, failed: 0 }
  }

  const supabase = createServiceClient()

  const { data: subscriptions, error } = await supabase
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth_key')
    .eq('user_id', userId)

  if (error) {
    console.error('[Push] Failed to fetch subscriptions:', error)
    return { sent: 0, failed: 0 }
  }
  if (!subscriptions?.length) return { sent: 0, failed: 0 }

  let sent = 0, failed = 0

  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth_key },
        },
        JSON.stringify(payload),
        { TTL: 86400 },  // 24h: if device is offline, retry for 24h then drop
      )

      // Stamp last_used_at on success
      await supabase
        .from('push_subscriptions')
        .update({ last_used_at: new Date().toISOString() })
        .eq('id', sub.id)

      sent++

    } catch (err) {
      const statusCode = (err as { statusCode?: number }).statusCode

      if (statusCode === 410 || statusCode === 404) {
        // Subscription expired or unregistered — prune it
        await supabase.from('push_subscriptions').delete().eq('id', sub.id)
        console.log(`[Push] Pruned expired subscription ${sub.id.slice(0, 8)}`)
      } else {
        console.error(`[Push] Send failed for ${sub.id.slice(0, 8)}:`, err)
      }

      failed++
    }
  }

  console.log(`[Push] sendPushToUser ${userId.slice(0, 8)} — sent: ${sent}, failed: ${failed}`)
  return { sent, failed }
}

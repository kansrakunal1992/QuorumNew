// app/api/auth/link-sessions/route.ts
// ── Sprint 6 + 6b: Link pre-auth sessions to authenticated user ───────────────
//
// Sprint 6b additions:
// - Accepts `deviceIds: string[]` (array) instead of single `deviceId`
// - Updates sessions table by device_id (not just bias_library)
// - Handles both same-browser (localStorage IDs) and cross-browser (URL-param IDs)
//
// Linking strategy (runs all in parallel):
//   1. RPC link_sessions_to_user — links sessions by explicit UUID list
//   2. Device-ID session sweep   — UPDATE sessions WHERE device_id IN (...) AND user_id IS NULL
//   3. Email session sweep       — UPDATE sessions WHERE user_email = ? AND user_id IS NULL
//   4. Bias library retro-link   — upgrades anonymous bias rows to user_id lane
//   5. user_preferences upsert   — ensures Mirror can access the user's preferences
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'

export async function POST(req: Request) {
  try {
    const { sessionIds, userId, userEmail, deviceIds, deviceId } = await req.json() as {
      sessionIds?: string[]
      userId?:     string
      userEmail?:  string
      deviceIds?:  string[]   // Sprint 6b: array of device IDs to sweep
      deviceId?:   string     // legacy single deviceId (kept for backward compat)
    }

    if (!userId) {
      return NextResponse.json({ error: 'userId required' }, { status: 400 })
    }

    const supabase = createServiceClient()

    // Normalise device IDs — accept both legacy single field and new array
    const allDeviceIds = [
      ...(deviceIds ?? []),
      ...(deviceId ? [deviceId] : []),
    ].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i) // deduplicate

    // ── 1. Link explicit session IDs via RPC ──────────────────────────────────
    let linkedByIds = 0
    if (sessionIds?.length) {
      const { data, error } = await supabase.rpc('link_sessions_to_user', {
        p_session_ids: sessionIds,
        p_user_id:     userId,
        p_user_email:  userEmail ?? null,
      })

      if (error) {
        // Non-fatal — log and continue. Device sweep may still recover sessions.
        console.warn('[LinkSessions] RPC error (non-fatal):', error.message)
      } else {
        linkedByIds = data ?? 0
      }
    }

    // ── 2. Device-ID session sweep (THE cross-browser fix) ───────────────────
    // Updates sessions table directly for all device IDs.
    // This catches: sessions created before the magic link was sent, AND sessions
    // created by reanalyze AFTER the link was sent (those wouldn't be in ?xs=...).
    let linkedByDevice = 0
    for (const did of allDeviceIds) {
      const { count, error } = await supabase
        .from('sessions')
        .update({
          user_id:    userId,
          user_email: userEmail ?? null,
        })
        .eq('device_id', did)
        .is('user_id', null)
        .select('id', { count: 'exact', head: true })

      if (error) {
        console.warn(`[LinkSessions] Device sweep failed for ${did} (non-fatal):`, error.message)
      } else {
        const n = count ?? 0
        linkedByDevice += n
        if (n > 0) console.log(`[LinkSessions] device_id=${did}: linked ${n} sessions`)
      }
    }

    // ── 3. Email session sweep ────────────────────────────────────────────────
    // Catches sessions where the user had entered their email before auth.
    // (Sessions where user_email was set but user_id was still null.)
    let linkedByEmail = 0
    if (userEmail) {
      const { count, error } = await supabase
        .from('sessions')
        .update({ user_id: userId })
        .eq('user_email', userEmail)
        .is('user_id', null)
        .select('id', { count: 'exact', head: true })

      if (error) {
        console.warn('[LinkSessions] Email sweep failed (non-fatal):', error.message)
      } else {
        linkedByEmail = count ?? 0
        if (linkedByEmail > 0) console.log(`[LinkSessions] email sweep: linked ${linkedByEmail} sessions`)
      }
    }

    // ── 4. Bias library retro-link ────────────────────────────────────────────
    // Upgrades anonymous bias rows to user_id lane for longitudinal accumulation.
    if (userEmail) {
      const { error: emailBiasErr } = await supabase
        .from('bias_library')
        .update({ user_id: userId, user_email: userEmail })
        .eq('user_email', userEmail)
        .is('user_id', null)

      if (emailBiasErr) {
        console.warn('[LinkSessions] Email bias retro-link failed (non-critical):', emailBiasErr.message)
      }
    }

    for (const did of allDeviceIds) {
      const { error: deviceBiasErr } = await supabase
        .from('bias_library')
        .update({ user_id: userId, user_email: userEmail ?? null })
        .eq('device_id', did)
        .is('user_email', null)
        .is('user_id', null)

      if (deviceBiasErr) {
        console.warn(`[LinkSessions] Device bias retro-link failed for ${did} (non-critical):`, deviceBiasErr.message)
      }
    }

    // ── 5. Ensure user_preferences row exists ─────────────────────────────────
    const { error: prefError } = await supabase
      .from('user_preferences')
      .upsert({
        user_id:    userId,
        user_email: userEmail ?? null,
      }, { onConflict: 'user_id' })

    if (prefError) {
      console.warn('[LinkSessions] user_preferences upsert failed (non-critical):', prefError.message)
    }

    const totalLinked = linkedByIds + linkedByDevice + linkedByEmail
    console.log(`[LinkSessions] user=${userId}: ${totalLinked} total sessions linked (ids=${linkedByIds}, device=${linkedByDevice}, email=${linkedByEmail})`)

    return NextResponse.json({
      status:            'ok',
      linked_sessions:   totalLinked,
      linked_by_ids:     linkedByIds,
      linked_by_device:  linkedByDevice,
      linked_by_email:   linkedByEmail,
      user_id:           userId,
    })

  } catch (err) {
    console.error('[LinkSessions] Route error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// app/api/history/route.ts
// Returns session summaries for the home page history list.
//
// Two query paths — merged and deduplicated:
//   1. By localStorage IDs (always attempted — works pre-auth)
//   2. By user_id from auth token (cross-device — only when user is logged in)
//
// This means:
//   - First-time visitor:      sees their device sessions only
//   - Logged-in, same device:  sees device sessions + any from other devices
//   - Logged-in, new device:   sees full history even with empty localStorage

import { createServiceClient, createClient } from '@/lib/supabase'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  try {
    const { ids }: { ids: string[] } = await req.json()
    const supabase = createServiceClient()

    // ── 1. Resolve user_id from auth token if present ─────────────────────
    let userId: string | null = null
    const authHeader = req.headers.get('authorization')
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7)
      try {
        // Verify token using anon client — returns user if valid
        const anonClient = createSupabaseClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        )
        const { data: { user } } = await anonClient.auth.getUser(token)
        userId = user?.id ?? null
      } catch {
        // Invalid token — continue without user_id
      }
    }

    // ── 2. Collect all session IDs to fetch ───────────────────────────────
    let allIds = [...(ids ?? [])]

    if (userId) {
      // Fetch session IDs linked to this user_id (from other devices)
      const { data: userSessions } = await supabase
        .from('sessions')
        .select('id')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(100)

      const userIds = (userSessions ?? []).map(s => s.id)
      // Merge and deduplicate
      allIds = Array.from(new Set([...allIds, ...userIds]))
    }

    if (allIds.length === 0) {
      return NextResponse.json({ sessions: [] })
    }

    // ── 3. Fetch sessions + outcomes ──────────────────────────────────────
    const [sessionsResult, outcomesResult] = await Promise.all([
      supabase
        .from('sessions')
        .select('id, decision_text, created_at')
        .in('id', allIds)
        .order('created_at', { ascending: false }),
      supabase
        .from('outcomes')
        .select('session_id, what_decided, council_helped')
        .in('session_id', allIds),
    ])

    const outcomeMap = Object.fromEntries(
      (outcomesResult.data ?? []).map(o => [o.session_id, o])
    )

    const sessions = (sessionsResult.data ?? []).map(s => ({
      ...s,
      outcome: outcomeMap[s.id] ?? null,
    }))

    return NextResponse.json({ sessions })

  } catch (err) {
    console.error('History route error:', err)
    return NextResponse.json({ sessions: [] })
  }
}

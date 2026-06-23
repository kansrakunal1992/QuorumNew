// app/api/mirror/graph/edges/[id]/dismiss/route.ts
// ── Decision Graph: dismiss an edge (Sprint G2) ───────────────────────────────
//
// PATCH /api/mirror/graph/edges/[id]/dismiss
// No body required.
//
// Auth:    Bearer token → resolveUserId
// Access:  getMirrorAccessState === 'unlocked'
//
// Sets dismissed_at = now(). Dismissed edges are excluded from
// GET /api/mirror/graph by default and from Sprint G4 synthesis traversal.
//
// Design constraints:
//   • Idempotent — re-dismissing an already-dismissed edge just updates the
//     timestamp. Safe to retry.
//   • Scoped to user_id — a user cannot dismiss another user's edge. If the
//     edge doesn't belong to this user, Supabase returns 0 rows → 404.
//   • No un-dismiss in G2. user_asserted edges can be re-annotated via
//     POST /api/mirror/graph/edges which resets dismissed_at to null.
//
// Response: { dismissed: true, dismissed_at: ISO string }
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse }            from 'next/server'
import { createServiceClient }     from '@/lib/supabase'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { getMirrorAccessState }    from '@/lib/mirror-access'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function resolveUserId(req: Request): Promise<string | null> {
  const authHeader = req.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) return null
  try {
    const anonClient = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    )
    const { data: { user } } = await anonClient.auth.getUser(authHeader.slice(7))
    return user?.id ?? null
  } catch {
    return null
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const supabase = createServiceClient()

  // ── 1. Auth ───────────────────────────────────────────────────────────────
  const userId = await resolveUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // ── 2. Mirror access ──────────────────────────────────────────────────────
  const accessState = await getMirrorAccessState(userId, supabase)
  if (accessState !== 'unlocked') {
    return NextResponse.json({ error: 'Mirror access required' }, { status: 403 })
  }

  // ── 3. Validate edge ID ───────────────────────────────────────────────────
  const { id } = await params
  const edgeId = id?.trim()
  if (!edgeId || !UUID_RE.test(edgeId)) {
    return NextResponse.json({ error: 'Invalid edge id' }, { status: 400 })
  }

  // ── 4. Dismiss — scoped to user_id ───────────────────────────────────────
  // .eq('user_id', userId) is the ownership check. If edge belongs to someone
  // else, .single() returns null → 404, never a data leak.
  const dismissedAt = new Date().toISOString()
  const { data: updated, error: updateErr } = await supabase
    .from('graph_edges')
    .update({ dismissed_at: dismissedAt })
    .eq('id', edgeId)
    .eq('user_id', userId)
    .select('id')
    .single()

  if (updateErr || !updated) {
    return NextResponse.json(
      { error: 'Edge not found or not owned by this user' },
      { status: 404 }
    )
  }

  console.log(`[mirror/graph/edges/dismiss] edge ${edgeId} dismissed by ${userId}`)
  return NextResponse.json({ dismissed: true, dismissed_at: dismissedAt })
}

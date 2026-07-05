// app/api/watchlist/[id]/graduate/route.ts
// Sprint W1 — marks a watchlist item as graduated.
//
// Deliberately does NOT create a session itself, does NOT write to
// sessions_ontology/graph_edges, and does NOT call the tagger. "Graduating"
// an item means exactly one thing: the client is about to send this text
// through the ordinary, full session-creation flow (the same Council
// ceremony every other decision goes through, no shortcuts) — this endpoint
// only records that the watchlist entry gave rise to that attempt.
//
// No graduated_session_id link is stored for v1 — wiring that up correctly
// would mean threading a sourceWatchlistId through session creation and back,
// which is real added complexity for what the design doc calls "a nice
// touch, not a data connection." Simpler for now: graduated_at is enough to
// know it happened; which specific session resulted isn't tracked.
//
// Marked graduated immediately on this call, before the person has
// necessarily finished starting the session — if they abandon it, the item
// just shows as graduated with no matching session, a minor cosmetic
// inconsistency, not a data-integrity issue, since this table was never
// part of the judgment record to begin with.

import { NextResponse }                        from 'next/server'
import { createServiceClient, createClient }   from '@/lib/supabase'
import { isWatchlistEnabled }                  from '@/lib/feature-flags'

async function resolveUserId(req: Request): Promise<string | null> {
  const authHeader = req.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) return null
  try {
    const anon = createClient()
    const { data: { user } } = await anon.auth.getUser(authHeader.slice(7).trim())
    return user?.id ?? null
  } catch {
    return null
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!isWatchlistEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const userId = await resolveUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const supabase = createServiceClient()
  const { error } = await supabase
    .from('watchlist_items')
    .update({ status: 'graduated', graduated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', userId)

  if (error) {
    console.error('[watchlist] graduate failed:', error.message)
    return NextResponse.json({ error: 'Failed to graduate item' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

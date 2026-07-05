// app/api/watchlist/[id]/route.ts
// Sprint W1 — archive or delete a single watchlist item.
// PATCH { status: 'archived' } — soft dismiss, keeps the row.
// DELETE — hard delete.
// Both scoped to the calling user's own items only.

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

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!isWatchlistEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const userId = await resolveUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  let body: { status?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  if (body.status !== 'archived') {
    return NextResponse.json({ error: "Only status: 'archived' is supported here" }, { status: 400 })
  }

  const supabase = createServiceClient()
  const { error } = await supabase
    .from('watchlist_items')
    .update({ status: 'archived', archived_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', userId)

  if (error) {
    console.error('[watchlist] PATCH failed:', error.message)
    return NextResponse.json({ error: 'Failed to archive item' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

export async function DELETE(
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
    .delete()
    .eq('id', id)
    .eq('user_id', userId)

  if (error) {
    console.error('[watchlist] DELETE failed:', error.message)
    return NextResponse.json({ error: 'Failed to delete item' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

// app/api/watchlist/route.ts
// Sprint W1 — Watchlist list + create.
//
// GET  — returns the current user's open watchlist items (decrypted), plus
//        a count so the client can show the soft-cap nudge copy itself
//        (this route never blocks creation on count — see POST below).
// POST — creates a new item. Body: { text: string, tag?: string }
//
// Gated behind NEXT_PUBLIC_WATCHLIST_ENABLED — see lib/feature-flags.ts.
// When the flag is off, both methods return 404 rather than an empty
// result, so a disabled feature looks absent, not broken.
//
// Auth: Bearer token required for both — Watchlist has no anonymous path,
// same posture as the graph-nudge route (this one also writes).

import { NextResponse }                        from 'next/server'
import { createServiceClient, createClient }   from '@/lib/supabase'
import { encrypt, decrypt }                    from '@/lib/encryption'
import { isWatchlistEnabled }                  from '@/lib/feature-flags'

const VALID_TAGS = ['business', 'wealth', 'career', 'family', 'relationship', 'other'] as const
const MAX_TEXT_LENGTH = 500

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

export async function GET(req: Request): Promise<NextResponse> {
  if (!isWatchlistEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const userId = await resolveUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('watchlist_items')
    .select('id, text_encrypted, tag, status, created_at')
    .eq('user_id', userId)
    .eq('status', 'open')
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[watchlist] GET failed:', error.message)
    return NextResponse.json({ error: 'Failed to fetch watchlist' }, { status: 500 })
  }

  const items = (data ?? []).map(row => ({
    id:         row.id,
    text:       decrypt(row.text_encrypted as string) ?? '',
    tag:        row.tag,
    status:     row.status,
    created_at: row.created_at,
  }))

  return NextResponse.json({ items, count: items.length })
}

export async function POST(req: Request): Promise<NextResponse> {
  if (!isWatchlistEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const userId = await resolveUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { text?: string; tag?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const text = (body.text ?? '').trim()
  if (!text) return NextResponse.json({ error: 'text is required' }, { status: 400 })
  if (text.length > MAX_TEXT_LENGTH) {
    return NextResponse.json({ error: `text must be ${MAX_TEXT_LENGTH} characters or fewer` }, { status: 400 })
  }

  const tag = body.tag && (VALID_TAGS as readonly string[]).includes(body.tag) ? body.tag : null

  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('watchlist_items')
    .insert({
      user_id:        userId,
      text_encrypted: encrypt(text),
      tag,
      status:         'open',
    })
    .select('id, created_at')
    .single()

  if (error) {
    console.error('[watchlist] POST failed:', error.message)
    return NextResponse.json({ error: 'Failed to create item' }, { status: 500 })
  }

  return NextResponse.json({ id: data.id, created_at: data.created_at }, { status: 201 })
}

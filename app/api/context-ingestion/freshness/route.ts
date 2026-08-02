// app/api/context-ingestion/freshness/route.ts
// ── Context Ingestion (Elite) — "still true?" freshness nudge (v2) ──────────
//
// POST body: { id, action: 'still_true' | 'remove' }
//
// Acts on a single already-accepted/edited fact surfaced by GET's
// `staleFacts` (age > FRESHNESS_DAYS since last_confirmed_at, computed in
// app/api/context-ingestion/route.ts). 'still_true' just resets the
// freshness clock; 'remove' rejects it — same terminal state as an
// un-checked fact at review time, so it stops appearing anywhere (GET,
// foundational-context, Mirror narrative) without a hard delete.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse }        from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { getUserFromBearer, getAuditContext, writeAuditLog } from '@/lib/audit'
import { isContextIngestionEnabled } from '@/lib/feature-flags'
import { getProductTier }      from '@/lib/product-tier'

export async function POST(req: Request) {
  const ctx = getAuditContext(req)

  if (!isContextIngestionEnabled()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const user = await getUserFromBearer(req)
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })

  const supabase = createServiceClient()
  const tierInfo = await getProductTier(user.id, supabase)
  if (tierInfo.tier === 'free') {
    return NextResponse.json({ error: 'Elite feature', locked: true }, { status: 403 })
  }

  let bodyIn: { id?: string; action?: 'still_true' | 'remove' }
  try { bodyIn = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  if (!bodyIn.id || (bodyIn.action !== 'still_true' && bodyIn.action !== 'remove')) {
    return NextResponse.json({ error: 'id and a valid action are required' }, { status: 400 })
  }

  const nowIso = new Date().toISOString()
  const update = bodyIn.action === 'still_true'
    ? { last_confirmed_at: nowIso, updated_at: nowIso }
    : { status: 'rejected', updated_at: nowIso }

  const { error } = await supabase
    .from('user_memory_facts')
    .update(update)
    .eq('id', bodyIn.id)
    .eq('user_id', user.id)   // ownership check — can only act on the caller's own facts
    .in('status', ['accepted', 'edited'])   // only ever acts on a currently-live fact

  if (error) {
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 })
  }

  writeAuditLog({
    actor_id: user.id, actor_email: user.email ?? undefined,
    action: 'context_ingestion.save', resource_id: bodyIn.id, ...ctx,
    metadata: { freshnessAction: bodyIn.action },
  })

  return NextResponse.json({ status: 'ok' })
}

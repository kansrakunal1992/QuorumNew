// app/api/context-ingestion/confirm/route.ts
// ── Context Ingestion (Elite) — review confirmation ──────────────────────────
//
// POST body: { facts: [{ id, action: 'accept'|'edit'|'reject', editedText? }] }
//
// Any 'proposed' fact for this user's current ingestion that ISN'T included
// in the submitted array is auto-rejected — review is a one-shot event, not
// a partial-save draft. Point 6: response includes the exact retained count
// and category breakdown so the client can render "15 insights retained",
// not just a generic success toast.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse }        from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { getUserFromBearer, getAuditContext, writeAuditLog } from '@/lib/audit'
import { isContextIngestionEnabled } from '@/lib/feature-flags'
import { getProductTier }      from '@/lib/product-tier'
import { encrypt }             from '@/lib/encryption'
import type { MemoryFactCategory } from '@/lib/types'

interface FactAction {
  id:         string
  action:     'accept' | 'edit' | 'reject'
  editedText?: string
}

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

  let bodyIn: { facts?: FactAction[] }
  try { bodyIn = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const actions = Array.isArray(bodyIn.facts) ? bodyIn.facts : []

  const { data: ingestion } = await supabase
    .from('context_ingestion')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!ingestion || ingestion.status !== 'review_pending') {
    return NextResponse.json({ error: 'No import is currently pending review.' }, { status: 400 })
  }

  const { data: proposedFacts } = await supabase
    .from('user_memory_facts')
    .select('id, category')
    .eq('user_id', user.id)
    .eq('ingestion_id', ingestion.id)
    .eq('status', 'proposed')

  const proposedIds = new Set((proposedFacts ?? []).map(f => f.id as string))
  const actedIds = new Set<string>()

  for (const a of actions) {
    if (!proposedIds.has(a.id)) continue   // ignore ids that aren't this user's pending facts
    actedIds.add(a.id)

    if (a.action === 'reject') {
      await supabase.from('user_memory_facts')
        .update({ status: 'rejected', updated_at: new Date().toISOString() })
        .eq('id', a.id)
    } else if (a.action === 'edit' && a.editedText?.trim()) {
      await supabase.from('user_memory_facts')
        .update({
          status: 'edited',
          insight_text: encrypt(a.editedText.trim()),
          last_confirmed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', a.id)
    } else {
      await supabase.from('user_memory_facts')
        .update({ status: 'accepted', last_confirmed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', a.id)
    }
  }

  // Anything left un-acted-on is auto-rejected — review is one-shot.
  const unacted = Array.from(proposedIds).filter(id => !actedIds.has(id))
  if (unacted.length > 0) {
    await supabase.from('user_memory_facts')
      .update({ status: 'rejected', updated_at: new Date().toISOString() })
      .in('id', unacted)
  }

  const { data: retained } = await supabase
    .from('user_memory_facts')
    .select('category')
    .eq('user_id', user.id)
    .eq('ingestion_id', ingestion.id)
    .in('status', ['accepted', 'edited'])

  const retainedCount = retained?.length ?? 0

  // v2: rejecting everything ("Reject all & start over") is not the same
  // outcome as saving zero insights on purpose — it means this whole
  // attempt produced nothing worth keeping, so it shouldn't count as a
  // completed import against the 30-day reimport cooldown. 'discarded'
  // bypasses that cooldown the same way 'failed' already does.
  await supabase.from('context_ingestion')
    .update({ status: retainedCount === 0 ? 'discarded' : 'saved', updated_at: new Date().toISOString() })
    .eq('id', ingestion.id)

  const byCategory: Partial<Record<MemoryFactCategory, number>> = {}
  for (const r of retained ?? []) {
    const cat = r.category as MemoryFactCategory
    byCategory[cat] = (byCategory[cat] ?? 0) + 1
  }

  writeAuditLog({
    actor_id: user.id, actor_email: user.email ?? undefined,
    action: 'context_ingestion.save', resource_id: ingestion.id, ...ctx,
    metadata: { retainedCount, byCategory, discarded: retainedCount === 0 },
  })

  return NextResponse.json({
    status: retainedCount === 0 ? 'discarded' : 'saved',
    retainedCount,
    byCategory,
  })
}

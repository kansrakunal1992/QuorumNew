// app/api/context-ingestion/reanalyze/apply/route.ts
// ── Context Ingestion (Elite) — apply confirmed reanalyze revisions ─────────
//
// POST body: { model, applied: [{ id, category, insight_text, confidence, importance }] }
//
// Takes exactly the revision objects POST /reanalyze returned (the client
// echoes back whichever ones the user approved in the diff view). Trust
// note: this writes only to user_memory_facts rows the caller already owns
// (enforced by .eq('user_id', user.id) below), so a client that tampers with
// the payload can only ever rewrite its own account's facts — no cross-user
// exposure, same trust boundary as the "edit" action in /confirm.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse }        from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { getUserFromBearer, getAuditContext, writeAuditLog } from '@/lib/audit'
import { isContextIngestionEnabled } from '@/lib/feature-flags'
import { getProductTier }      from '@/lib/product-tier'
import { encrypt }             from '@/lib/encryption'
import type { MemoryFactCategory } from '@/lib/types'

interface AppliedRevision {
  id:           string
  category:     MemoryFactCategory
  insight_text: string
  confidence:   number
  importance:   number
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

  let bodyIn: { model?: string; applied?: AppliedRevision[] }
  try { bodyIn = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const applied = Array.isArray(bodyIn.applied) ? bodyIn.applied : []
  if (applied.length === 0) {
    return NextResponse.json({ status: 'applied', appliedCount: 0 })
  }

  const nowIso = new Date().toISOString()
  await Promise.all(
    applied.map(rev =>
      supabase.from('user_memory_facts').update({
        category:          rev.category,
        insight_text:      encrypt(rev.insight_text),
        confidence:         rev.confidence,
        importance:         rev.importance,
        last_confirmed_at:  nowIso,
        updated_at:         nowIso,
      }).eq('id', rev.id).eq('user_id', user.id)   // ownership check — see file-level note
    )
  )

  if (bodyIn.model) {
    await supabase.from('context_ingestion')
      .update({ extraction_model: bodyIn.model, updated_at: nowIso })
      .eq('user_id', user.id)
  }

  writeAuditLog({
    actor_id: user.id, actor_email: user.email ?? undefined,
    action: 'context_ingestion.reanalyze', ...ctx,
    metadata: { appliedCount: applied.length },
  })

  return NextResponse.json({ status: 'applied', appliedCount: applied.length })
}

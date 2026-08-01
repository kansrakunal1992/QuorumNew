// app/api/context-ingestion/reanalyze/route.ts
// ── Context Ingestion (Elite) — reanalyze without re-upload ──────────────────
//
// Point 7: refresh confidence/importance/wording on the user's EXISTING
// accepted/edited facts using the current model — no new raw source
// required or accepted. This has no cooldown (unlike a fresh POST /
// import): it never touches raw text, so it carries none of the cost or
// noise risk the 30-day cooldown exists to bound, and is the release valve
// that keeps people from needing a full reimport just to get a refresh.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse }        from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { getUserFromBearer, getAuditContext, writeAuditLog } from '@/lib/audit'
import { checkLimit, getClientIP, tooManyRequests, LIMITS } from '@/lib/rate-limit'
import { isContextIngestionEnabled } from '@/lib/feature-flags'
import { getProductTier }      from '@/lib/product-tier'
import { encrypt, decrypt }    from '@/lib/encryption'
import { reanalyzeFacts }      from '@/lib/context-extractor'
import type { MemoryFactCategory } from '@/lib/types'

const MIN_FACTS_TO_REANALYZE = 3

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

  const rl = checkLimit(getClientIP(req), LIMITS.contextIngestion)
  if (!rl.allowed) return tooManyRequests(rl, 'reanalyze requests')

  const { data: existing } = await supabase
    .from('user_memory_facts')
    .select('id, category, insight_text')
    .eq('user_id', user.id)
    .in('status', ['accepted', 'edited'])

  const facts = (existing ?? []).map(f => ({
    id: f.id as string,
    category: f.category as MemoryFactCategory,
    insight_text: decrypt(f.insight_text as string) ?? (f.insight_text as string),
  }))

  if (facts.length < MIN_FACTS_TO_REANALYZE) {
    return NextResponse.json(
      { error: 'Nothing to reanalyze yet', message: 'Import some context first, then you can refresh it any time.' },
      { status: 400 }
    )
  }

  const { revisions, model } = await reanalyzeFacts(facts)
  if (revisions.size === 0) {
    return NextResponse.json({ error: 'Reanalyze failed', message: 'Please try again shortly.' }, { status: 502 })
  }

  const nowIso = new Date().toISOString()
  await Promise.all(
    Array.from(revisions.entries()).map(([id, rev]) =>
      supabase.from('user_memory_facts').update({
        category:          rev.category,
        insight_text:      encrypt(rev.insight_text),
        confidence:        rev.confidence,
        importance:        rev.importance,
        last_confirmed_at: nowIso,
        updated_at:        nowIso,
      }).eq('id', id).eq('user_id', user.id)
    )
  )

  await supabase.from('context_ingestion')
    .update({ extraction_model: model, updated_at: nowIso })
    .eq('user_id', user.id)

  writeAuditLog({
    actor_id: user.id, actor_email: user.email ?? undefined,
    action: 'context_ingestion.reanalyze', ...ctx,
    metadata: { revisedCount: revisions.size },
  })

  return NextResponse.json({ status: 'reanalyzed', revisedCount: revisions.size })
}

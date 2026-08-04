// app/api/context-ingestion/reanalyze/route.ts
// ── Context Ingestion (Elite) — reanalyze without re-upload ──────────────────
//
// Point 7: refresh confidence/importance/wording on the user's EXISTING
// accepted/edited facts using the current model — no new raw source
// required or accepted. No cooldown (unlike a fresh POST / import): it
// never touches raw text, so it carries none of the cost or noise risk the
// 30-day cooldown exists to bound, and is the release valve that keeps
// people from needing a full reimport just to get a refresh.
//
// v2: this no longer writes anything by itself. It returns proposed
// revisions (old vs. new, per fact) for the client to show as a diff —
// see ContextIngestionPanel's "Refresh with latest model" flow — and
// POST /reanalyze/apply persists whichever ones the user confirms. A
// revision that comes back functionally unchanged (same text, scores
// within a small tolerance) is dropped before it's even shown, so a
// reanalyze on facts the model still agrees with doesn't produce a
// pointless diff.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse }        from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { getUserFromBearer } from '@/lib/audit'
import { checkLimit, getClientIP, tooManyRequests, LIMITS } from '@/lib/rate-limit'
import { isContextIngestionEnabled } from '@/lib/feature-flags'
import { getProductTier }      from '@/lib/product-tier'
import { decrypt }             from '@/lib/encryption'
import { reanalyzeFacts }      from '@/lib/context-extractor'
import type { MemoryFactCategory } from '@/lib/types'

const MIN_FACTS_TO_REANALYZE = 3
const SCORE_TOLERANCE = 0.05   // revisions within this on both confidence and importance, with identical text, don't count as a real change

export interface ReanalyzeRevision {
  id:            string
  is_specific:   boolean   // v3 — unchanged by reanalyze; carried through for the diff view's badge
  before: { category: MemoryFactCategory; insight_text: string; confidence: number; importance: number }
  after:  { category: MemoryFactCategory; insight_text: string; confidence: number; importance: number }
}

export async function POST(req: Request) {
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
    .select('id, category, insight_text, confidence, importance, is_specific')
    .eq('user_id', user.id)
    .in('status', ['accepted', 'edited'])

  const facts = (existing ?? []).map(f => ({
    id: f.id as string,
    category: f.category as MemoryFactCategory,
    insight_text: decrypt(f.insight_text as string) ?? (f.insight_text as string),
    confidence: f.confidence as number,
    importance: f.importance as number,
    is_specific: (f.is_specific as boolean) ?? false,
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

  const factsById = new Map(facts.map(f => [f.id, f]))
  const changed: ReanalyzeRevision[] = []

  for (const [id, rev] of Array.from(revisions.entries())) {
    const before = factsById.get(id)
    if (!before) continue
    const isRealChange =
      rev.insight_text !== before.insight_text ||
      rev.category !== before.category ||
      Math.abs(rev.confidence - before.confidence) > SCORE_TOLERANCE ||
      Math.abs(rev.importance - before.importance) > SCORE_TOLERANCE
    if (!isRealChange) continue

    changed.push({
      id,
      is_specific: before.is_specific,
      before: { category: before.category, insight_text: before.insight_text, confidence: before.confidence, importance: before.importance },
      after:  { category: rev.category, insight_text: rev.insight_text, confidence: rev.confidence, importance: rev.importance },
    })
  }

  return NextResponse.json({ status: 'reanalyzed', model, unchangedCount: facts.length - changed.length, revisions: changed })
}

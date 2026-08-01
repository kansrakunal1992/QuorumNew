// app/api/context-ingestion/route.ts
// ── Context Ingestion (Elite) ────────────────────────────────────────────────
//
// GET    — status + tier + (proposed facts during review, or accepted/edited
//          facts once saved). Drives ContextIngestionPanel's rendering.
// POST   — one-shot ingest: extract → embed → dedup → rank/cap → persist as
//          'proposed'. The raw text passed in the request body is never
//          written anywhere — it exists only as a local variable for the
//          duration of this handler.
// DELETE — "Forget imported context": hard-deletes every user_memory_facts
//          row. The context_ingestion row itself survives (status→'forgotten')
//          because last_ingested_at/reimport_count must persist the 30-day
//          reimport cooldown across a forget — otherwise forget+reimport
//          would be a way to bypass it.
//
// Auth-only (product decision #5) and Elite-only (product decision — the
// whole capability, not just upload, is the upsell surface). Gated end-to-end
// by NEXT_PUBLIC_CONTEXT_INGESTION_ENABLED — see lib/feature-flags.ts.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse }        from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { getUserFromBearer, getAuditContext, writeAuditLog } from '@/lib/audit'
import { checkLimit, getClientIP, tooManyRequests, LIMITS } from '@/lib/rate-limit'
import { isContextIngestionEnabled } from '@/lib/feature-flags'
import { getProductTier }      from '@/lib/product-tier'
import { encrypt, decrypt }    from '@/lib/encryption'
import { extractMemoryFacts }  from '@/lib/context-extractor'
import { embedBatch }          from '@/lib/embeddings'
import { filterDuplicates, profileToReferenceSentences, type EmbeddedReference } from '@/lib/context-dedup'
import type {
  ContextIngestion, ContextIngestionSource, ContextIngestionStatusResponse,
  MemoryFactCandidateWithEmbedding, UserMemoryFact,
} from '@/lib/types'

const MAX_CHARS       = 400_000   // matches lib/context-export-parser.ts's client-side cap — re-enforced server-side
const MAX_CANDIDATES  = 15
const COOLDOWN_DAYS   = 30
const VALID_SOURCES: ContextIngestionSource[] = ['chatgpt', 'claude', 'manual', 'pasted_summary']
const IN_FLIGHT_STATUSES = ['uploaded', 'analyzing']

function daysSince(iso: string | null): number {
  if (!iso) return Infinity
  return (Date.now() - new Date(iso).getTime()) / 86_400_000
}

// ── GET ────────────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  if (!isContextIngestionEnabled()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const user = await getUserFromBearer(req)
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })

  const supabase = createServiceClient()
  const tierInfo = await getProductTier(user.id, supabase)

  if (tierInfo.tier === 'free') {
    const body: ContextIngestionStatusResponse = {
      enabled: true, locked: true, tier: 'free',
      ingestion: null, facts: [], cooldownDaysRemaining: 0,
    }
    return NextResponse.json(body)
  }

  const { data: ingestion } = await supabase
    .from('context_ingestion')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle()

  const factStatuses = ingestion?.status === 'review_pending' ? ['proposed'] : ['accepted', 'edited']
  const { data: factRows } = ingestion
    ? await supabase
        .from('user_memory_facts')
        .select('*')
        .eq('user_id', user.id)
        .in('status', factStatuses)
        .order('importance', { ascending: false })
    : { data: [] }

  const facts: UserMemoryFact[] = (factRows ?? []).map(f => ({
    ...(f as UserMemoryFact),
    insight_text: decrypt(f.insight_text as string) ?? (f.insight_text as string),
  }))

  const cooldownDaysRemaining = ingestion?.last_ingested_at
    ? Math.max(0, Math.ceil(COOLDOWN_DAYS - daysSince(ingestion.last_ingested_at as string)))
    : 0

  const body: ContextIngestionStatusResponse = {
    enabled: true,
    locked: false,
    tier: tierInfo.tier,
    ingestion: (ingestion as ContextIngestion) ?? null,
    facts,
    cooldownDaysRemaining,
  }
  return NextResponse.json(body)
}

// ── POST ───────────────────────────────────────────────────────────────────

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
    return NextResponse.json(
      { error: 'Elite feature', message: 'Context import is available on Elite.', locked: true },
      { status: 403 }
    )
  }

  const rl = checkLimit(getClientIP(req), LIMITS.contextIngestion)
  if (!rl.allowed) return tooManyRequests(rl, 'context import requests')

  let bodyIn: { mode?: string; text?: string }
  try { bodyIn = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const mode = bodyIn.mode as ContextIngestionSource
  if (!VALID_SOURCES.includes(mode)) {
    return NextResponse.json({ error: 'Invalid source type' }, { status: 400 })
  }
  const text = (bodyIn.text ?? '').trim()
  if (!text) return NextResponse.json({ error: 'No text provided' }, { status: 400 })
  const rawText = text.length > MAX_CHARS ? text.slice(text.length - MAX_CHARS) : text

  // ── Existing row / cooldown checks ─────────────────────────────────────────
  const { data: existing } = await supabase
    .from('context_ingestion')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle()

  if (existing && IN_FLIGHT_STATUSES.includes(existing.status as string)) {
    return NextResponse.json({ error: 'An import is already in progress.' }, { status: 409 })
  }

  const isFreshFirstImport = !existing || existing.status === 'failed'
  if (existing && !isFreshFirstImport) {
    const remaining = Math.max(0, Math.ceil(COOLDOWN_DAYS - daysSince(existing.last_ingested_at as string)))
    if (remaining > 0) {
      return NextResponse.json(
        {
          error: 'Reimport cooldown active',
          message: `A fresh import is available again in ${remaining} day${remaining === 1 ? '' : 's'}. You can refresh your existing insights with the current model any time via reanalyze.`,
          cooldownDaysRemaining: remaining,
        },
        { status: 403 }
      )
    }
  }

  const nowIso = new Date().toISOString()
  const reimportCount = existing ? (existing.reimport_count as number ?? 0) + (isFreshFirstImport ? 0 : 1) : 0

  const { data: row, error: upsertErr } = await supabase
    .from('context_ingestion')
    .upsert({
      user_id:                user.id,
      source_type:            mode,
      status:                 'analyzing',
      char_count:              rawText.length,
      error_message:           null,
      product_tier_at_import: tierInfo.tier,
      reimport_count:          reimportCount,
      last_ingested_at:        nowIso,
      updated_at:              nowIso,
    }, { onConflict: 'user_id' })
    .select('*')
    .single()

  if (upsertErr || !row) {
    console.error('[ContextIngestion POST] upsert failed:', upsertErr)
    return NextResponse.json({ error: 'Failed to start import' }, { status: 500 })
  }

  // ── Extract ──────────────────────────────────────────────────────────────
  const { candidates, model } = await extractMemoryFacts(rawText)
  // rawText/bodyIn.text go out of scope after this function returns — never
  // written to any table, log line, or file above this point.

  if (candidates.length === 0) {
    await supabase.from('context_ingestion').update({
      status: 'failed',
      error_message: "Couldn't find enough confident signal in this source. Try a longer export, or describe yourself in a few sentences instead.",
      retry_count: (row.retry_count as number ?? 0) + 1,
      updated_at: new Date().toISOString(),
    }).eq('id', row.id)
    return NextResponse.json({
      error: 'No confident insights found',
      message: "Couldn't find enough confident signal in this source. Try a longer export, or describe yourself in a few sentences instead.",
    }, { status: 200 })
  }

  // ── Embed + dedup ────────────────────────────────────────────────────────
  const embeddings = await embedBatch(candidates.map(c => c.insight_text))
  const withEmbeddings: MemoryFactCandidateWithEmbedding[] = candidates.map((c, i) => ({
    ...c, embedding: embeddings[i] ?? null,
  }))

  const [{ data: existingFacts }, { data: profileRow }] = await Promise.all([
    supabase.from('user_memory_facts').select('embedding').eq('user_id', user.id).in('status', ['accepted', 'edited']),
    supabase.from('user_profiles').select('archetype, primary_fears, life_stage, risk_stance').eq('user_id', user.id).maybeSingle(),
  ])

  const profileSentences = profileToReferenceSentences(profileRow ?? null)
  const profileEmbeddings = await embedBatch(profileSentences)

  const references: EmbeddedReference[] = [
    ...(existingFacts ?? []).map(f => ({ text: '', embedding: (f.embedding as number[] | null) })),
    ...profileSentences.map((text, i) => ({ text, embedding: profileEmbeddings[i] ?? null })),
  ]

  const deduped = filterDuplicates(withEmbeddings, references)
  const ranked = deduped
    .sort((a, b) => (b.importance * b.confidence) - (a.importance * a.confidence))
    .slice(0, MAX_CANDIDATES)

  // ── Persist as 'proposed' ────────────────────────────────────────────────
  const { data: insertedFacts, error: insertErr } = await supabase
    .from('user_memory_facts')
    .insert(ranked.map(c => ({
      user_id:      user.id,
      ingestion_id: row.id,
      category:     c.category,
      insight_text: encrypt(c.insight_text),
      confidence:   c.confidence,
      importance:   c.importance,
      embedding:    c.embedding,
      source:       mode,
      status:       'proposed',
    })))
    .select('*')

  if (insertErr) {
    console.error('[ContextIngestion POST] fact insert failed:', insertErr)
    await supabase.from('context_ingestion').update({
      status: 'failed', error_message: 'Failed to save extracted insights.', updated_at: new Date().toISOString(),
    }).eq('id', row.id)
    return NextResponse.json({ error: 'Failed to save extracted insights' }, { status: 500 })
  }

  const finishedIso = new Date().toISOString()
  await supabase.from('context_ingestion').update({
    status:            'review_pending',
    processed_at:      finishedIso,
    raw_purged_at:     finishedIso,   // set atomically with insights_extracted — proof-of-deletion timestamp
    extraction_model:  model,
    updated_at:        finishedIso,
  }).eq('id', row.id)

  writeAuditLog({
    actor_id: user.id, actor_email: user.email ?? undefined,
    action: 'context_ingestion.upload', resource_id: row.id, ...ctx,
    metadata: { source: mode, candidateCount: ranked.length, deduped: withEmbeddings.length - deduped.length },
  })

  // Return the just-inserted rows with plaintext insight_text — we already
  // have it in memory from `ranked`, no need to re-decrypt.
  const facts: UserMemoryFact[] = (insertedFacts ?? []).map((f, i) => ({
    ...(f as UserMemoryFact),
    insight_text: ranked[i]?.insight_text ?? decrypt(f.insight_text as string) ?? '',
  }))

  return NextResponse.json({ status: 'review_pending', facts })
}

// ── DELETE — "Forget imported context" ────────────────────────────────────
// Not tier-gated: removing your own data is never something a paywall
// should block, even for an account that has since downgraded from Elite.

export async function DELETE(req: Request) {
  const ctx = getAuditContext(req)

  if (!isContextIngestionEnabled()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const user = await getUserFromBearer(req)
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })

  const supabase = createServiceClient()

  const { error: deleteErr } = await supabase
    .from('user_memory_facts')
    .delete()
    .eq('user_id', user.id)

  if (deleteErr) {
    console.error('[ContextIngestion DELETE] fact delete failed:', deleteErr)
    return NextResponse.json({ error: 'Failed to forget imported context' }, { status: 500 })
  }

  // Row survives (status → 'forgotten') — last_ingested_at/reimport_count
  // must persist across a forget so the 30-day cooldown can't be bypassed
  // by forget-then-reimport.
  await supabase.from('context_ingestion').update({
    status: 'forgotten', error_message: null, updated_at: new Date().toISOString(),
  }).eq('user_id', user.id)

  writeAuditLog({
    actor_id: user.id, actor_email: user.email ?? undefined,
    action: 'context_ingestion.forget', ...ctx,
  })

  return NextResponse.json({ success: true })
}

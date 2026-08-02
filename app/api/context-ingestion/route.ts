// app/api/context-ingestion/route.ts
// ── Context Ingestion (Elite) ────────────────────────────────────────────────
//
// GET    — status + tier + (proposed facts during review, or accepted/edited
//          facts once saved, or stale facts due for a "still true?" check —
//          v2). Drives ContextIngestionPanel's rendering.
// POST   — ingest: extract → embed → dedup → rank/cap → persist as 'proposed'.
//          v2: text over ASYNC_THRESHOLD_CHARS runs the pipeline as a
//          fire-and-forget background task instead of blocking the response —
//          see the note above runExtractionPipeline() for why this doesn't
//          need a queue or any new infra on Railway specifically. The raw
//          text is never written anywhere either way — it exists only as a
//          local variable for the duration of the pipeline function.
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
const VALID_SOURCES: ContextIngestionSource[] = ['chatgpt', 'claude', 'file_upload', 'manual', 'pasted_summary']
const IN_FLIGHT_STATUSES = ['uploaded', 'analyzing']

// v2 — async ingestion for large exports. Above this size, the extraction +
// embedding round trip risks Railway's request-gateway timeout even though
// the underlying model calls would eventually finish. Below it, the
// synchronous path is nicer UX (immediate result, no polling).
const ASYNC_THRESHOLD_CHARS = 120_000

// v2 — stale-'analyzing' recovery. Because the async path is a fire-and-
// forget promise in the same Node process (see runExtractionPipeline's doc
// comment), a Railway restart/redeploy mid-extraction is the one way a row
// can get permanently stuck at 'analyzing'. Anything older than this is
// treated as failed for gating purposes, so the user always has a way
// forward rather than a dead spinner.
const STALE_ANALYZING_MINUTES = 10

// v2 — freshness. Facts older than this (by last_confirmed_at) surface a
// "still true?" nudge instead of being silently trusted forever.
const FRESHNESS_DAYS = 450   // ~15 months, per product decision (12–18 month window)

function daysSince(iso: string | null): number {
  if (!iso) return Infinity
  return (Date.now() - new Date(iso).getTime()) / 86_400_000
}

function minutesSince(iso: string | null): number {
  if (!iso) return Infinity
  return (Date.now() - new Date(iso).getTime()) / 60_000
}

function isStaleAnalyzing(row: { status: string; updated_at: string } | null): boolean {
  if (!row) return false
  return IN_FLIGHT_STATUSES.includes(row.status) && minutesSince(row.updated_at) > STALE_ANALYZING_MINUTES
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
      ingestion: null, facts: [], cooldownDaysRemaining: 0, staleFacts: [],
    }
    return NextResponse.json(body)
  }

  const { data: ingestionRaw } = await supabase
    .from('context_ingestion')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle()

  // v2: a stuck 'analyzing' row (background task never finished — most
  // likely a Railway restart mid-extraction) is surfaced to the client as
  // 'failed' rather than an indefinite spinner. Not written back to the DB
  // here — GET should never have write side effects — so the very next
  // POST attempt or page load naturally reconciles it via the same check.
  const ingestion = ingestionRaw && isStaleAnalyzing(ingestionRaw)
    ? { ...ingestionRaw, status: 'failed', error_message: ingestionRaw.error_message ?? "This import didn't finish — please try again." }
    : ingestionRaw

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

  // v2 — freshness nudge: accepted/edited facts old enough to ask "still true?"
  const staleFacts = ingestion?.status !== 'review_pending'
    ? facts.filter(f => daysSince(f.last_confirmed_at) > FRESHNESS_DAYS)
    : []

  const cooldownDaysRemaining = ingestion?.last_ingested_at
    ? Math.max(0, Math.ceil(COOLDOWN_DAYS - daysSince(ingestion.last_ingested_at as string)))
    : 0

  const body: ContextIngestionStatusResponse = {
    enabled: true,
    locked: false,
    tier: tierInfo.tier,
    ingestion: (ingestion as ContextIngestion) ?? null,
    facts,
    staleFacts,
    cooldownDaysRemaining,
  }
  return NextResponse.json(body)
}

// ── Shared extraction pipeline — used by both the sync and async POST paths ──
//
// v2 note on "async without a queue": Railway runs this app as a persistent
// Node process, not a per-request serverless function — the process does
// NOT terminate the instant an HTTP response is sent. That means a promise
// started here and deliberately NOT awaited in the POST handler keeps
// running to completion in the background on the same instance, updating
// context_ingestion/user_memory_facts when it finishes, with no new queue,
// no Redis, and no change to the "raw text is never persisted" guarantee —
// rawText still only ever exists as this function's local variable. This
// would NOT be safe on a true serverless host (Vercel functions, etc.),
// where the runtime can freeze/kill the function once the response is sent.
//
// Returns a discriminated result so the sync caller can turn it directly
// into an HTTP response; the async caller only cares that the DB ends up in
// a terminal state (it already does — every branch below writes one).
type PipelineResult =
  | { ok: true; facts: UserMemoryFact[] }
  | { ok: false; status: number; body: Record<string, unknown> }

async function runExtractionPipeline(
  supabase:  ReturnType<typeof createServiceClient>,
  userId:    string,
  mode:      ContextIngestionSource,
  rawText:   string,
  rowId:     string,
  rowRetryCount: number,
): Promise<PipelineResult> {
  try {
    const { candidates, model } = await extractMemoryFacts(rawText)
    // rawText goes out of scope when this function returns — never written
    // to any table, log line, or file above this point, in either the sync
    // or async path.

    if (candidates.length === 0) {
      const message = "Couldn't find enough confident signal in this source. Try a longer export, or describe yourself in a few sentences instead."
      await supabase.from('context_ingestion').update({
        status: 'failed', error_message: message,
        retry_count: (rowRetryCount ?? 0) + 1,
        updated_at: new Date().toISOString(),
      }).eq('id', rowId)
      return { ok: false, status: 200, body: { error: 'No confident insights found', message } }
    }

    const embeddings = await embedBatch(candidates.map(c => c.insight_text))
    const withEmbeddings: MemoryFactCandidateWithEmbedding[] = candidates.map((c, i) => ({
      ...c, embedding: embeddings[i] ?? null,
    }))

    const [{ data: existingFacts }, { data: profileRow }] = await Promise.all([
      supabase.from('user_memory_facts').select('embedding').eq('user_id', userId).in('status', ['accepted', 'edited']),
      supabase.from('user_profiles').select('archetype, primary_fears, life_stage, risk_stance').eq('user_id', userId).maybeSingle(),
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

    const { data: insertedFacts, error: insertErr } = await supabase
      .from('user_memory_facts')
      .insert(ranked.map(c => ({
        user_id:      userId,
        ingestion_id: rowId,
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
      console.error('[ContextIngestion pipeline] fact insert failed:', insertErr)
      await supabase.from('context_ingestion').update({
        status: 'failed', error_message: 'Failed to save extracted insights.', updated_at: new Date().toISOString(),
      }).eq('id', rowId)
      return { ok: false, status: 500, body: { error: 'Failed to save extracted insights' } }
    }

    const finishedIso = new Date().toISOString()
    await supabase.from('context_ingestion').update({
      status:            'review_pending',
      processed_at:      finishedIso,
      raw_purged_at:     finishedIso,   // set atomically with insights_extracted — proof-of-deletion timestamp
      extraction_model:  model,
      updated_at:        finishedIso,
    }).eq('id', rowId)

    writeAuditLog({
      actor_id: userId, action: 'context_ingestion.upload', resource_id: rowId,
      metadata: { source: mode, candidateCount: ranked.length, deduped: withEmbeddings.length - deduped.length },
    })

    // Sync caller already has plaintext in `ranked` — no need to re-decrypt.
    // Async caller discards this return value (client picks facts up via a
    // subsequent GET, decrypted there), so the shape only needs to satisfy
    // the sync path.
    const facts: UserMemoryFact[] = (insertedFacts ?? []).map((f, i) => ({
      ...(f as UserMemoryFact),
      insight_text: ranked[i]?.insight_text ?? decrypt(f.insight_text as string) ?? '',
    }))
    return { ok: true, facts }
  } catch (err) {
    console.error('[ContextIngestion pipeline] unexpected error:', err)
    try {
      await supabase.from('context_ingestion').update({
        status: 'failed', error_message: 'Something went wrong processing your import. Please try again.',
        updated_at: new Date().toISOString(),
      }).eq('id', rowId)
    } catch { /* best-effort — don't let a logging failure mask the original error */ }
    return { ok: false, status: 500, body: { error: 'Import failed' } }
  }
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

  // ── Existing row / cooldown / stale-recovery checks ────────────────────────
  const { data: existing } = await supabase
    .from('context_ingestion')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle()

  // v2: a genuinely stuck row (see isStaleAnalyzing) no longer blocks a retry
  // forever — only a row that's actively in flight (updated recently) does.
  if (existing && IN_FLIGHT_STATUSES.includes(existing.status as string) && !isStaleAnalyzing(existing as never)) {
    return NextResponse.json({ error: 'An import is already in progress.' }, { status: 409 })
  }

  const isFreshFirstImport = !existing || existing.status === 'failed' || existing.status === 'discarded' || isStaleAnalyzing(existing as never)
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

  // ── v2: fork sync vs async based on size ──────────────────────────────────
  if (rawText.length > ASYNC_THRESHOLD_CHARS) {
    // Fire-and-forget — see runExtractionPipeline's doc comment for why this
    // is safe on Railway specifically. Errors are already handled/persisted
    // to the row inside the pipeline; this .catch is a last-resort net so a
    // truly unexpected throw can't produce an unhandled promise rejection.
    void runExtractionPipeline(supabase, user.id, mode, rawText, row.id as string, row.retry_count as number)
      .catch(err => console.error('[ContextIngestion POST] async pipeline threw:', err))

    return NextResponse.json({
      status: 'analyzing',
      async: true,
      ingestion: row,
      message: 'This is a large import — analyzing in the background. Check back in a minute.',
    })
  }

  const result = await runExtractionPipeline(supabase, user.id, mode, rawText, row.id as string, row.retry_count as number)

  if (!result.ok) {
    return NextResponse.json(result.body, { status: result.status })
  }

  writeAuditLog({
    actor_id: user.id, actor_email: user.email ?? undefined,
    action: 'context_ingestion.upload', resource_id: row.id, ...ctx,
    metadata: { source: mode, candidateCount: result.facts.length, synchronous: true },
  })

  return NextResponse.json({ status: 'review_pending', facts: result.facts })
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

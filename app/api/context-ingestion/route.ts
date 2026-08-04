// app/api/context-ingestion/route.ts
// ── Context Ingestion (Elite) — status, submit, forget ───────────────────────
//
// Three handlers for the base resource:
//   GET    — status/facts for ContextIngestionPanel. Returns 200 with
//            `enabled: false` when the feature flag is off (NOT a 404) —
//            the panel's own render guard (`if (!data.enabled) return null`)
//            depends on getting a body back to read that flag from.
//   POST   — start (or restart, after the 30-day cooldown) an import. Body:
//            { mode: ContextIngestionSource, text: string, allowSpecificDetails?: boolean }.
//            Runs the extraction → embed → dedup → insert pipeline inline for
//            normal-sized text; for large text it upserts the row to
//            'analyzing', fires the same pipeline without awaiting it, and
//            returns { async: true } immediately — the panel then polls GET
//            until the row reaches a terminal status. This works as a plain
//            fire-and-forget promise (not a queued job) because the app runs
//            as a long-lived Node process, not ephemeral serverless functions
//            (see fireBiasScore() in app/api/examiner/route.ts for the same
//            assumption elsewhere in this codebase).
//   DELETE — "Forget imported context": hard-deletes every user_memory_facts
//            row for this user and marks the ingestion row 'forgotten'. The
//            context_ingestion row itself is never deleted — last_ingested_at
//            and reimport_count must survive a forget so the reimport
//            cooldown can't be reset by forgetting and re-importing.
//
// rawText only ever exists as a local variable inside processIngestion() —
// nothing above this file, and nothing in it, writes the raw import text to
// a database, a log line, or a file. See lib/context-extractor.ts's header
// for the full "raw conversation discarded" guarantee.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse }        from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
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
  UserMemoryFact, MemoryFactCandidate, MemoryFactCandidateWithEmbedding,
} from '@/lib/types'

// Mirrors lib/context-export-parser.ts's client-side MAX_CHARS (not exported
// from that module) — re-enforced here since a client-side cap alone isn't a
// server-side guarantee.
const MAX_TEXT_CHARS = 400_000

// No hard platform timeout forces this split (the app runs on a persistent
// Node process, not a serverless function with a request deadline) — this is
// purely so a large import doesn't leave the browser tab hanging on one long
// request. Tune freely; it isn't load-bearing for correctness.
const ASYNC_THRESHOLD_CHARS = 50_000

const REIMPORT_COOLDOWN_DAYS   = 30
const FRESHNESS_DAYS           = 450   // abstracted facts — "still true?" nudge window
const SPECIFIC_FRESHNESS_DAYS  = 120   // v3 — specific facts go stale faster

const IN_PROGRESS_STATUSES = ['uploaded', 'analyzing', 'review_pending']
const VALID_SOURCES: ContextIngestionSource[] = ['chatgpt', 'claude', 'file_upload', 'manual', 'pasted_summary']

const DAY_MS = 24 * 60 * 60 * 1000

function computeCooldownDaysRemaining(ingestion: Pick<ContextIngestion, 'status' | 'last_ingested_at'> | null): number {
  if (!ingestion || !ingestion.last_ingested_at) return 0
  // 'failed' and 'discarded' bypass the cooldown — see supabase/add_context_ingestion_v2.sql
  if (ingestion.status === 'failed' || ingestion.status === 'discarded') return 0
  const elapsedDays = (Date.now() - new Date(ingestion.last_ingested_at).getTime()) / DAY_MS
  return Math.max(0, Math.ceil(REIMPORT_COOLDOWN_DAYS - elapsedDays))
}

// ── GET — status for ContextIngestionPanel ───────────────────────────────────

export async function GET(req: Request) {
  if (!isContextIngestionEnabled()) {
    return NextResponse.json({
      enabled: false, locked: true, tier: 'free',
      ingestion: null, facts: [], staleFacts: [], cooldownDaysRemaining: 0,
    } satisfies ContextIngestionStatusResponse)
  }

  const user = await getUserFromBearer(req)
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })

  const supabase = createServiceClient()
  const tierInfo = await getProductTier(user.id, supabase)
  const locked = tierInfo.tier === 'free'

  const { data: ingestionRow } = await supabase
    .from('context_ingestion')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle()
  const ingestion = (ingestionRow as ContextIngestion | null) ?? null

  // Locked (free tier) or never imported — the panel doesn't render facts in
  // either case, so skip the extra query.
  if (locked || !ingestion) {
    return NextResponse.json({
      enabled: true, locked, tier: tierInfo.tier,
      ingestion, facts: [], staleFacts: [], cooldownDaysRemaining: 0,
    } satisfies ContextIngestionStatusResponse)
  }

  const { data: factRows } = await supabase
    .from('user_memory_facts')
    .select('*')
    .eq('user_id', user.id)
    .eq('ingestion_id', ingestion.id)
    .in('status', ['proposed', 'accepted', 'edited'])

  const decrypted: UserMemoryFact[] = (factRows ?? []).map((row: UserMemoryFact) => ({
    ...row,
    insight_text: decrypt(row.insight_text) ?? row.insight_text,
  }))

  const retained = decrypted.filter(f => f.status === 'accepted' || f.status === 'edited')
  const proposed = decrypted.filter(f => f.status === 'proposed')

  const nowMs = Date.now()
  const staleFacts = retained.filter(f => {
    const windowDays = f.is_specific ? SPECIFIC_FRESHNESS_DAYS : FRESHNESS_DAYS
    const ageDays = (nowMs - new Date(f.last_confirmed_at).getTime()) / DAY_MS
    return ageDays > windowDays
  })

  // review_pending → the review screen needs the *proposed* candidates;
  // every other status → the panel's "saved" summary needs the currently
  // retained (accepted/edited) facts. Same field either way, per
  // ContextIngestionStatusResponse's own comment in lib/types.ts.
  const facts = ingestion.status === 'review_pending' ? proposed : retained

  return NextResponse.json({
    enabled: true, locked: false, tier: tierInfo.tier,
    ingestion, facts, staleFacts,
    cooldownDaysRemaining: computeCooldownDaysRemaining(ingestion),
  } satisfies ContextIngestionStatusResponse)
}

// ── POST — start an import ────────────────────────────────────────────────────

interface PipelineResult {
  facts: UserMemoryFact[]
  error?: string
  message?: string
}

/**
 * The actual extraction → embed → dedup → insert pipeline. Shared verbatim
 * between the synchronous path (awaited inline, small text) and the async
 * path (fired without awaiting, large text) so the two never drift.
 *
 * `rawText` is the only place the import's raw content exists as a value —
 * it is read once (by extractMemoryFacts) and never written anywhere. The
 * instant extractMemoryFacts() returns, raw_purged_at is set — that's the
 * whole "raw conversation discarded" guarantee.
 */
async function processIngestion(
  supabase:              SupabaseClient,
  userId:                string,
  ingestion:             ContextIngestion,
  rawText:               string,
  allowSpecificDetails:  boolean,
  sourceType:            ContextIngestionSource,
): Promise<PipelineResult> {
  const nowIso = () => new Date().toISOString()

  const fail = async (message: string, errorCode: string): Promise<PipelineResult> => {
    await supabase.from('context_ingestion')
      .update({ status: 'failed', error_message: message, updated_at: nowIso() })
      .eq('id', ingestion.id)
    return { facts: [], error: errorCode, message }
  }

  try {
    const { candidates, model } = await extractMemoryFacts(rawText, allowSpecificDetails)

    // Atomic with the extraction call returning — raw text has already
    // fallen out of scope everywhere except this function's own stack by
    // the time this write lands.
    await supabase.from('context_ingestion')
      .update({ status: 'insights_extracted', extraction_model: model, raw_purged_at: nowIso(), updated_at: nowIso() })
      .eq('id', ingestion.id)

    if (model === null) {
      return fail('Something went wrong processing your import. Please try again.', 'extraction_failed')
    }
    if (candidates.length === 0) {
      return fail("Couldn't find enough here to extract meaningful insights — try adding more detail or a longer export.", 'no_insights')
    }

    const embeddings = await embedBatch(candidates.map((c: MemoryFactCandidate) => c.insight_text))
    const withEmbeddings: MemoryFactCandidateWithEmbedding[] = candidates.map((c: MemoryFactCandidate, i: number) => ({
      ...c, embedding: embeddings[i] ?? null,
    }))

    const [{ data: existingFactRows }, { data: profileRow }] = await Promise.all([
      supabase.from('user_memory_facts')
        .select('insight_text, embedding')
        .eq('user_id', userId)
        .in('status', ['accepted', 'edited']),
      supabase.from('user_profiles')
        .select('archetype, primary_fears, life_stage, risk_stance')
        .eq('user_id', userId)
        .maybeSingle(),
    ])

    const references: EmbeddedReference[] = (existingFactRows ?? []).map((row: { insight_text: string; embedding: number[] | null }) => ({
      text: decrypt(row.insight_text) ?? row.insight_text,
      embedding: row.embedding ?? null,
    }))

    const profileSentences = profileToReferenceSentences(profileRow ?? null)
    if (profileSentences.length > 0) {
      const profileEmbeddings = await embedBatch(profileSentences)
      profileSentences.forEach((sentence: string, i: number) => references.push({ text: sentence, embedding: profileEmbeddings[i] ?? null }))
    }

    const deduped = filterDuplicates(withEmbeddings, references)
    if (deduped.length === 0) {
      return fail('Everything here matched what Quorum already knows about you — nothing new to add.', 'no_new_insights')
    }

    const insertRows = deduped.map((c: MemoryFactCandidateWithEmbedding) => ({
      user_id:           userId,
      ingestion_id:      ingestion.id,
      category:          c.category,
      insight_text:      encrypt(c.insight_text),
      confidence:        c.confidence,
      importance:        c.importance,
      embedding:         c.embedding,
      source:            sourceType,
      status:            'proposed',
      is_specific:       c.is_specific,
      last_confirmed_at: nowIso(),
    }))

    const { data: inserted, error: insertError } = await supabase
      .from('user_memory_facts')
      .insert(insertRows)
      .select()

    if (insertError || !inserted) {
      console.error('[ContextIngestion] fact insert failed:', insertError)
      return fail('Failed to save extracted insights. Please try again.', 'save_failed')
    }

    await supabase.from('context_ingestion')
      .update({ status: 'review_pending', processed_at: nowIso(), updated_at: nowIso() })
      .eq('id', ingestion.id)

    const facts: UserMemoryFact[] = inserted.map((row: UserMemoryFact) => ({
      ...row,
      insight_text: decrypt(row.insight_text) ?? row.insight_text,
    }))
    return { facts }
  } catch (err) {
    console.error('[ContextIngestion] pipeline failed:', err)
    return fail('Something went wrong processing your import. Please try again.', 'unexpected_error')
  }
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

  const rl = checkLimit(getClientIP(req), LIMITS.contextIngestion)
  if (!rl.allowed) return tooManyRequests(rl, 'import requests')

  let bodyIn: { mode?: string; text?: string; allowSpecificDetails?: boolean }
  try { bodyIn = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  if (!bodyIn.mode || !VALID_SOURCES.includes(bodyIn.mode as ContextIngestionSource)) {
    return NextResponse.json({ error: 'Invalid source' }, { status: 400 })
  }
  if (typeof bodyIn.text !== 'string' || !bodyIn.text.trim()) {
    return NextResponse.json({ error: 'Nothing to import', message: 'Paste some text or upload a file first.' }, { status: 400 })
  }

  const mode: ContextIngestionSource = bodyIn.mode as ContextIngestionSource
  const text = bodyIn.text.trim().slice(0, MAX_TEXT_CHARS)
  const allowSpecificDetails = bodyIn.allowSpecificDetails === true

  const { data: existingRow } = await supabase
    .from('context_ingestion')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle()
  const existingIngestion = (existingRow as ContextIngestion | null) ?? null

  if (existingIngestion && IN_PROGRESS_STATUSES.includes(existingIngestion.status)) {
    return NextResponse.json({
      error: 'Import in progress',
      message: existingIngestion.status === 'review_pending'
        ? 'You have insights awaiting review — save or discard them before starting a new import.'
        : "An import is still processing — check back in a moment.",
    }, { status: 409 })
  }

  const cooldownDaysRemaining = computeCooldownDaysRemaining(existingIngestion)
  if (cooldownDaysRemaining > 0) {
    return NextResponse.json({
      error: 'Cooldown active',
      message: `Fresh import available in ${cooldownDaysRemaining} day${cooldownDaysRemaining === 1 ? '' : 's'}.`,
    }, { status: 403 })
  }

  const nowIso = new Date().toISOString()
  const { data: upserted, error: upsertError } = await supabase
    .from('context_ingestion')
    .upsert({
      user_id:                 user.id,
      source_type:             mode,
      status:                  'analyzing',
      char_count:               text.length,
      error_message:            null,
      retry_count:               0,
      product_tier_at_import:   tierInfo.tier,
      reimport_count:            existingIngestion ? existingIngestion.reimport_count + 1 : 0,
      processed_at:              null,
      raw_purged_at:             null,
      last_ingested_at:          nowIso,
      allow_specific_details:    allowSpecificDetails,
      updated_at:                nowIso,
      ...(existingIngestion ? {} : { created_at: nowIso }),
    }, { onConflict: 'user_id' })
    .select()
    .single()

  if (upsertError || !upserted) {
    console.error('[ContextIngestion] upsert failed:', upsertError)
    return NextResponse.json({ error: 'Could not start import', message: 'Please try again.' }, { status: 500 })
  }

  const ingestion = upserted as ContextIngestion

  writeAuditLog({
    actor_id: user.id, actor_email: user.email ?? undefined,
    action: 'context_ingestion.upload', resource_id: ingestion.id, ...ctx,
    metadata: { sourceType: mode, charCount: text.length, allowSpecificDetails, reimport: !!existingIngestion },
  })

  if (text.length > ASYNC_THRESHOLD_CHARS) {
    // Fire-and-forget — see file header for why this is safe without a job
    // queue on this deployment. processIngestion() never throws (its own
    // try/catch always resolves to a PipelineResult), so this .catch() is
    // defense in depth, not the primary error path.
    processIngestion(supabase, user.id, ingestion, text, allowSpecificDetails, mode)
      .catch(err => console.error('[ContextIngestion] async pipeline error:', err))
    return NextResponse.json({ async: true, ingestion })
  }

  const result = await processIngestion(supabase, user.id, ingestion, text, allowSpecificDetails, mode)
  if (result.error) {
    return NextResponse.json({ error: result.error, message: result.message }, { status: 422 })
  }
  return NextResponse.json({ facts: result.facts })
}

// ── DELETE — "Forget imported context" ────────────────────────────────────────

export async function DELETE(req: Request) {
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

  const { data: ingestionRow } = await supabase
    .from('context_ingestion')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!ingestionRow) {
    return NextResponse.json({ status: 'forgotten', deletedCount: 0 })
  }

  // Hard delete — this is the one place user_memory_facts rows are actually
  // removed rather than status-transitioned. context_ingestion itself is
  // never deleted: last_ingested_at and reimport_count must survive so the
  // 30-day reimport cooldown can't be reset by forgetting and re-importing.
  const { data: deletedRows, error: deleteError } = await supabase
    .from('user_memory_facts')
    .delete()
    .eq('user_id', user.id)
    .select('id')

  if (deleteError) {
    console.error('[ContextIngestion] forget delete failed:', deleteError)
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 })
  }

  const deletedCount = deletedRows?.length ?? 0

  await supabase.from('context_ingestion')
    .update({ status: 'forgotten', updated_at: new Date().toISOString() })
    .eq('id', ingestionRow.id)

  writeAuditLog({
    actor_id: user.id, actor_email: user.email ?? undefined,
    action: 'context_ingestion.forget', resource_id: ingestionRow.id, ...ctx,
    metadata: { deletedCount },
  })

  return NextResponse.json({ status: 'forgotten', deletedCount })
}

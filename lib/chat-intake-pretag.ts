// lib/chat-intake-pretag.ts
// ── Pre-tag: run the ontology tagger while the person is still on the confirm screen (server-side helpers) ──
//
// After "Convene the Council" the person used to wait for the ontology tagger (one model call) before the Examiner's
// questions could be known. The tagger needs only the decision text and context — both exist before the session does.
// So the confirm screen asks POST /api/chat-intake/pretag to run it early; the result is parked on the CHAT row
// (chat_intakes.pre_tag*, supabase/sprint_intake_v13_pretag.sql) and POST /api/ontology uses it, instead of calling the
// model, when the session is created from that chat.
//
// Nothing here touches the `sessions` table: no draft rows, so nothing that counts, lists or exports sessions can ever see
// a decision that was only looked at. Rules that keep this safe:
//   • a pre-tag is used ONLY if the session's own tagger input hashes to the same value as when it was computed
//     (an edit, a returned-to-chat, a different context all simply miss and the tagger runs as it always did);
//   • both paths tag the SAME canonical input — the context without the person's lean / priority lines, which are
//     not known yet at pre-tag time — so a hit and a miss give the same kind of result;
//   • every failure (column missing, model failed, invalid tag, stale run) falls back to normal tagging;
//   • the result is used once, then cleared.
//
// The Supabase client is passed in (structurally typed) so tests drive it with an in-memory fake, like
// lib/chat-intake-checkpoint-helpers.ts. Server-only (uses node:crypto).

import { createHash } from 'crypto'
import type { OntologyTag } from '@/lib/ontology-tagger'
import { validateTag } from '@/lib/ontology-validate'
import { LEAN_LINE_PREFIX, PRIORITY_LINE_PREFIX } from '@/lib/chat-intake-context'

export const PRETAG_FRESH_MS         = 2 * 60 * 60_000   // a ready result older than this is not used
export const PRETAG_PENDING_STALE_MS = 90_000            // a run in flight longer than this is treated as abandoned
export const PRETAG_WAIT_MS          = 9_000             // how long the session's tagging waits for a run still in flight
export const PRETAG_POLL_MS          = 400

// ── The canonical tagger input ───────────────────────────────────────────────

/** Removes the two lines the confirm screen's taps add to the context (where they lean / what matters most). */
export function stripTaggerNoiseLines(contextText: string | null | undefined): string | null {
  if (!contextText) return null
  const kept = contextText.split('\n').filter(l => !l.startsWith(LEAN_LINE_PREFIX) && !l.startsWith(PRIORITY_LINE_PREFIX))
  // The context is built from paragraphs separated by blank lines, so removing a line leaves its blank neighbours behind:
  // collapse them, or the same decision would hash differently with and without the taps.
  const out = kept.join('\n').replace(/\n{3,}/g, '\n\n').trim()
  return out || null
}

/** What the tagger receives, whichever path produced it. */
export function taggerInput(decisionText: string, contextText: string | null | undefined): { decisionText: string; contextText: string | null } {
  return { decisionText: decisionText.trim(), contextText: stripTaggerNoiseLines(contextText?.trim() ?? null) }
}

export function pretagHash(decisionText: string, contextText: string | null | undefined): string {
  const i = taggerInput(decisionText, contextText)
  return createHash('sha256').update(JSON.stringify([i.decisionText, i.contextText ?? ''])).digest('hex')
}

// ── Storage (chat_intakes.pre_tag*) ──────────────────────────────────────────

export interface PretagRow {
  pre_tag:        unknown
  pre_tag_hash:   string | null
  pre_tag_status: string | null
  pre_tag_at:     string | null
}

/** The slice of the Supabase query builder these helpers use. */
export interface PretagDb {
  from(table: string): {
    select(cols: string): { eq(col: string, val: string): { maybeSingle(): PromiseLike<{ data: PretagRow | null; error: unknown }> } }
    update(values: Record<string, unknown>): {
      eq(col: string, val: string): {
        eq(col: string, val: string): PromiseLike<{ error: unknown }>
        or(filter: string): { select(cols: string): PromiseLike<{ data: unknown[] | null; error: unknown }> }
      } & PromiseLike<{ error: unknown }>
    }
  }
}

export type PretagClaim = 'claimed' | 'held' | 'unavailable'

/**
 * Take the right to run the tagger for this exact input. 'claimed' = run it; 'held' = a fresh run or a fresh result for the
 * same input already exists (do nothing); 'unavailable' = the columns are missing or the call failed (do nothing).
 * Atomic: one conditional write, same pattern as claimCheckpoint.
 */
export async function claimPretag(db: PretagDb, chatIntakeId: string, hash: string, now: number = Date.now()): Promise<PretagClaim> {
  try {
    const stale = new Date(now - PRETAG_PENDING_STALE_MS).toISOString()
    const old   = new Date(now - PRETAG_FRESH_MS).toISOString()
    const { data, error } = await db
      .from('chat_intakes')
      .update({ pre_tag_hash: hash, pre_tag_status: 'pending', pre_tag_at: new Date(now).toISOString(), pre_tag: null })
      .eq('id', chatIntakeId)
      .or([
        'pre_tag_hash.is.null',
        `pre_tag_hash.neq.${hash}`,
        'pre_tag_status.eq.failed',
        'pre_tag_status.eq.used',
        `and(pre_tag_status.eq.pending,pre_tag_at.lt.${stale})`,
        `and(pre_tag_status.eq.ready,pre_tag_at.lt.${old})`,
      ].join(','))
      .select('id')
    if (error) return 'unavailable'
    return data && data.length > 0 ? 'claimed' : 'held'
  } catch {
    return 'unavailable'
  }
}

/** Record the outcome of a run we claimed. Only writes if the row is still for this input (a newer input supersedes). */
export async function storePretag(db: PretagDb, chatIntakeId: string, hash: string, tag: OntologyTag | null, now: number = Date.now()): Promise<boolean> {
  try {
    const ok = !!tag && validateTag(tag)
    const { error } = await db
      .from('chat_intakes')
      .update({ pre_tag: ok ? tag : null, pre_tag_status: ok ? 'ready' : 'failed', pre_tag_at: new Date(now).toISOString() })
      .eq('id', chatIntakeId)
      .eq('pre_tag_hash', hash)
    return !error && ok
  } catch {
    return false
  }
}

async function readRow(db: PretagDb, chatIntakeId: string): Promise<PretagRow | null> {
  try {
    const { data, error } = await db
      .from('chat_intakes')
      .select('pre_tag, pre_tag_hash, pre_tag_status, pre_tag_at')
      .eq('id', chatIntakeId)
      .maybeSingle()
    return error ? null : (data ?? null)
  } catch {
    return null
  }
}

export interface TakeOptions {
  now?:    () => number
  sleep?:  (ms: number) => Promise<void>
  waitMs?: number
}

/**
 * The pre-computed tag for this exact tagger input, or null (then the caller tags as it always did). If a run for the same
 * input is still in flight it is waited for — up to PRETAG_WAIT_MS, never longer than tagging from scratch would take.
 * A tag is used once: it is marked 'used' and cleared.
 */
export async function takePretag(db: PretagDb, chatIntakeId: string, hash: string, opts: TakeOptions = {}): Promise<OntologyTag | null> {
  const now   = opts.now   ?? Date.now
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)))
  const deadline = now() + (opts.waitMs ?? PRETAG_WAIT_MS)

  for (;;) {
    const row = await readRow(db, chatIntakeId)
    if (!row || row.pre_tag_hash !== hash) return null                       // nothing, columns missing, or a different input
    const age = row.pre_tag_at ? now() - Date.parse(row.pre_tag_at) : Infinity

    if (row.pre_tag_status === 'ready') {
      const tag = row.pre_tag as OntologyTag | null
      if (!tag || age > PRETAG_FRESH_MS || !validateTag(tag)) return null
      try { await db.from('chat_intakes').update({ pre_tag: null, pre_tag_status: 'used', pre_tag_at: new Date(now()).toISOString() }).eq('id', chatIntakeId).eq('pre_tag_hash', hash) } catch { /* best-effort */ }
      return tag
    }
    if (row.pre_tag_status === 'pending' && age <= PRETAG_PENDING_STALE_MS && now() < deadline) {
      await sleep(PRETAG_POLL_MS)
      continue
    }
    return null                                                              // failed, used, abandoned, or we ran out of patience
  }
}

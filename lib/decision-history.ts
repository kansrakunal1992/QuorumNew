// lib/decision-history.ts
// -- Phase 2 (retention work): one person's recent decisions, by best identity -
// Server-side helper. Merges rows linked to a user_id with rows that only carry
// the same device_id, because chat-flow sessions created before the Phase 0
// auth-header fix (and anonymous sessions in general) have device_id but a null
// user_id. Without the device half, an anonymous person's D2 has nothing to be
// compared against, and a signed-in person's pre-fix history goes missing.
//
// Two separate queries merged by id (not a PostgREST .or() string) so no
// caller-supplied value is ever interpolated into a filter expression. The
// device id is additionally format-checked.

import type { SupabaseClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/encryption'
import type { DecisionRow } from '@/lib/cross-decision-observations'

const DEVICE_RE = /^[A-Za-z0-9_-]{8,80}$/
const COLS = 'id, created_at, optimization_priority, initial_instinct, final_decision, prediction_matched_final'

export async function loadDecisionRows(
  supabase: SupabaseClient,
  who: { userId?: string | null; deviceId?: string | null },
  opts: { limit?: number; excludeId?: string; requireFinal?: boolean } = {},
): Promise<DecisionRow[]> {
  const limit = opts.limit ?? 12
  const merged = new Map<string, any>()

  const run = async (col: 'user_id' | 'device_id', value: string) => {
    let q = supabase.from('sessions').select(COLS).eq(col, value)
    if (opts.requireFinal) q = q.not('final_decision', 'is', null)
    if (opts.excludeId) q = q.neq('id', opts.excludeId)
    const { data, error } = await q.order('created_at', { ascending: false }).limit(limit)
    if (error) { console.warn('[decision-history] query failed:', error.message); return }
    for (const r of data ?? []) merged.set(r.id as string, r)
  }

  if (who.userId) await run('user_id', who.userId)
  if (who.deviceId && DEVICE_RE.test(who.deviceId)) await run('device_id', who.deviceId)

  return Array.from(merged.values())
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    .slice(0, limit)
    .map(r => ({
      id:                       r.id as string,
      created_at:               r.created_at as string,
      optimization_priority:    (r.optimization_priority as string | null) ?? null,
      initial_instinct:         (r.initial_instinct as string | null) ?? null,
      final_decision_plain:     r.final_decision ? (decrypt(r.final_decision as string) ?? null) : null,
      prediction_matched_final: (r.prediction_matched_final as boolean | null) ?? null,
    }))
}

/**
 * How many decisions this person had made when `session` was made, counting it. Looks at rows linked to their user_id
 * AND rows that only share the device_id (same reasoning as loadDecisionRows above), de-duplicated by id. Used to word
 * Quorum's guess honestly on the Record and the PDF: a person's first few decisions were guessed from general patterns,
 * not from their own history (see lib/record-arc.ts). Capped at 10 per source — callers only compare against ~3.
 * Fails soft to 1: an unknown count must not turn a first decision into an authoritative-sounding "surprised Quorum".
 */
export async function countDecisionsThrough(
  supabase: SupabaseClient,
  session: { id: string; created_at: string; user_id?: string | null; device_id?: string | null },
): Promise<number> {
  const ids = new Set<string>([session.id])
  const run = async (col: 'user_id' | 'device_id', value: string) => {
    const { data, error } = await supabase
      .from('sessions').select('id').eq(col, value).lte('created_at', session.created_at).limit(10)
    if (error) { console.warn('[decision-history] countDecisionsThrough failed:', error.message); return }
    for (const r of data ?? []) ids.add(r.id as string)
  }
  if (session.user_id) await run('user_id', session.user_id)
  if (session.device_id && DEVICE_RE.test(session.device_id)) await run('device_id', session.device_id)
  return ids.size
}

// ── v16: rows for the Mirror overview (lib/mirror-insights.ts) ────────────────
// Same identity merge as loadDecisionRows (user_id, plus rows that only share the device_id), with the extra facts the
// "watch" insights need: whether the Council ran, whether a decision was committed, the check-in date, and whether an outcome
// was recorded. `withSnippets` decrypts the first words of each decision for the evidence list; only pass it for the
// signed-in owner. Anonymous callers get counts and no text (see app/api/mirror/overview/route.ts).
const INSIGHT_COLS = `${COLS}, decision_text, session_depth, final_decision_locked_at, commitment_review_date, pre_decision_confidence`

export async function loadInsightRows(
  supabase: SupabaseClient,
  who: { userId?: string | null; deviceId?: string | null },
  opts: { limit?: number; withSnippets?: boolean } = {},
): Promise<import('@/lib/mirror-insights').InsightRow[]> {
  const limit = opts.limit ?? 12
  const merged = new Map<string, any>()

  const run = async (col: 'user_id' | 'device_id', value: string) => {
    const { data, error } = await supabase.from('sessions').select(INSIGHT_COLS).eq(col, value)
      .order('created_at', { ascending: false }).limit(limit)
    if (error) { console.warn('[decision-history] insight query failed:', error.message); return }
    for (const r of data ?? []) merged.set(r.id as string, r)
  }
  if (who.userId) await run('user_id', who.userId)
  if (who.deviceId && DEVICE_RE.test(who.deviceId)) await run('device_id', who.deviceId)

  const rows = Array.from(merged.values())
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    .slice(0, limit)
  if (rows.length === 0) return []

  // Which of these have an outcome recorded? If this lookup FAILS we do not know, and "unknown" must never read as "none recorded":
  // that would tell someone a check-in is waiting when they already answered it. So on failure every row is treated as having an
  // outcome, which only hides the "watch" insights (the safe direction) and leaves the learned ones untouched.
  // v17: the same lookup also carries the retrospective confidence and the outcome quality the calibration insights rest on.
  const outcomeBySession = new Map<string, { retro: number | null; quality: string | null }>()
  const { data: outs, error: outErr } = await supabase.from('outcomes')
    .select('session_id, retrospective_confidence, outcome_quality')
    .in('session_id', rows.map(r => r.id as string))
  if (outErr) console.warn('[decision-history] outcomes lookup failed:', outErr.message)
  const outcomesKnown = !outErr
  for (const o of outs ?? []) {
    outcomeBySession.set(o.session_id as string, {
      retro:   typeof o.retrospective_confidence === 'number' ? o.retrospective_confidence : null,
      quality: (o.outcome_quality as string | null) ?? null,
    })
  }

  return rows.map(r => ({
    id:                       r.id as string,
    created_at:               r.created_at as string,
    optimization_priority:    (r.optimization_priority as string | null) ?? null,
    initial_instinct:         (r.initial_instinct as string | null) ?? null,
    final_decision_plain:     r.final_decision ? (decrypt(r.final_decision as string) ?? null) : null,
    prediction_matched_final: (r.prediction_matched_final as boolean | null) ?? null,
    decision_snippet:         opts.withSnippets && r.decision_text ? (decrypt(r.decision_text as string) ?? null) : null,
    session_depth:            (r.session_depth as 'checkpoint' | 'council' | null) ?? null,
    locked:                   !!r.final_decision_locked_at,
    review_date:              (r.commitment_review_date as string | null) ?? null,
    has_outcome:              outcomesKnown ? outcomeBySession.has(r.id as string) : true,
    // Calibration needs an outcome we actually read. If the lookup failed these stay null, so no calibration insight is made.
    pre_confidence:           typeof r.pre_decision_confidence === 'number' ? r.pre_decision_confidence : null,
    retro_confidence:         outcomesKnown ? (outcomeBySession.get(r.id as string)?.retro ?? null) : null,
    outcome_quality:          outcomesKnown ? (outcomeBySession.get(r.id as string)?.quality ?? null) : null,
  }))
}


// ── v17: stored contradictions, for the signed-in owner only ─────────────────
// Reads what the existing detector already wrote (contradictions table), never runs it. Returns the non-dismissed rows plus the
// two decisions each refers to (first words, decrypted), restricted to sessions that belong to this user. The caller
// (lib/mirror-insights.ts buildContradictionInsight) decides whether any is safe to show.
export async function loadStoredContradictions(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ stored: import('@/lib/mirror-insights').StoredContradiction[]; sessions: import('@/lib/mirror-insights').ContradictionSession[] }> {
  const { data: rows, error } = await supabase
    .from('contradictions')
    .select('id, principle_text, principle_session_id, violation_text, violation_session_id, severity, generated_at')
    .eq('user_id', userId)
    .is('dismissed_at', null)
    .order('generated_at', { ascending: false })
    .limit(5)
  if (error || !rows?.length) return { stored: [], sessions: [] }

  const ids = Array.from(new Set(rows.flatMap(r => [r.principle_session_id, r.violation_session_id]).filter(Boolean) as string[]))
  const { data: sess } = await supabase.from('sessions').select('id, decision_text, created_at').eq('user_id', userId).in('id', ids)
  return {
    stored: rows as import('@/lib/mirror-insights').StoredContradiction[],
    sessions: (sess ?? []).map(x => ({
      id: x.id as string,
      snippet: ((x.decision_text ? decrypt(x.decision_text as string) : '') ?? '').trim().replace(/\s+/g, ' ').slice(0, 80),
      created_at: x.created_at as string,
    })),
  }
}

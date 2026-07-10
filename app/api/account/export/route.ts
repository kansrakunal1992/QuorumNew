// app/api/account/export/route.ts
// ── Sprint 6 (S6-02) — GDPR Data Export (Art. 20 Portability) ────────────────
//
// GET /api/account/export
// Auth: Authorization: Bearer <supabase_access_token>
//
// Collects and decrypts all data for the authenticated user and returns it
// as a downloadable JSON file. Rate-limited to 1 export per 24 hours per user.
//
// Response on success:
//   Content-Disposition: attachment; filename="quorum-data-export-YYYY-MM-DD.json"
//   Content-Type: application/json
//
// Logs to audit_log.
//
// QC fix (audit pass, July 2026) — two issues fixed:
//   1. The sessions query embedded `examiner_responses ( question_index,
//      question_text, answer_text, created_at )` — but the real columns are
//      `question_order` and `response_text` (see app/api/examiner/route.ts
//      insert + lib/encryption.ts's documented column list). Referencing
//      non-existent columns in a Supabase embedded select fails the entire
//      query server-side, and this route never checked sessionsResult.error —
//      so exports were silently returning ~empty JSON (no sessions, no
//      messages) with a 200 OK, no error surfaced anywhere. Fixed the column
//      names, switched to select('*') on embedded/added tables to remove this
//      whole class of typo risk, and added explicit error checking.
//   2. Only sessions + bias_library were exported. Cross-referencing every
//      .from('table') call in the codebase turned up 11 more user-data
//      tables not included. Added below: outcomes, sessions_ontology,
//      watchlist_items, graph_edges, contradictions, structural_matches,
//      user_preferences, avoidance_alerts, independence_score_log,
//      mirror_access, user_profiles, push_subscriptions.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse }              from 'next/server'
import { createServiceClient }       from '@/lib/supabase'
import { decrypt, decryptJson }      from '@/lib/encryption'
import { writeAuditLog, getUserFromBearer, getAuditContext } from '@/lib/audit'

// ── In-memory rate limit: 1 export per 24h per user ──────────────────────────
const exportCooldown = new Map<string, number>()  // userId → lastExportMs
const EXPORT_COOLDOWN_MS = 24 * 60 * 60 * 1000

export async function GET(req: Request) {
  const ctx = getAuditContext(req)

  // ── 1. Auth ───────────────────────────────────────────────────────────────
  const user = await getUserFromBearer(req)
  if (!user) {
    return NextResponse.json(
      { error: 'Authentication required. Sign in and retry.' },
      { status: 401 }
    )
  }

  // ── 2. Rate limit ─────────────────────────────────────────────────────────
  const lastExport = exportCooldown.get(user.id) ?? 0
  const cooldownRemaining = EXPORT_COOLDOWN_MS - (Date.now() - lastExport)
  if (cooldownRemaining > 0) {
    const hoursLeft = Math.ceil(cooldownRemaining / 3_600_000)
    return NextResponse.json(
      {
        error: 'Export limit reached',
        message: `You can request one export per 24 hours. Try again in ${hoursLeft} hour${hoursLeft !== 1 ? 's' : ''}.`,
      },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(cooldownRemaining / 1000)) } }
    )
  }

  // ── 3. Fetch all user data ─────────────────────────────────────────────────
  const supabase = createServiceClient()

  const [
    sessionsResult,
    biasResult,
  ] = await Promise.all([
    supabase
      .from('sessions')
      .select(`
        id, created_at, status, register_mode,
        decision_text, context_text, pre_decision_confidence,
        user_email, device_id,
        messages ( * ),
        examiner_responses ( * )
      `)
      .eq('user_id', user.id)
      .order('created_at', { ascending: false }),
    supabase
      .from('bias_library')
      .select('bias_parameter, detection_count, asymmetry_score_avg, session_ids, updated_at')
      .or(`user_id.eq.${user.id}${user.email ? `,user_email.eq.${user.email}` : ''}`),
  ])

  // QC fix: previously not checked — a query error (e.g. bad column name)
  // meant sessionsResult.data was null, silently treated as [] below, and the
  // export "succeeded" with none of the user's actual data in it.
  if (sessionsResult.error) {
    console.error('[Account/Export] sessions query failed:', sessionsResult.error)
    return NextResponse.json(
      { error: 'Failed to gather your data. Contact support — this has been logged.' },
      { status: 500 }
    )
  }

  const sessionIds = (sessionsResult.data ?? []).map(s => s.id as string)

  const [
    outcomesResult,
    ontologyResult,
    watchlistResult,
    graphEdgesResult,
    contradictionsResult,
    structuralMatchesResult,
    userPreferencesResult,
    avoidanceAlertsResult,
    independenceScoreLogResult,
    mirrorAccessResult,
    userProfileResult,
    pushSubscriptionsResult,
    institutionMembershipsResult,
    cohortMembershipsResult,
    consentAuditLogResult,
    userInstitutionPreferenceResult,
    seenUnlockNoticesResult,
  ] = await Promise.all([
    sessionIds.length
      ? supabase.from('outcomes').select('*').in('session_id', sessionIds)
      : Promise.resolve({ data: [], error: null }),
    sessionIds.length
      ? supabase.from('sessions_ontology').select('*').in('session_id', sessionIds)
      : Promise.resolve({ data: [], error: null }),
    supabase.from('watchlist_items').select('*').eq('user_id', user.id),
    supabase.from('graph_edges').select('*').eq('user_id', user.id),
    supabase.from('contradictions').select('*').eq('user_id', user.id),
    supabase.from('structural_matches').select('*').eq('user_id', user.id),
    supabase.from('user_preferences').select('*').eq('user_id', user.id),
    supabase.from('avoidance_alerts').select('*').eq('user_id', user.id),
    supabase.from('independence_score_log').select('*').eq('user_id', user.id),
    supabase.from('mirror_access').select('*').eq('user_id', user.id),
    supabase.from('user_profiles').select('*').eq('user_id', user.id).maybeSingle(),
    supabase.from('push_subscriptions').select('*').eq('user_id', user.id),
    // QC fix (audit pass, July 2026, round 2) — Institutional Sprints 1-3
    // tables, added after the first GDPR pass. institutions/cohorts
    // themselves aren't exported (org-level, not this user's data) — just
    // this user's membership/consent rows, with names joined in for
    // readability since IDs alone aren't meaningful here.
    supabase.from('institution_memberships').select('*, institutions(name)').eq('user_id', user.id),
    supabase.from('cohort_memberships').select('*, cohorts(name)').eq('user_id', user.id),
    supabase.from('consent_audit_log').select('*').eq('user_id', user.id),
    // Institutional Sprint 5 — same gap, closed proactively this time
    // rather than in a follow-up pass: an account-level preference and a
    // UI-state flag, both genuinely this user's data.
    supabase.from('user_institution_preference').select('*').eq('user_id', user.id),
    supabase.from('seen_unlock_notices').select('*').eq('user_id', user.id),
  ])

  // ── 4. Decrypt encrypted fields ────────────────────────────────────────────
  // Per lib/encryption.ts's documented column list:
  //   sessions (decision_text, context_text), messages (content),
  //   examiner_responses (question_text, response_text), outcomes
  //   (what_decided, notes), structural_matches (context_block, matches_json),
  //   graph_edges (explanation_text), watchlist_items (text_encrypted).
  const sessions = (sessionsResult.data ?? []).map(s => ({
    ...s,
    decision_text: decrypt(s.decision_text as string) ?? s.decision_text,
    context_text:  decrypt(s.context_text  as string) ?? s.context_text,
    messages: (s.messages as Array<Record<string, unknown>>)?.map(m => ({
      ...m,
      content: decrypt(m.content as string) ?? m.content,
    })),
    examiner_responses: (s.examiner_responses as Array<Record<string, unknown>>)?.map(e => ({
      ...e,
      question_text: decrypt(e.question_text as string) ?? e.question_text,
      response_text: decrypt(e.response_text as string) ?? e.response_text,
    })),
  }))

  const outcomes = (outcomesResult.data ?? []).map(o => ({
    ...o,
    what_decided: decrypt(o.what_decided as string) ?? o.what_decided,
    notes:        decrypt(o.notes as string) ?? o.notes,
  }))

  const watchlistItems = (watchlistResult.data ?? []).map(w => ({
    ...w,
    text: decrypt(w.text_encrypted as string) ?? w.text_encrypted,
  }))

  const graphEdges = (graphEdgesResult.data ?? []).map(g => ({
    ...g,
    explanation_text: g.explanation_text
      ? (decrypt(g.explanation_text as string) ?? g.explanation_text)
      : null,
  }))

  const structuralMatches = (structuralMatchesResult.data ?? []).map(m => ({
    ...m,
    context_block: decrypt(m.context_block as string) ?? m.context_block,
    matches_json:  decryptJson(m.matches_json),
  }))

  // ── 5. Assemble export payload ─────────────────────────────────────────────
  const exportDate = new Date().toISOString().split('T')[0]
  const payload = {
    exported_at:   new Date().toISOString(),
    export_format: '1.1',
    user: {
      id:    user.id,
      email: user.email,
    },
    summary: {
      session_count:  sessions.length,
      message_count:  sessions.reduce((n, s) => n + ((s.messages as unknown[])?.length ?? 0), 0),
      bias_parameters: (biasResult.data ?? []).length,
      watchlist_items: watchlistItems.length,
      contradictions:  (contradictionsResult.data ?? []).length,
    },
    sessions,
    outcomes,
    sessions_ontology:     ontologyResult.data ?? [],
    bias_library:          biasResult.data ?? [],
    watchlist_items:       watchlistItems,
    graph_edges:           graphEdges,
    contradictions:        contradictionsResult.data ?? [],
    structural_matches:    structuralMatches,
    user_preferences:      userPreferencesResult.data ?? [],
    avoidance_alerts:      avoidanceAlertsResult.data ?? [],
    independence_score_log: independenceScoreLogResult.data ?? [],
    mirror_access:         mirrorAccessResult.data ?? [],
    user_profile:          userProfileResult.data ?? null,
    push_subscriptions:    pushSubscriptionsResult.data ?? [],
    institution_memberships: institutionMembershipsResult.data ?? [],
    cohort_memberships:      cohortMembershipsResult.data ?? [],
    consent_audit_log:       consentAuditLogResult.data ?? [],
    user_institution_preference: userInstitutionPreferenceResult.data ?? [],
    seen_unlock_notices:         seenUnlockNoticesResult.data ?? [],
  }

  // ── 6. Record export in cooldown + audit log ───────────────────────────────
  exportCooldown.set(user.id, Date.now())

  // Non-blocking — don't await
  writeAuditLog({
    actor_id:    user.id,
    actor_email: user.email ?? undefined,
    action:      'account.export',
    ...ctx,
    metadata: {
      session_count: payload.summary.session_count,
    },
  })

  // ── 7. Return as downloadable JSON ─────────────────────────────────────────
  return new Response(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      'Content-Type':        'application/json',
      'Content-Disposition': `attachment; filename="quorum-data-export-${exportDate}.json"`,
      'Cache-Control':       'no-store',
    },
  })
}

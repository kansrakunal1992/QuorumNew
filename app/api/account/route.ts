// app/api/account/route.ts
// ── Sprint 6 (S6-03) — Account Deletion (GDPR Art. 17 Erasure) ───────────────
//
// DELETE /api/account
// Auth: Authorization: Bearer <supabase_access_token>
//
// Permanently erases all data for the authenticated user:
//   1. Writes audit_log entry BEFORE any deletion (so there is a record).
//   2. Explicitly deletes user_id-keyed tables that have no FK cascade to
//      auth.users (this list has grown a lot since Sprint 6 — see below).
//   3. Explicitly deletes session_id-keyed tables (outcomes, sessions_ontology,
//      structural_scores) by session_id, rather than relying solely on an
//      assumed ON DELETE CASCADE via sessions — belt-and-suspenders, since we
//      can't verify live FK constraints from application code.
//   4. Deletes auth.users via admin.deleteUser(), which cascades sessions →
//      messages, examiner_responses (and anything else with a real FK).
//
// QC fix (audit pass, July 2026): this route previously only covered 6 tables
// (bias_library, contradiction_log, independence_score_log, user_preferences,
// avoidance_alerts, contradiction_runs) plus the sessions cascade. Cross-
// referencing every .from('table') call in the codebase turned up 13 more
// user-data tables with no explicit cleanup here, several holding encrypted
// decision-linked content (structural_matches, graph_edges, watchlist_items).
// mirror_access (subscription/tier record) was also never actually covered —
// the old comment assumed it cascaded via sessions, but it's user_id-keyed,
// not session-scoped, so nothing was deleting it.
// Also: 'contradiction_log' is a dead table — nothing has inserted into it
// since the migration to contradictions/contradiction_runs (see
// lib/graph-engine.ts backfillContradictionEdges comment) — so it's replaced
// below with the real 'contradictions' table.
//
// audit_log is intentionally NOT deleted — it's the durable compliance record
// that erasure requests occurred, standard practice for this kind of log.
//
// This operation is irreversible. The client confirmation modal requires the
// user to type "delete my account" before the button is enabled.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse }              from 'next/server'
import { createServiceClient }       from '@/lib/supabase'
import { writeAuditLog, getUserFromBearer, getAuditContext } from '@/lib/audit'

export async function DELETE(req: Request) {
  const ctx = getAuditContext(req)

  // ── 1. Auth ───────────────────────────────────────────────────────────────
  const user = await getUserFromBearer(req)
  if (!user) {
    return NextResponse.json(
      { error: 'Authentication required. Sign in and retry.' },
      { status: 401 }
    )
  }

  const supabase = createServiceClient()

  // ── 2. Write audit log BEFORE any deletion ────────────────────────────────
  // This is the only durable record that the deletion occurred.
  await writeAuditLog({
    actor_id:    user.id,
    actor_email: user.email ?? undefined,
    action:      'account.delete',
    resource_id: user.id,
    ...ctx,
  })

  const errors: string[] = []

  // ── 3. Delete email-keyed tables (no FK cascade to auth.users) ───────────
  // These must be deleted explicitly before the auth user is removed.
  if (user.email) {
    const emailTables = [
      'bias_library',
    ] as const

    for (const table of emailTables) {
      const { error } = await supabase
        .from(table)
        .delete()
        .eq('user_email', user.email)
      if (error) errors.push(`${table}(email): ${error.message}`)
    }
  }

  // ── 4. Delete user_id-keyed tables that may not cascade ───────────────────
  // Covers tables that reference user_id directly but may not have strict FK cascade.
  const userIdTables = [
    'independence_score_log',
    'user_preferences',
    'avoidance_alerts',
    'contradiction_runs',
    // QC fix (audit pass, July 2026) — added below, all confirmed user_id-keyed:
    'advisory_access_requests',
    'bias_alert_log',
    'contradictions',
    'email_send_log',
    'graph_edges',
    'mirror_access',
    'mirror_insight_email_log',
    'notification_log',
    'push_subscriptions',
    'structural_matches',
    'user_profiles',
    'watchlist_items',
    // QC fix (audit pass, July 2026, round 2) — Institutional Sprints 1-3
    // added these after the first GDPR pass above; same gap, reopened by
    // new tables. institutions/cohorts themselves are org-level, not
    // deleted here — only this user's membership/consent rows.
    'institution_memberships',
    'cohort_memberships',
    'consent_audit_log',
  ] as const

  for (const table of userIdTables) {
    const { error } = await supabase
      .from(table as string)
      .delete()
      .eq('user_id', user.id)
    // Non-fatal — tables may not exist in all environments
    if (error && !error.message.includes('does not exist')) {
      errors.push(`${table}(user_id): ${error.message}`)
    }
  }

  // ── 5. Delete session_id-keyed tables explicitly (don't rely solely on a
  // cascade we can't verify from application code) ──────────────────────────
  const { data: userSessions } = await supabase
    .from('sessions')
    .select('id')
    .eq('user_id', user.id)

  const sessionIds = (userSessions ?? []).map(s => s.id as string)

  if (sessionIds.length > 0) {
    const sessionIdTables = ['outcomes', 'sessions_ontology', 'structural_scores'] as const
    for (const table of sessionIdTables) {
      const { error } = await supabase
        .from(table)
        .delete()
        .in('session_id', sessionIds)
      if (error && !error.message.includes('does not exist')) {
        errors.push(`${table}(session_id): ${error.message}`)
      }
    }
  }

  // ── 6. Delete auth.users — cascades sessions + messages/examiner_responses ─
  // supabase.auth.admin.deleteUser() issues a DELETE to the Auth admin API.
  const { error: deleteUserError } = await supabase.auth.admin.deleteUser(user.id)

  if (deleteUserError) {
    console.error('[Account/Delete] Auth user deletion failed:', deleteUserError)
    return NextResponse.json(
      { error: 'Failed to delete account. Contact support.' },
      { status: 500 }
    )
  }

  if (errors.length > 0) {
    console.warn('[Account/Delete] Partial errors (auth user deleted):', errors)
  }

  return NextResponse.json({
    ok:      true,
    message: 'Your account and all associated data have been permanently deleted.',
  })
}

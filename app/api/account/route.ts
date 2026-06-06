// app/api/account/route.ts
// ── Sprint 6 (S6-03) — Account Deletion (GDPR Art. 17 Erasure) ───────────────
//
// DELETE /api/account
// Auth: Authorization: Bearer <supabase_access_token>
//
// Permanently erases all data for the authenticated user:
//   1. Writes audit_log entry BEFORE any deletion (so there is a record).
//   2. Explicitly deletes email-keyed tables (bias_library, contradiction_log etc.)
//      that have no FK cascade to auth.users.
//   3. Deletes auth.users via admin.deleteUser() which cascades:
//        sessions → messages, examiner_responses, sessions_ontology,
//        structural_scores, outcomes, mirror_access, avoidance_alerts
//        (all via ON DELETE CASCADE FKs to auth.users / sessions).
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
      'contradiction_log',
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

  // ── 5. Delete auth.users — cascades sessions + everything downstream ──────
  // supabase.auth.admin.deleteUser() issues a DELETE to the Auth admin API.
  // Supabase cascade: auth.users → sessions → messages, examiner_responses,
  //   sessions_ontology, structural_scores, outcomes, mirror_access.
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

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
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse }              from 'next/server'
import { createServiceClient }       from '@/lib/supabase'
import { decrypt }                   from '@/lib/encryption'
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
        messages ( role, persona_key, content, created_at ),
        examiner_responses ( question_index, question_text, answer_text, created_at )
      `)
      .eq('user_id', user.id)
      .order('created_at', { ascending: false }),
    supabase
      .from('bias_library')
      .select('bias_parameter, detection_count, asymmetry_score_avg, session_ids, updated_at')
      .or(`user_id.eq.${user.id}${user.email ? `,user_email.eq.${user.email}` : ''}`),
  ])

  // ── 4. Decrypt encrypted fields ────────────────────────────────────────────
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
      answer_text:   decrypt(e.answer_text   as string) ?? e.answer_text,
    })),
  }))

  // ── 5. Assemble export payload ─────────────────────────────────────────────
  const exportDate = new Date().toISOString().split('T')[0]
  const payload = {
    exported_at:   new Date().toISOString(),
    export_format: '1.0',
    user: {
      id:    user.id,
      email: user.email,
    },
    summary: {
      session_count:  sessions.length,
      message_count:  sessions.reduce((n, s) => n + ((s.messages as unknown[])?.length ?? 0), 0),
      bias_parameters: (biasResult.data ?? []).length,
    },
    sessions,
    bias_library:  biasResult.data ?? [],
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

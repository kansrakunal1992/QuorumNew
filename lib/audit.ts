// lib/audit.ts
// ── Sprint 6 (S6-01) — Audit Log Helper ──────────────────────────────────────
//
// Write-only helper for the audit_log Supabase table.
// Uses createServiceClient() — bypasses RLS — so the table itself has no
// SELECT policy (users cannot read their own audit trail directly).
//
// Audit log failures are caught and logged to stderr — they must NEVER
// break the primary operation they're attached to.
// ─────────────────────────────────────────────────────────────────────────────

import { createServiceClient } from '@/lib/supabase'

// ── Known action strings ──────────────────────────────────────────────────────
// Extend this list as new auditable events are added.
export type AuditAction =
  | 'session.create'
  | 'auth.magic_link_sent'
  | 'account.export'
  | 'account.delete'
  | 'admin.access'
  | 'admin.auth_failed'
  | 'admin.locked_out'

export interface AuditEvent {
  actor_id?:    string                       // auth.users.id (when authenticated)
  actor_email?: string                       // for readability in the viewer
  action:       AuditAction | string         // string fallback for forward-compat
  resource_id?: string                       // session id, user id, etc.
  ip_address?:  string
  user_agent?:  string
  metadata?:    Record<string, unknown>      // any extra context
}

/**
 * Write one event to audit_log.
 * Always returns void — errors are swallowed so they never break callers.
 */
export async function writeAuditLog(event: AuditEvent): Promise<void> {
  try {
    const supabase = createServiceClient()
    const { error } = await supabase.from('audit_log').insert({
      actor_id:    event.actor_id    ?? null,
      actor_email: event.actor_email ?? null,
      action:      event.action,
      resource_id: event.resource_id ?? null,
      ip_address:  event.ip_address  ?? null,
      user_agent:  event.user_agent  ?? null,
      metadata:    event.metadata    ?? null,
    })
    if (error) {
      console.error('[AuditLog] DB write failed:', error.message)
    }
  } catch (err) {
    console.error('[AuditLog] Unexpected error:', err)
  }
}

/**
 * Extract standard request context (IP + user agent) for audit events.
 * Call this at the top of any route handler before the request body is consumed.
 */
export function getAuditContext(req: Request): { ip_address: string; user_agent: string } {
  return {
    ip_address: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown',
    user_agent: req.headers.get('user-agent') ?? 'unknown',
  }
}

/**
 * Resolve the authenticated user from a Bearer token.
 * Returns null without throwing if the token is missing or invalid.
 */
export async function getUserFromBearer(
  req: Request
): Promise<{ id: string; email: string | null } | null> {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return null
  const token = authHeader.slice(7).trim()
  if (!token) return null

  try {
    const { createClient } = await import('@/lib/supabase')
    const anonClient = createClient()
    const { data: { user } } = await anonClient.auth.getUser(token)
    if (!user) return null
    return { id: user.id, email: user.email ?? null }
  } catch {
    return null
  }
}

// app/api/admin/audit-log/route.ts
// ── Sprint 6 (S6-05) — Admin: Audit Log Viewer ───────────────────────────────
//
// GET /api/admin/audit-log
// Auth: Authorization: Bearer <ADMIN_CODE>
//
// Returns the 100 most recent audit_log entries, ordered by created_at desc.
// Columns: id, created_at, actor_email, action, resource_id, ip_address, metadata.
// actor_id is excluded from the response (internal UUID, not useful in the UI).
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse }        from 'next/server'
import { createServiceClient } from '@/lib/supabase'

export async function GET(req: Request) {
  // ── Auth guard (same ADMIN_CODE as dashboard) ─────────────────────────────
  const auth  = req.headers.get('Authorization') ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''

  if (!token || !process.env.ADMIN_CODE || token !== process.env.ADMIN_CODE) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const supabase = createServiceClient()

    const { data, error } = await supabase
      .from('audit_log')
      .select('id, created_at, actor_email, action, resource_id, ip_address, metadata')
      .order('created_at', { ascending: false })
      .limit(100)

    if (error) {
      // audit_log table may not exist yet if migration hasn't been run
      if (error.message.includes('does not exist')) {
        return NextResponse.json({ entries: [], warning: 'audit_log table not yet created — run sprint6_audit_log.sql' })
      }
      throw error
    }

    return NextResponse.json({ entries: data ?? [] })
  } catch (err) {
    console.error('[Admin/AuditLog] Error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// app/api/admin/case-studies/route.ts
// Item #11 — admin review queue for opt-in case-study submissions.
// Same auth convention as the rest of /api/admin/*: Authorization: Bearer <ADMIN_CODE>.
//
// GET  → list pending_review submissions (decrypted decision text included,
//        since a human reviewer needs the real context to write/edit the
//        final anonymized version — this is why the route is admin-only).
// POST → approve or reject a submission. Approving does NOT publish
//        anything automatically; it just marks the row reviewed. Actually
//        putting a case study on the marketing site remains a manual,
//        separate step, same as the illustrative copy already there.

import { NextResponse }        from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { decrypt }             from '@/lib/encryption'

function checkAuth(req: Request): boolean {
  const auth  = req.headers.get('Authorization') ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  return !!token && !!process.env.ADMIN_CODE && token === process.env.ADMIN_CODE
}

export async function GET(req: Request) {
  if (!checkAuth(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('case_study_submissions')
    .select('id, session_id, user_note, anonymized_draft, status, consent_given_at, created_at, sessions(decision_text, context_text)')
    .eq('status', 'pending_review')
    .order('created_at', { ascending: true })

  if (error) {
    console.error('[Admin Case Studies] DB error:', error)
    return NextResponse.json({ error: 'Failed to load submissions' }, { status: 500 })
  }

  const submissions = (data ?? []).map((row: any) => ({
    id:               row.id,
    session_id:       row.session_id,
    user_note:        row.user_note,
    anonymized_draft: row.anonymized_draft,
    consent_given_at: row.consent_given_at,
    created_at:       row.created_at,
    decision_text:    decrypt(row.sessions?.decision_text) ?? null,
    context_text:     decrypt(row.sessions?.context_text)  ?? null,
  }))

  return NextResponse.json({ submissions })
}

export async function POST(req: Request) {
  if (!checkAuth(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { id?: string; decision?: 'approved' | 'rejected' }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
  const { id, decision } = body
  if (!id || (decision !== 'approved' && decision !== 'rejected')) {
    return NextResponse.json({ error: 'Missing id or invalid decision' }, { status: 400 })
  }

  const supabase = createServiceClient()
  const { error } = await supabase
    .from('case_study_submissions')
    .update({ status: decision, reviewed_at: new Date().toISOString() })
    .eq('id', id)

  if (error) {
    console.error('[Admin Case Studies] Update error:', error)
    return NextResponse.json({ error: 'Failed to update submission' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

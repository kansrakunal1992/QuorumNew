// app/api/case-study/submit/route.ts
// Item #11 — real case-study capture, opt-in only (see item #12 decision:
// never default/opt-out). Nothing submitted here is ever shown publicly by
// itself — `anonymized_draft` is an AI-drafted starting point for a human
// reviewer, and `status` starts at 'pending_review'. See
// app/api/admin/case-studies/route.ts for the review/approval side.

import { createServiceClient, createClient } from '@/lib/supabase'
import { decrypt } from '@/lib/encryption'
import { createCompletion } from '@/lib/ai-client'
import { NextResponse } from 'next/server'

async function getUserId(req: Request): Promise<string | null> {
  const auth = req.headers.get('Authorization')
  if (!auth?.startsWith('Bearer ')) return null
  try {
    const anon = createClient()
    const { data: { user } } = await anon.auth.getUser(auth.slice(7).trim())
    return user?.id ?? null
  } catch { return null }
}

const ANONYMIZE_SYSTEM_PROMPT = `You are drafting a SHORT, anonymized case-study starting point from a user's
decision session, for a human reviewer to edit before anything is ever published.

Rules:
- Strip every name, company name, employer, specific place, and any other detail
  that could identify the person or the parties involved.
- Keep only the structural shape of the decision (the kind of decision it was,
  the tension in it, roughly how it resolved) — not verbatim specifics.
- Write 2-4 sentences, in third person ("A founder weighing..."), matching a
  calm, editorial tone — not marketing copy, not a testimonial voiced as a quote.
- If you cannot confidently anonymize something, omit it rather than guess.
- Output ONLY the draft text. No preamble, no headers, no quotation marks.`

export async function GET(req: Request) {
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })

  const url = new URL(req.url)
  const sessionId = url.searchParams.get('sessionId')
  if (!sessionId) return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 })

  const supabase = createServiceClient()
  const { data } = await supabase
    .from('case_study_submissions')
    .select('status')
    .eq('session_id', sessionId)
    .eq('user_id', userId)
    .maybeSingle()

  return NextResponse.json({ exists: !!data, status: data?.status ?? null })
}

export async function POST(req: Request) {
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })

  let body: { sessionId?: string; userNote?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
  const { sessionId, userNote } = body
  if (!sessionId) return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 })

  const supabase = createServiceClient()

  // Ownership check — this session must belong to the requesting user.
  const { data: session } = await supabase
    .from('sessions')
    .select('id, user_id, decision_text, context_text')
    .eq('id', sessionId)
    .maybeSingle()

  if (!session || session.user_id !== userId) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }

  // Already submitted — don't create a duplicate row (UNIQUE constraint would
  // reject it anyway, but this gives a clearer response).
  const { data: existing } = await supabase
    .from('case_study_submissions')
    .select('id')
    .eq('session_id', sessionId)
    .maybeSingle()
  if (existing) {
    return NextResponse.json({ error: 'Already submitted for this decision' }, { status: 409 })
  }

  // Best-effort draft generation — if this fails, we still record the
  // opt-in and leave anonymized_draft null for the reviewer to write by hand.
  let anonymizedDraft: string | null = null
  try {
    const decisionText = decrypt(session.decision_text) ?? ''
    const contextText  = decrypt(session.context_text)  ?? ''
    const prompt = `Decision: ${decisionText}\n\nContext: ${contextText}`.slice(0, 4000)
    anonymizedDraft = await createCompletion(prompt, 400, {
      provider:     'anthropic', // structured/careful task — Claude, per routing convention
      systemPrompt: ANONYMIZE_SYSTEM_PROMPT,
      temperature:  0.3,
    })
  } catch (err) {
    console.error('[Case Study Submit] Draft generation failed (non-fatal):', err)
  }

  const { error } = await supabase.from('case_study_submissions').insert({
    user_id:          userId,
    session_id:       sessionId,
    user_note:        userNote?.trim() || null,
    anonymized_draft: anonymizedDraft,
    status:           'pending_review',
  })

  if (error) {
    console.error('[Case Study Submit] DB error:', error)
    return NextResponse.json({ error: 'Failed to record submission' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

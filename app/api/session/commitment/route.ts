// app/api/session/commitment/route.ts
// ── Sprint Chunk 1 — Commitment Capture + Rule Recall ─────────────────────────
//
// POST   { sessionId, leaning, switch_condition, review_date }
//        → Saves post-synthesis commitment fields. All text fields encrypted.
//
// PATCH  { sessionId, rule_recall_choice, rule_recall_rule_text }
//        → Saves the user's rule recall action (applied | exception | ignored).
//          Called by RuleRecallBanner when user clicks an action button.
//
// GET    ?sessionId=X
//        → Returns commitment object or { commitment: null } if not captured.
//
// No auth required — sessionId is the access control (same as all session routes).
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse }        from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { encrypt, decrypt }    from '@/lib/encryption'

// ── POST — save DecisionStateCard submission ───────────────────────────────

export async function POST(req: Request) {
  try {
    const { sessionId, leaning, switch_condition, review_date } = await req.json()

    if (!sessionId) {
      return NextResponse.json({ error: 'sessionId required' }, { status: 400 })
    }

    const supabase = createServiceClient()

    const { error } = await supabase
      .from('sessions')
      .update({
        commitment_leaning:     leaning?.trim()          ? encrypt(leaning.trim())          : null,
        commitment_switch:      switch_condition?.trim() ? encrypt(switch_condition.trim()) : null,
        commitment_review_date: review_date              ? review_date                      : null,
        commitment_captured_at: new Date().toISOString(),
      })
      .eq('id', sessionId)

    if (error) {
      console.error('[commitment POST] supabase error:', error)
      return NextResponse.json({ error: 'Failed to save commitment' }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[commitment POST] error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// ── PATCH — save RuleRecallBanner choice ──────────────────────────────────

export async function PATCH(req: Request) {
  try {
    const { sessionId, rule_recall_choice, rule_recall_rule_text } = await req.json()

    if (!sessionId || !rule_recall_choice) {
      return NextResponse.json({ error: 'sessionId and rule_recall_choice required' }, { status: 400 })
    }

    const valid = ['applied', 'exception', 'ignored']
    if (!valid.includes(rule_recall_choice)) {
      return NextResponse.json({ error: 'Invalid choice — must be applied | exception | ignored' }, { status: 400 })
    }

    const supabase = createServiceClient()

    const { error } = await supabase
      .from('sessions')
      .update({
        rule_recall_choice,
        rule_recall_rule_text: rule_recall_rule_text?.trim()
          ? encrypt(rule_recall_rule_text.trim())
          : null,
      })
      .eq('id', sessionId)

    if (error) {
      console.error('[commitment PATCH] supabase error:', error)
      return NextResponse.json({ error: 'Failed to save rule recall choice' }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[commitment PATCH] error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// ── GET — return commitment data for a session ────────────────────────────

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const sessionId = searchParams.get('sessionId')

  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId required' }, { status: 400 })
  }

  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('sessions')
    .select('commitment_leaning, commitment_switch, commitment_review_date, commitment_captured_at')
    .eq('id', sessionId)
    .single()

  if (error || !data) {
    return NextResponse.json({ commitment: null })
  }

  if (!data.commitment_captured_at) {
    return NextResponse.json({ commitment: null })
  }

  return NextResponse.json({
    commitment: {
      leaning:          decrypt(data.commitment_leaning)  ?? null,
      switch_condition: decrypt(data.commitment_switch)   ?? null,
      review_date:      data.commitment_review_date       ?? null,
      captured_at:      data.commitment_captured_at,
    },
  })
}

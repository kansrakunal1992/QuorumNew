/**
 * QUORUM LEDGER — Ontology Tagger API Route
 * Sprint 1
 *
 * POST /api/ontology
 * Called internally after session creation. Not user-facing.
 * Runs the tagger and persists the result to sessions_ontology.
 *
 * Also exposes GET /api/ontology?sessionId=xxx for debugging
 * and for future Examiner Phase 0/1 reads.
 */

import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { tagDecision, validateTag, tagToInsert } from '@/lib/ontology-tagger'

// POST — tag a session (called internally, not user-facing)
export async function POST(req: Request) {
  try {
    const { sessionId, decisionText, contextText } = await req.json()

    if (!sessionId || !decisionText) {
      return NextResponse.json(
        { error: 'sessionId and decisionText are required' },
        { status: 400 }
      )
    }

    const supabase = createServiceClient()

    // Mark as pending immediately so we don't double-tag on retry
    await supabase.from('sessions_ontology').upsert(
      { session_id: sessionId, tagger_status: 'pending' },
      { onConflict: 'session_id' }
    )

    // Run the tagger
    const tag = await tagDecision(decisionText, contextText)

    if (!tag || !validateTag(tag)) {
      // Mark failed — don't crash the app, just log
      await supabase.from('sessions_ontology').upsert(
        { session_id: sessionId, tagger_status: 'failed' },
        { onConflict: 'session_id' }
      )
      console.error(`[Ontology] Tagging failed for session ${sessionId}`)
      return NextResponse.json({ ok: false, error: 'Tagging failed' }, { status: 500 })
    }

    // Persist
    const { error } = await supabase
      .from('sessions_ontology')
      .upsert(tagToInsert(sessionId, tag), { onConflict: 'session_id' })

    if (error) {
      console.error('[Ontology] Supabase insert error:', error)
      return NextResponse.json({ ok: false, error: 'DB insert failed' }, { status: 500 })
    }

    console.log(`[Ontology] Tagged session ${sessionId}: ${tag.decision_type_primary} | ${tag.instrumental_weight}i/${tag.constitutive_weight}c`)

    return NextResponse.json({ ok: true, tag })
  } catch (err) {
    console.error('[Ontology] Route error:', err)
    return NextResponse.json({ ok: false, error: 'Internal error' }, { status: 500 })
  }
}

// GET — fetch ontology tag for a session (for debugging + future Examiner reads)
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const sessionId = searchParams.get('sessionId')

  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId required' }, { status: 400 })
  }

  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('sessions_ontology')
    .select('*')
    .eq('session_id', sessionId)
    .single()

  if (error) {
    return NextResponse.json({ tag: null, status: 'not_found' })
  }

  return NextResponse.json({ tag: data })
}

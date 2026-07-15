// app/api/session/[id]/synthesis-version/route.ts
// P1: "What Changed" drawer support.
//
// POST — called by SynthesisCard right after each synthesis stream completes
// (fire-and-forget, non-blocking — a failed write here should never affect
// the synthesis the user is already looking at). Upserts on (session_id,
// version) so a duplicate call for the same version (e.g. a retry) is a
// no-op overwrite, not a new row.
//
// GET  — called server-side by app/session/[id]/page.tsx on page load, to
// restore version history after a reload. Same reload-resilience pattern as
// the Examiner context fix — without this, a refresh mid-deliberation would
// silently drop the "What Changed" drawer back to a single version.
//
// Read-only exposure level matches synthesis-summary/route.ts (session
// existing is the only check) — this is advisor labels/scores/lean
// classifications, not raw decision content.

import { NextResponse }        from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { encrypt, decrypt }    from '@/lib/encryption'

interface Params { params: Promise<{ id: string }> }

export async function POST(req: Request, { params }: Params) {
  try {
    const { id: sessionId } = await params
    if (!sessionId) return NextResponse.json({ error: 'sessionId required' }, { status: 400 })

    const { version, verdictText, weights, leans } = await req.json() as {
      version:     number
      verdictText?: string
      weights?:     Record<string, number>
      leans?:       Record<string, string>
    }

    if (typeof version !== 'number') {
      return NextResponse.json({ error: 'version required' }, { status: 400 })
    }

    const supabase = createServiceClient()
    const { error } = await supabase
      .from('synthesis_versions')
      .upsert({
        session_id:   sessionId,
        version,
        verdict_text: verdictText ? encrypt(verdictText) : null,
        weights:      weights ?? null,
        leans:        leans ?? null,
      }, { onConflict: 'session_id,version' })

    if (error) {
      console.error('[SynthesisVersion POST] supabase error:', error)
      return NextResponse.json({ error: 'Failed to save synthesis version' }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[SynthesisVersion POST] Route error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function GET(_req: Request, { params }: Params) {
  try {
    const { id: sessionId } = await params
    if (!sessionId) return NextResponse.json({ versions: [] })

    const supabase = createServiceClient()
    const { data } = await supabase
      .from('synthesis_versions')
      .select('version, verdict_text, weights, leans')
      .eq('session_id', sessionId)
      .order('version', { ascending: true })

    const versions = (data ?? []).map(row => ({
      version:     row.version,
      verdictText: row.verdict_text ? (decrypt(row.verdict_text) ?? '') : '',
      weights:     row.weights ?? {},
      leans:       row.leans ?? {},
    }))

    return NextResponse.json({ versions })
  } catch (err) {
    console.error('[SynthesisVersion GET] Route error:', err)
    return NextResponse.json({ versions: [] })
  }
}

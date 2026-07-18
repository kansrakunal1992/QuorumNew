// app/api/session/[id]/synthesis-summary/route.ts
// S2-08: Returns this session's tag-stripped synthesis text, for display in the Reanalyze
// drawer so the user can recall what the prior Council concluded before deciding what to
// change. Returns the FULL cleaned text — the client renders a short preview by default
// with a "Show more" toggle to expand, rather than truncating server-side with no way back.
// Read-only, no ownership check beyond session existing — same exposure level as the
// record page itself, which is already reachable via the session id.

import { NextResponse }        from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { decrypt }             from '@/lib/encryption'

interface Params { params: Promise<{ id: string }> }

function stripTags(raw: string): string {
  return raw
    .replace(/<verdict>[\s\S]*?<\/verdict>\n*/g, '')
    .replace(/<verdict>[\s\S]*/g, '')
    // P2 fix: this route has its own independent copy of tag-stripping logic
    // (not shared with SynthesisCard.tsx) — it never learned about the two
    // new tags added for the forced-verdict-with-conditions feature, so they
    // were leaking through raw into "What the Council concluded last time".
    .replace(/<verdict_lean>[\s\S]*?<\/verdict(?:_lean)?>\n*/g, '')
    .replace(/<conditions>[\s\S]*?<\/conditions>\n*/g, '')
    // Sprint 1 follow-on: same leak risk as verdict_lean/conditions above —
    // plain-text preview here, content-preserving strip keeps the sentence
    // in place as its own paragraph rather than dropping it.
    .replace(/<\/?key_question>/g, '')
    .replace(/<\/?tension>/g, '')
    .replace(/^\s+/, '')
    .trim()
}

export async function GET(_req: Request, { params }: Params) {
  try {
    const { id: sessionId } = await params
    if (!sessionId) return NextResponse.json({ full: null })

    const supabase = createServiceClient()
    const { data } = await supabase
      .from('messages')
      .select('content, created_at')
      .eq('session_id', sessionId)
      .eq('persona', 'synthesis')
      .eq('role', 'assistant')
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    if (!data?.content) return NextResponse.json({ full: null })

    const decrypted = decrypt(data.content)
    if (!decrypted) return NextResponse.json({ full: null })

    const cleaned = stripTags(decrypted)

    return NextResponse.json({ full: cleaned || null })
  } catch (err) {
    console.error('[SynthesisSummary] Route error:', err)
    return NextResponse.json({ full: null })
  }
}

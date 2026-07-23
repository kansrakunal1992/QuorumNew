// app/api/session/[id]/synthesis-summary/route.ts
// S2-08: Returns a short summary of this session's prior Council synthesis, for display in
// the Reanalyze drawer so the user can recall what was already concluded before deciding
// what to change.
//
// Bug fix (July 2026): this route used to strip the <verdict>/<verdict_lean>/<conditions>/
// <key_question> tags OUT of the synthesis and return whatever leftover narrative prose
// remained — i.e. everything EXCEPT the one-sentence conclusion and the "single most
// important thing to examine" paragraph, which are exactly the two purpose-built summary
// sentences the model already writes (see lib/personas.ts synthesis prompt: "Lead with the
// conclusion" / "the single most important thing to examine before deciding"). The client
// then hard-truncated that leftover prose at a fixed character count with no regard for
// sentence boundaries, so the drawer showed a stray mid-sentence fragment of the discussion
// that never even mentioned the actual verdict — the opposite of a summary.
//
// Fix: extract <verdict> and <key_question> (both already single, self-contained sentences/
// paragraphs by design) and return them directly as the summary. This is inherently concise
// — no server or client truncation needed — and always reads as a coherent conclusion plus
// the one open question worth confirming, because that's literally what those two tags are.
//
// Read-only, no ownership check beyond session existing — same exposure level as the
// record page itself, which is already reachable via the session id.

import { NextResponse }        from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { decrypt }             from '@/lib/encryption'

interface Params { params: Promise<{ id: string }> }

function extractTag(raw: string, tag: string): string {
  const m = raw.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`))
  return m ? m[1].trim() : ''
}

// Fallback for sessions saved before the verdict/key_question tags existed: take the
// first couple of sentences of the tag-stripped prose, split on sentence boundaries
// (never mid-word), so an old session still gets a short, coherent summary instead of
// either the entire synthesis or a jagged character-count cutoff.
function firstSentencesFallback(raw: string, maxSentences = 2, maxChars = 320): string {
  const cleaned = raw
    .replace(/<verdict>[\s\S]*?<\/verdict>\n*/g, '')
    .replace(/<verdict>[\s\S]*/g, '')
    .replace(/<verdict_lean>[\s\S]*?<\/verdict(?:_lean)?>\n*/g, '')
    .replace(/<conditions>[\s\S]*?<\/conditions>\n*/g, '')
    .replace(/<\/?key_question>/g, '')
    .replace(/<\/?tension>/g, '')
    .replace(/^\s+/, '')
    .trim()
  const sentences = cleaned.match(/[^.!?]+[.!?]+/g) ?? [cleaned]
  const joined = sentences.slice(0, maxSentences).join(' ').trim()
  return joined.length > maxChars ? `${joined.slice(0, maxChars).trimEnd()}…` : joined
}

export async function GET(_req: Request, { params }: Params) {
  try {
    const { id: sessionId } = await params
    if (!sessionId) return NextResponse.json({ summary: null })

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

    if (!data?.content) return NextResponse.json({ summary: null })

    const decrypted = decrypt(data.content)
    if (!decrypted) return NextResponse.json({ summary: null })

    const verdict     = extractTag(decrypted, 'verdict')
    const keyQuestion = extractTag(decrypted, 'key_question')

    let summary: string
    if (verdict) {
      summary = keyQuestion
        ? `${verdict} Worth confirming: ${keyQuestion.replace(/\.$/, '')}.`
        : verdict
    } else {
      // Older session, no verdict tag — sentence-bounded fallback.
      summary = firstSentencesFallback(decrypted)
    }

    return NextResponse.json({ summary: summary || null })
  } catch (err) {
    console.error('[SynthesisSummary] Route error:', err)
    return NextResponse.json({ summary: null })
  }
}

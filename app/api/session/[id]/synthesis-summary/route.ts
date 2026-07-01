// app/api/session/[id]/synthesis-summary/route.ts
// S2-08: Returns a short, tag-stripped excerpt of this session's synthesis, for display
// in the Reanalyze drawer so the user can recall what the prior Council concluded before
// deciding what to change. Read-only, no ownership check beyond session existing — same
// exposure level as the record page itself, which is already reachable via the session id.

import { NextResponse }        from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { decrypt }             from '@/lib/encryption'

interface Params { params: Promise<{ id: string }> }

const MAX_CHARS = 220

function stripTags(raw: string): string {
  return raw
    .replace(/<verdict>[\s\S]*?<\/verdict>\n*/g, '')
    .replace(/<verdict>[\s\S]*/g, '')
    .replace(/<\/?tension>/g, '')
    .replace(/^\s+/, '')
    .trim()
}

function truncate(text: string): string {
  if (text.length <= MAX_CHARS) return text
  const slice = text.slice(0, MAX_CHARS)
  const lastSpace = slice.lastIndexOf(' ')
  return `${slice.slice(0, lastSpace > 0 ? lastSpace : MAX_CHARS)}…`
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

    const cleaned  = stripTags(decrypted)
    const summary  = truncate(cleaned)

    return NextResponse.json({ summary: summary || null })
  } catch (err) {
    console.error('[SynthesisSummary] Route error:', err)
    return NextResponse.json({ summary: null })
  }
}

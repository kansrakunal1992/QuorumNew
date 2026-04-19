import { createServiceClient } from '@/lib/supabase'
import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  try {
    const { sessionId, what_decided, council_helped, notes } = await req.json()
    if (!sessionId || !what_decided || !council_helped) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }
    const supabase = createServiceClient()
    // Upsert so editing outcome works too
    const { error } = await supabase.from('outcomes').upsert({
      session_id:    sessionId,
      what_decided,
      council_helped,
      notes:         notes ?? null,
      updated_at:    new Date().toISOString(),
    }, { onConflict: 'session_id' })
    if (error) {
      console.error('Outcome upsert error:', error)
      return NextResponse.json({ error: 'Failed to save' }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('Outcome route error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const sessionId = searchParams.get('sessionId')
  if (!sessionId) return NextResponse.json({ error: 'sessionId required' }, { status: 400 })
  const supabase = createServiceClient()
  const { data } = await supabase
    .from('outcomes')
    .select('*')
    .eq('session_id', sessionId)
    .single()
  return NextResponse.json({ outcome: data ?? null })
}

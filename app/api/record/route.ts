import { createServiceClient } from '@/lib/supabase'
import { NextResponse } from 'next/server'

// POST — mark session as completed
export async function POST(req: Request) {
  try {
    const { sessionId } = await req.json()

    if (!sessionId) {
      return NextResponse.json({ error: 'sessionId is required' }, { status: 400 })
    }

    const supabase = createServiceClient()

    const { error } = await supabase
      .from('sessions')
      .update({ status: 'completed' })
      .eq('id', sessionId)

    if (error) {
      console.error('Record update error:', error)
      return NextResponse.json({ error: 'Failed to save record' }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('Record route error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// GET — fetch full decision record (session + all messages)
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const sessionId = searchParams.get('sessionId')

  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId is required' }, { status: 400 })
  }

  const supabase = createServiceClient()

  const [sessionResult, messagesResult] = await Promise.all([
    supabase.from('sessions').select('*').eq('id', sessionId).single(),
    supabase
      .from('messages')
      .select('*')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true }),
  ])

  if (sessionResult.error || !sessionResult.data) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }

  return NextResponse.json({
    session: sessionResult.data,
    messages: messagesResult.data ?? [],
  })
}

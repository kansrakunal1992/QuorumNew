import { createServiceClient } from '@/lib/supabase'
import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  try {
    const { ids }: { ids: string[] } = await req.json()
    if (!ids?.length) return NextResponse.json({ sessions: [] })

    const supabase = createServiceClient()

    const [sessionsResult, outcomesResult] = await Promise.all([
      supabase
        .from('sessions')
        .select('id, decision_text, created_at')
        .in('id', ids)
        .order('created_at', { ascending: false }),
      supabase
        .from('outcomes')
        .select('session_id, what_decided, council_helped')
        .in('session_id', ids),
    ])

    const outcomeMap = Object.fromEntries(
      (outcomesResult.data ?? []).map(o => [o.session_id, o])
    )

    const sessions = (sessionsResult.data ?? []).map(s => ({
      ...s,
      outcome: outcomeMap[s.id] ?? null,
    }))

    return NextResponse.json({ sessions })
  } catch (err) {
    console.error('History route error:', err)
    return NextResponse.json({ sessions: [] })
  }
}

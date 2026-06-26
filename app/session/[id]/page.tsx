import { notFound } from 'next/navigation'
import { createServiceClient } from '@/lib/supabase'
import SessionView from '@/components/SessionView'
import { decrypt } from '@/lib/encryption'
import { BIAS_PARAMETERS } from '@/lib/bias-scorer'  // SB-3: bias note above personas

interface Props {
  params: Promise<{ id: string }>
}

function decryptText(value: string | null | undefined): string | null {
  return decrypt(value) ?? null
}

export default async function SessionPage({ params }: Props) {
  const { id } = await params
  const supabase = createServiceClient()

  const { data: session, error } = await supabase.from('sessions').select('*').eq('id', id).single()

  if (error || !session) { notFound() }

  const [{ data: messages }, { count: totalSessionCount }] = await Promise.all([
    supabase.from('messages').select('persona, role, content').eq('session_id', id).order('created_at', { ascending: true }),
    session.user_id
      ? supabase.from('sessions').select('*', { count: 'exact', head: true }).eq('user_id', session.user_id)
      : Promise.resolve({ count: null }),
  ])

  // SB-3: Compute bias note server-side so it's ready to show above persona cards
  // on the live session view — same query as record/[id]/page.tsx, same precedence.
  // Only 'distorting' signal_type surfaced; shows the single strongest hit for this session.
  type SessionBiasCtx = { reasoning?: string; signal_type?: 'distorting' | 'neutral' | 'adaptive'; prosecutor_score?: number }
  let biasNote: { label: string; reasoning: string } | null = null
  {
    const identityCol = session.user_id ? 'user_id' : session.user_email ? 'user_email' : session.device_id ? 'device_id' : null
    const identityVal = session.user_id ?? session.user_email ?? session.device_id ?? null
    if (identityCol && identityVal) {
      const { data: biasRows } = await supabase
        .from('bias_library')
        .select('bias_parameter, activation_contexts')
        .eq(identityCol, identityVal)
        .contains('session_ids', [id])
      const top = (biasRows ?? [])
        .map(row => {
          const ctx = (row.activation_contexts as Record<string, SessionBiasCtx> | null)?.[id]
          return ctx ? { biasKey: row.bias_parameter as string, ctx } : null
        })
        .filter((c): c is { biasKey: string; ctx: SessionBiasCtx } => c !== null)
        .filter(c => c.ctx.signal_type === 'distorting' && !!c.ctx.reasoning)
        .sort((a, b) => (b.ctx.prosecutor_score ?? 0) - (a.ctx.prosecutor_score ?? 0))[0]
      if (top) {
        const param   = BIAS_PARAMETERS.find(b => b.key === top.biasKey)
        const label   = param?.label ?? top.biasKey.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
        const raw     = top.ctx.reasoning!.trim()
        const reasoning = raw.length > 220 ? raw.slice(0, 220).replace(/\s+\S*$/, '') + '…' : raw
        biasNote = { label, reasoning }
      }
    }
  }

  const decryptedSession = {
    ...session,
    decision_text: decryptText(session.decision_text) ?? '',
    context_text:  decryptText(session.context_text),
  }

  // Build personaKey → full assistant content map from stored messages
  // Only assistant messages; concatenate in order in case of multiple per persona
  const initialMessages: Record<string, string> = {}
  for (const msg of messages ?? []) {
    if (msg.role === 'assistant' && msg.persona && msg.content) {
      initialMessages[msg.persona] =
        (initialMessages[msg.persona] ?? '') + (decrypt(msg.content) ?? '')
    }
  }

  return <SessionView
    session={decryptedSession}
    initialMessages={initialMessages}
    totalSessionCount={totalSessionCount ?? undefined}
    encryptionEnabled={!!process.env.DB_ENCRYPTION_KEY}
    biasNote={biasNote}
  />
}

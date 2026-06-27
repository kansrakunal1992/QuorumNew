import { notFound }            from 'next/navigation'
import { createServiceClient } from '@/lib/supabase'
import SessionView             from '@/components/SessionView'
import { decrypt }             from '@/lib/encryption'

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

  const decryptedSession = {
    ...session,
    decision_text: decryptText(session.decision_text) ?? '',
    context_text:  decryptText(session.context_text),
  }

  // Build personaKey → full assistant content map from stored messages
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
  />
}

import { notFound } from 'next/navigation'
import { createServiceClient } from '@/lib/supabase'
import SessionView from '@/components/SessionView'

interface Props {
  params: Promise<{ id: string }>
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

  if (error || !session) {
    notFound()
  }

  // Build personaKey → full assistant content map from stored messages
  // Only assistant messages; concatenate in order in case of multiple per persona
  const initialMessages: Record<string, string> = {}
  for (const msg of messages ?? []) {
    if (msg.role === 'assistant' && msg.persona && msg.content) {
      initialMessages[msg.persona] = (initialMessages[msg.persona] ?? '') + msg.content
    }
  }

  return <SessionView session={session} initialMessages={initialMessages} totalSessionCount={totalSessionCount ?? undefined} />
}

import { notFound } from 'next/navigation'
import { createServiceClient } from '@/lib/supabase'
import SessionView from '@/components/SessionView'

interface Props {
  params: Promise<{ id: string }>
}

export default async function SessionPage({ params }: Props) {
  const { id } = await params
  const supabase = createServiceClient()

  const { data: session, error } = await supabase
    .from('sessions')
    .select('*')
    .eq('id', id)
    .single()

  if (error || !session) {
    notFound()
  }

  return <SessionView session={session} />
}

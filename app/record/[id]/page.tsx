import { notFound } from 'next/navigation'
import { createServiceClient } from '@/lib/supabase'
import RecordExport from '@/components/RecordExport'
import Link from 'next/link'
import { PERSONAS } from '@/lib/personas'
import type { PersonaKey } from '@/lib/types'

interface Props {
  params: Promise<{ id: string }>
}

const PERSONA_ORDER: PersonaKey[] = [
  'contrarian',
  'risk_architect',
  'pattern_analyst',
  'stakeholder_mirror',
  'elder',
  'competitor',
]

export default async function RecordPage({ params }: Props) {
  const { id } = await params
  const supabase = createServiceClient()

  const [sessionResult, messagesResult] = await Promise.all([
    supabase.from('sessions').select('*').eq('id', id).single(),
    supabase
      .from('messages')
      .select('*')
      .eq('session_id', id)
      .order('created_at', { ascending: true }),
  ])

  if (sessionResult.error || !sessionResult.data) {
    notFound()
  }

  const session = sessionResult.data
  const messages = messagesResult.data ?? []

  // Group by persona
  const byPersona: Record<string, { role: string; content: string }[]> = {}
  for (const msg of messages) {
    if (!byPersona[msg.persona]) byPersona[msg.persona] = []
    byPersona[msg.persona].push({ role: msg.role, content: msg.content })
  }

  const dateStr = new Date(session.created_at).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

  return (
    <div className="min-h-screen px-4 py-10">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <Link
              href="/"
              className="text-xs mb-3 block"
              style={{ color: '#4a5568' }}
            >
              ← New decision
            </Link>
            <span
              className="text-xl font-semibold tracking-widest uppercase"
              style={{ color: '#d4a843' }}
            >
              Quorum
            </span>
            <p className="text-xs mt-1" style={{ color: '#4a5568' }}>
              Decision Record · {dateStr}
            </p>
          </div>
          <RecordExport record={{ session, messages }} />
        </div>

        {/* Decision */}
        <div
          className="rounded-xl p-6 mb-8"
          style={{ background: '#0d1426', border: '1px solid #1a2645' }}
        >
          <p className="text-xs mb-3 font-medium" style={{ color: '#4a5568', letterSpacing: '0.1em' }}>
            THE DECISION
          </p>
          <p className="text-sm leading-relaxed" style={{ color: '#c8d0dc' }}>
            {session.decision_text}
          </p>
          {session.context_text && (
            <div
              className="mt-4 pt-4 text-xs leading-relaxed"
              style={{ borderTop: '1px solid #131d36', color: '#4a5568' }}
            >
              <span style={{ color: '#2a3a5c' }}>Context: </span>
              {session.context_text}
            </div>
          )}
        </div>

        {/* Persona sections */}
        <div className="flex flex-col gap-6">
          {PERSONA_ORDER.map((key) => {
            const msgs = byPersona[key]
            if (!msgs || msgs.length === 0) return null
            const persona = PERSONAS[key]

            return (
              <div
                key={key}
                className="rounded-xl overflow-hidden"
                style={{ background: '#0d1426', border: '1px solid #1a2645' }}
              >
                {/* Persona header */}
                <div
                  className="px-6 py-4"
                  style={{ borderBottom: '1px solid #131d36', background: '#080d1a' }}
                >
                  <p className="text-sm font-semibold" style={{ color: '#d4a843' }}>
                    {persona.label}
                  </p>
                  <p className="text-xs mt-0.5" style={{ color: '#4a5568' }}>
                    {persona.tagline}
                  </p>
                </div>

                {/* Messages */}
                <div className="px-6 py-5 flex flex-col gap-5">
                  {msgs.map((msg, i) => (
                    <div key={i}>
                      {msg.role === 'user' ? (
                        <div
                          className="rounded-lg px-4 py-3"
                          style={{ background: '#080d1a', border: '1px solid #131d36' }}
                        >
                          <p className="text-xs mb-1" style={{ color: '#4a5568' }}>
                            Your pushback
                          </p>
                          <p className="text-sm" style={{ color: '#8892a4' }}>
                            {msg.content}
                          </p>
                        </div>
                      ) : (
                        <p
                          className="text-sm leading-relaxed"
                          style={{ color: '#c8d0dc', whiteSpace: 'pre-wrap' }}
                        >
                          {msg.content}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>

        {/* Bottom export */}
        <div className="mt-10 flex justify-center gap-4">
          <RecordExport record={{ session, messages }} />
          <Link href="/">
            <button className="btn-ghost" style={{ padding: '10px 20px', fontSize: '13px' }}>
              New decision
            </button>
          </Link>
        </div>

        <p className="mt-8 text-center text-xs" style={{ color: '#1a2645' }}>
          Quorum · Private Decision Intelligence · Session {id.slice(0, 8)}
        </p>
      </div>
    </div>
  )
}

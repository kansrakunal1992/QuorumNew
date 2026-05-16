import { notFound } from 'next/navigation'
import { createServiceClient } from '@/lib/supabase'
import OutcomeTracker from '@/components/OutcomeTracker'
import BriefCTA from '@/components/BriefCTA'
import Link from 'next/link'
import ReanalyzeDrawer from '@/components/ReanalyzeDrawer'
import { PERSONAS } from '@/lib/personas'
import type { PersonaKey } from '@/lib/types'

interface Props {
  params: Promise<{ id: string }>
}

const PERSONA_ORDER: PersonaKey[] = [
  'decision_brief',
  'synthesis',
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

  const [sessionResult, messagesResult, outcomeResult] = await Promise.all([
    supabase.from('sessions').select('*').eq('id', id).single(),
    supabase.from('messages').select('*').eq('session_id', id).order('created_at', { ascending: true }),
    supabase.from('outcomes').select('*').eq('session_id', id).single(),
  ])

  if (sessionResult.error || !sessionResult.data) notFound()

  const session  = sessionResult.data
  const messages = messagesResult.data ?? []
  const outcome  = outcomeResult.data ?? null

  const dateStr = new Date(session.created_at).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })

  // Group by persona
  const byPersona: Record<string, { role: string; content: string }[]> = {}
  for (const msg of messages) {
    if (!byPersona[msg.persona]) byPersona[msg.persona] = []
    byPersona[msg.persona].push({ role: msg.role, content: msg.content })
  }

  return (
    <div className="min-h-screen px-4 py-10" style={{ background: 'var(--bg-void)' }}>
      <div className="max-w-3xl mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between mb-8" style={{ flexWrap: 'wrap', gap: 12 }}>
          <div>
            <Link href="/" className="text-xs mb-3 block" style={{ color: 'var(--text-4)' }}>
              ← New decision
            </Link>
            <span style={{ fontSize: 20, fontWeight: 700, letterSpacing: '0.2em', color: 'var(--gold)', textTransform: 'uppercase' }}>
              Quorum
            </span>
            <p style={{ fontSize: 11, color: 'var(--text-4)', marginTop: 4 }}>
              Decision Record · {dateStr}
            </p>
          </div>

        </div>

        {/* Decision */}
        <div style={{ borderRadius: 14, padding: '20px 24px', marginBottom: 20, background: 'var(--bg-card)', border: '1px solid var(--border-mid)' }}>
          <p style={{ fontSize: 11, marginBottom: 8, fontWeight: 500, color: 'var(--text-4)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            The Decision
          </p>
          <p style={{ fontSize: 14, lineHeight: 1.65, color: 'var(--text-2)' }}>
            {session.decision_text}
          </p>
          {session.context_text && (
            <div style={{ marginTop: 12, paddingTop: 12, fontSize: 12, color: 'var(--text-4)', borderTop: '1px solid var(--border-dim)', lineHeight: 1.6 }}>
              <span style={{ color: 'var(--text-3)' }}>Context: </span>
              {session.context_text}
            </div>
          )}
        </div>

        {/* Outcome tracker — prominent, right after the decision */}
        <div style={{ marginBottom: 16 }}>
          <OutcomeTracker sessionId={session.id} existingOutcome={outcome} />
          <div style={{ marginTop: 10, display: 'flex', justifyContent: 'flex-end' }}>
            <ReanalyzeDrawer
              sessionId={session.id}
              decisionText={session.decision_text}
              contextText={session.context_text}
              userId={session.user_id ?? null}
            />
            </div>
        </div>

        {/* Decision Brief CTA — Sprint 8 */}
        <div style={{ marginBottom: 24 }}>
          <BriefCTA sessionId={session.id} />
        </div>

        {/* Persona sections */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {PERSONA_ORDER.map(key => {
            const msgs = byPersona[key]
            if (!msgs || msgs.length === 0) return null
            const persona = PERSONAS[key]
            const isSynthesis = key === 'synthesis'
            const isBrief = key === 'decision_brief'

            return (
              <div
                key={key}
                style={{
                  borderRadius: 14,
                  overflow: 'hidden',
                  background: 'var(--bg-card)',
                  border: isBrief ? '1px solid rgba(201,168,76,0.3)' : isSynthesis ? '1px solid var(--green-border)' : '1px solid var(--border-dim)',
                }}
              >
                <div style={{
                  padding: '14px 20px',
                  borderBottom: '1px solid var(--border-dim)',
                  background: isBrief ? 'rgba(201,168,76,0.08)' : isSynthesis ? 'var(--green-soft)' : 'rgba(201,168,76,0.04)',
                }}>
                  <p style={{ fontSize: isBrief ? 14 : isSynthesis ? 13 : 12.5, fontWeight: 700, color: 'var(--gold)', letterSpacing: isBrief ? '0.1em' : '0' }}>
                    {persona.label}
                  </p>
                  <p style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>
                    {persona.tagline}
                  </p>
                </div>

                <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {msgs.map((msg, i) => (
                    <div key={i}>
                      {msg.role === 'user' ? (
                        <div style={{ borderRadius: 8, padding: '10px 14px', background: 'var(--bg-inset)', border: '1px solid var(--border-dim)' }}>
                          <p style={{ fontSize: 11, color: 'var(--text-4)', marginBottom: 4 }}>Your pushback</p>
                          <p style={{ fontSize: 13, color: 'var(--text-3)', lineHeight: 1.55 }}>{msg.content}</p>
                        </div>
                      ) : (
                        <p style={{ fontSize: 13.5, lineHeight: 1.8, color: 'var(--text-2)', whiteSpace: 'pre-wrap' }}>
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

        {/* Bottom */}
        <div style={{ marginTop: 32, display: 'flex', justifyContent: 'center', gap: 12, flexWrap: 'wrap' }}>
          <ReanalyzeDrawer
            sessionId={session.id}
            decisionText={session.decision_text}
            contextText={session.context_text}
            userId={session.user_id ?? null}
          />
          <Link href="/">
            <button className="btn-ghost" style={{ padding: '10px 20px', fontSize: 13 }}>
              New decision
            </button>
          </Link>
        </div>

        <p style={{ marginTop: 24, textAlign: 'center', fontSize: 11, color: 'var(--text-4)' }}>
          Quorum · Session {id.slice(0, 8)}
        </p>
      </div>
    </div>
  )
}

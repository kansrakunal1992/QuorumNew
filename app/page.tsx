'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function Home() {
  const router = useRouter()
  const [decision, setDecision] = useState('')
  const [context, setContext] = useState('')
  const [loading, setLoading] = useState(false)
  const [showContext, setShowContext] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async () => {
    if (!decision.trim() || decision.trim().length < 20) {
      setError('Please describe your decision in at least a sentence.')
      return
    }
    setError('')
    setLoading(true)

    try {
      const res = await fetch('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decision_text: decision.trim(),
          context_text: context.trim() || null,
        }),
      })

      if (!res.ok) throw new Error('Failed to create session')
      const { id } = await res.json()
      router.push(`/session/${id}`)
    } catch {
      setError('Something went wrong. Check your environment variables.')
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-4 py-16">
      {/* Wordmark */}
      <div className="mb-12 text-center">
        <div className="flex items-center justify-center gap-3 mb-4">
          <div className="w-8 h-8 rounded-full border border-yellow-600/40 flex items-center justify-center">
            <div className="w-2 h-2 rounded-full bg-yellow-500/60" />
          </div>
          <span
            className="text-2xl font-semibold tracking-widest uppercase"
            style={{ color: '#d4a843', letterSpacing: '0.25em' }}
          >
            Quorum
          </span>
        </div>
        <p className="text-sm" style={{ color: '#4a5568', letterSpacing: '0.1em' }}>
          PRIVATE DECISION INTELLIGENCE
        </p>
      </div>

      {/* Card */}
      <div
        className="w-full max-w-2xl rounded-2xl p-8"
        style={{ background: '#0d1426', border: '1px solid #1a2645' }}
      >
        <h1 className="text-xl font-medium mb-2" style={{ color: '#e8eaf0' }}>
          Describe your decision
        </h1>
        <p className="text-sm mb-6" style={{ color: '#4a5568' }}>
          Six advisors will review it simultaneously. Be specific — what you are
          considering, what you know, and what is making it difficult.
        </p>

        <textarea
          className="decision-input"
          rows={6}
          placeholder="e.g. I am considering selling my 40% stake in the family business to a PE firm at 8x EBITDA. The offer expires in 3 weeks. My co-founder wants to accept; I am unsure whether this is the right time given the business is growing 40% YoY..."
          value={decision}
          onChange={(e) => setDecision(e.target.value)}
        />

        <div className="mt-4">
          {!showContext ? (
            <button
              className="btn-ghost"
              onClick={() => setShowContext(true)}
            >
              + Add context (deal notes, emails, messages)
            </button>
          ) : (
            <div>
              <p className="text-xs mb-2" style={{ color: '#4a5568' }}>
                Paste any relevant context — emails, WhatsApp messages, meeting notes, term sheets
              </p>
              <textarea
                className="decision-input"
                rows={4}
                placeholder="Paste context here..."
                value={context}
                onChange={(e) => setContext(e.target.value)}
              />
            </div>
          )}
        </div>

        {error && (
          <p className="mt-4 text-sm" style={{ color: '#e05050' }}>
            {error}
          </p>
        )}

        <div className="mt-6">
          <button
            className="btn-primary w-full"
            onClick={handleSubmit}
            disabled={loading || !decision.trim()}
          >
            {loading ? 'Convening the Council…' : 'Convene the Council'}
          </button>
        </div>
      </div>

      {/* Persona hints */}
      <div className="mt-10 grid grid-cols-3 gap-3 w-full max-w-2xl">
        {[
          { label: 'The Contrarian', hint: 'Argues your instinct away' },
          { label: 'Risk Architect', hint: 'Pre-mortems all failures' },
          { label: 'Pattern Analyst', hint: 'Finds past analogues' },
          { label: 'Stakeholder Mirror', hint: 'Who else is affected' },
          { label: 'The Elder', hint: 'Decade-level wisdom' },
          { label: 'The Competitor', hint: 'Bets against you' },
        ].map((p) => (
          <div
            key={p.label}
            className="rounded-lg p-3 text-center"
            style={{ background: '#080d1a', border: '1px solid #131d36' }}
          >
            <p className="text-xs font-medium mb-1" style={{ color: '#d4a843' }}>
              {p.label}
            </p>
            <p className="text-xs" style={{ color: '#4a5568' }}>
              {p.hint}
            </p>
          </div>
        ))}
      </div>

      <p className="mt-10 text-xs text-center" style={{ color: '#2a3a5c' }}>
        Sessions are private and encrypted. Decision Records exportable as PDF.
      </p>
    </main>
  )
}

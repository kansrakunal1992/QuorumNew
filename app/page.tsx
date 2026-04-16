'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

/* ── Inline SVG icons (no dependency) ───────────────────── */
const IconScale = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3v18M3 9l9-6 9 6M5 12l-2 5h4L5 12zM19 12l-2 5h4l-2-5zM3 21h18"/>
  </svg>
)
const IconShield = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
  </svg>
)
const IconBrain = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96-.46 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.98-3A2.5 2.5 0 0 1 9.5 2z"/>
    <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96-.46 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.98-3A2.5 2.5 0 0 0 14.5 2z"/>
  </svg>
)
const IconUsers = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
    <circle cx="9" cy="7" r="4"/>
    <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>
  </svg>
)
const IconHourglass = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 22h14M5 2h14M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"/>
  </svg>
)
const IconSword = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5"/>
    <line x1="13" y1="19" x2="19" y2="13"/>
    <line x1="16" y1="16" x2="20" y2="20"/>
    <line x1="19" y1="21" x2="21" y2="19"/>
  </svg>
)
const IconContrary = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/>
    <line x1="15" y1="9" x2="9" y2="15"/>
    <line x1="9" y1="9" x2="15" y2="15"/>
  </svg>
)

/* ── Persona grid data ────────────────────────────────────── */
const PERSONAS = [
  { icon: <IconContrary />, label: 'The Contrarian',      hint: 'Argues your instinct away',    color: '#7c3a3a' },
  { icon: <IconShield />,   label: 'Risk Architect',       hint: 'Pre-mortems every failure',    color: '#3a4e7c' },
  { icon: <IconBrain />,    label: 'Pattern Analyst',      hint: 'Finds your past analogues',    color: '#2e5c4a' },
  { icon: <IconUsers />,    label: 'Stakeholder Mirror',   hint: 'Who else is affected',         color: '#5c3a7c' },
  { icon: <IconHourglass />,label: 'The Elder',            hint: 'Decade-level wisdom',          color: '#5c4a2e' },
  { icon: <IconSword />,    label: 'The Competitor',       hint: 'Bets against your choice',     color: '#4a3a2e' },
]

export default function Home() {
  const router = useRouter()
  const [decision, setDecision] = useState('')
  const [context, setContext]   = useState('')
  const [loading, setLoading]   = useState(false)
  const [showContext, setShowContext] = useState(false)
  const [error, setError]       = useState('')

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
        body: JSON.stringify({ decision_text: decision.trim(), context_text: context.trim() || null }),
      })
      if (!res.ok) throw new Error('Failed')
      const { id } = await res.json()
      router.push(`/session/${id}`)
    } catch {
      setError('Something went wrong. Check environment variables.')
      setLoading(false)
    }
  }

  return (
    <main style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '48px 20px', background: 'var(--bg-void)' }}>

      {/* ── Wordmark ─────────────────────────────────────────── */}
      <div style={{ textAlign: 'center', marginBottom: '48px' }}>
        {/* Scale icon + name */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '14px', marginBottom: '10px' }}>
          <div style={{
            width: 48, height: 48, borderRadius: '50%',
            border: '1px solid var(--gold-dim)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--gold)', background: 'rgba(201,168,76,0.06)',
          }}>
            <IconScale />
          </div>
          <span style={{ fontSize: 28, fontWeight: 700, letterSpacing: '0.22em', color: 'var(--gold)', textTransform: 'uppercase' }}>
            Quorum
          </span>
        </div>
        <p style={{ fontSize: 11, color: 'var(--text-4)', letterSpacing: '0.18em', textTransform: 'uppercase' }}>
          Private Decision Intelligence
        </p>
        <hr className="gold-rule" style={{ width: 180, margin: '14px auto 0' }} />
      </div>

      {/* ── Input card ───────────────────────────────────────── */}
      <div style={{
        width: '100%', maxWidth: 680,
        background: 'var(--bg-card)',
        border: '1px solid var(--border-mid)',
        borderRadius: 18,
        padding: '32px 36px',
      }}>
        <h1 style={{ fontSize: 18, fontWeight: 600, color: 'var(--text-1)', marginBottom: 6 }}>
          Describe your decision
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-3)', marginBottom: 20, lineHeight: 1.6 }}>
          Six private advisors will review it simultaneously — each from a distinct angle.
          Be specific about what you are considering and what is making it difficult.
        </p>

        <textarea
          className="decision-input"
          rows={6}
          style={{ fontSize: 14 }}
          placeholder="e.g. I am considering whether to sell my stake in the family business at 8× EBITDA. The offer expires in 3 weeks. My co-founder wants to accept but I feel we are undervalued given 40% YoY growth. I have not yet run the tax implications..."
          value={decision}
          onChange={(e) => setDecision(e.target.value)}
        />

        <div style={{ marginTop: 14 }}>
          {!showContext ? (
            <button className="btn-ghost" onClick={() => setShowContext(true)}>
              + Add context &nbsp;·&nbsp; deal notes, emails, messages
            </button>
          ) : (
            <>
              <p style={{ fontSize: 12, color: 'var(--text-4)', marginBottom: 8 }}>
                Paste relevant context — emails, WhatsApp messages, term sheets, meeting notes
              </p>
              <textarea
                rows={4}
                style={{ fontSize: 13 }}
                placeholder="Paste context here..."
                value={context}
                onChange={(e) => setContext(e.target.value)}
              />
            </>
          )}
        </div>

        {error && (
          <p style={{ marginTop: 14, fontSize: 13, color: '#e05050' }}>{error}</p>
        )}

        <div style={{ marginTop: 24 }}>
          <button
            className="btn-primary"
            style={{ width: '100%', fontSize: 15, padding: '14px', letterSpacing: '0.06em' }}
            onClick={handleSubmit}
            disabled={loading || !decision.trim()}
          >
            {loading ? 'Convening the Council…' : 'Convene the Council'}
          </button>
        </div>
      </div>

      {/* ── Persona grid ─────────────────────────────────────── */}
      <div style={{
        marginTop: 28,
        width: '100%',
        maxWidth: 680,
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: 10,
      }}>
        {PERSONAS.map((p) => (
          <div key={p.label} style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border-dim)',
            borderRadius: 12,
            padding: '14px 16px',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 12,
          }}>
            <div style={{
              flexShrink: 0,
              width: 34, height: 34,
              borderRadius: 8,
              background: `${p.color}44`,
              border: `1px solid ${p.color}88`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--gold)',
            }}>
              {p.icon}
            </div>
            <div>
              <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-1)', marginBottom: 2 }}>{p.label}</p>
              <p style={{ fontSize: 11, color: 'var(--text-4)', lineHeight: 1.4 }}>{p.hint}</p>
            </div>
          </div>
        ))}
      </div>

      <p style={{ marginTop: 32, fontSize: 11, color: 'var(--text-4)', letterSpacing: '0.04em', textAlign: 'center' }}>
        Sessions are private. Decision Records exportable as PDF.
      </p>
    </main>
  )
}

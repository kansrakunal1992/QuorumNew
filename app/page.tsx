'use client'

import { useState, useEffect } from 'react'
import { getStoredSessionIds, pushSessionId } from '@/lib/storage'
import { useRouter } from 'next/navigation'

// ── Icons ────────────────────────────────────────────────
const IconScale = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3v18M3 9l9-6 9 6M5 12l-2 5h4L5 12zM19 12l-2 5h4l-2-5zM3 21h18"/>
  </svg>
)
const IconClock = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
  </svg>
)
const IconCheck = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12"/>
  </svg>
)
const IconDot = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
    <circle cx="12" cy="12" r="6"/>
  </svg>
)

const PERSONAS_GRID = [
  { label: 'The Contrarian',      hint: 'Argues your instinct away',  col: '#7c2020' },
  { label: 'Risk Architect',       hint: 'Pre-mortems all failures',   col: '#1e3a6e' },
  { label: 'Pattern Analyst',      hint: 'Finds your past analogues',  col: '#1a4a36' },
  { label: 'Stakeholder Mirror',   hint: 'Who else is affected',       col: '#4a2070' },
  { label: 'The Elder',            hint: 'Decade-level wisdom',        col: '#5c3a10' },
  { label: 'The Competitor',       hint: 'Bets against your choice',   col: '#3a2a10' },
]

interface SessionSummary {
  id: string
  decision_text: string
  created_at: string
  outcome: { what_decided: string; council_helped: string } | null
}

// Session IDs stored via lib/storage

export default function Home() {
  const router  = useRouter()
  const [decision,     setDecision]     = useState('')
  const [context,      setContext]       = useState('')
  const [loading,      setLoading]       = useState(false)
  const [showContext,  setShowContext]   = useState(false)
  const [error,        setError]         = useState('')
  
  // ── Brief access ─────────────────────────────
  const [token, setToken] = useState('')
  const [hasAccess, setHasAccess] = useState(false)
  const [checkingAccess, setCheckingAccess] = useState(false)

  // Past sessions state
  const [sessions,     setSessions]     = useState<SessionSummary[]>([])
  const [loadingHist,  setLoadingHist]  = useState(false)
  const [activeTab,    setActiveTab]    = useState<'all'|'pending'|'decided'>('all')

  // Load history on mount
  useEffect(() => {
    const ids = getStoredSessionIds()
    if (ids.length === 0) return
    setLoadingHist(true)

    fetch('/api/history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    })
      .then(r => r.json())
      .then(data => { setSessions(data.sessions ?? []) })
      .catch(() => {})
      .finally(() => setLoadingHist(false))
  }, [])


  // ── Load token from URL or localStorage ──────
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const urlToken = params.get('token')

    if (urlToken) {
      setToken(urlToken)
      localStorage.setItem('brief_token', urlToken)
      setHasAccess(true)
      return
    }

    const saved = localStorage.getItem('brief_token')
    if (saved) {
      setToken(saved)
      setHasAccess(true)
    }
  }, [])

  const checkAccess = async () => {
    if (!token.trim()) return

    setCheckingAccess(true)
    try {
      const res = await fetch('/api/brief-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })

      const data = await res.json()

      if (data.valid) {
        localStorage.setItem('brief_token', token)
        setHasAccess(true)
      } else {
        setHasAccess(false)
        alert('Invalid access token')
      }
    } catch {
      alert('Error validating token')
    }
    setCheckingAccess(false)
  }

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
      if (!res.ok) throw new Error()
      const { id } = await res.json()
      pushSessionId(id)
      router.push(`/session/${id}`)
    } catch {
      setError('Something went wrong. Check environment variables.')
      setLoading(false)
    }
  }

  // Derived counts
  const pending = sessions.filter(s => !s.outcome)
  const decided = sessions.filter(s => s.outcome)
  const filtered = activeTab === 'all' ? sessions : activeTab === 'pending' ? pending : decided

  const helpedColor: Record<string, string> = {
    yes:       '#1a4a2e',
    partially: '#3a3a10',
    no:        '#4a1a1a',
  }
  const helpedLabel: Record<string, string> = {
    yes:       'Changed thinking',
    partially: 'New angles surfaced',
    no:        'Not helpful',
  }

  return (
    <main style={{ minHeight: '100vh', padding: '40px 20px 80px', background: 'var(--bg-void)' }}>
      <div style={{ maxWidth: 720, margin: '0 auto' }}>

        {/* ── Wordmark ──────────────────────────────────── */}
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14, marginBottom: 10 }}>
            <div style={{ width: 46, height: 46, borderRadius: '50%', border: '1px solid var(--gold-dim)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--gold)', background: 'rgba(201,168,76,0.06)' }}>
              <IconScale />
            </div>
            <span style={{ fontSize: 26, fontWeight: 700, letterSpacing: '0.22em', color: 'var(--gold)', textTransform: 'uppercase' }}>
              Quorum
            </span>
          </div>
          <p style={{ fontSize: 11, color: 'var(--text-4)', letterSpacing: '0.18em', textTransform: 'uppercase' }}>
            Private Decision Intelligence
          </p>
          <div style={{ height: 1, background: 'linear-gradient(90deg, transparent, var(--gold-dim), transparent)', margin: '14px auto 0', width: 180 }} />
        </div>

        {/* ── Input card ───────────────────────────────── */}
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-mid)', borderRadius: 18, padding: '28px 32px', marginBottom: 28 }}>
          
          {/* ── Access Gate ───────────────────────────── */}
          {!hasAccess && (
            <div style={{ marginBottom: 20 }}>
              <p style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 8 }}>
                Enter access token to enable Decision Brief
              </p>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  value={token}
                  onChange={e => setToken(e.target.value)}
                  placeholder="Access token"
                  style={{
                    flex: 1,
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: '1px solid var(--border-mid)',
                    background: 'var(--bg-inset)',
                    color: 'var(--text-1)',
                    fontSize: 13,
                  }}
                />
                <button
                  onClick={checkAccess}
                  disabled={checkingAccess}
                  className="btn-ghost"
                >
                  {checkingAccess ? 'Checking…' : 'Unlock'}
                </button>
              </div>
            </div>
          )}
          <h1 style={{ fontSize: 17, fontWeight: 600, color: 'var(--text-1)', marginBottom: 6 }}>
            Describe your decision
          </h1>
          <p style={{ fontSize: 13, color: 'var(--text-3)', marginBottom: 18, lineHeight: 1.6 }}>
            Six private advisors will review it simultaneously — each from a distinct angle.
          </p>

          <textarea
            className="decision-input"
            rows={5}
            style={{ fontSize: 14 }}
            placeholder="e.g. I am considering whether to sell my 40% stake in the family business to a PE firm at 8× EBITDA. The offer expires in 3 weeks…"
            value={decision}
            onChange={e => setDecision(e.target.value)}
          />

          <div style={{ marginTop: 12 }}>
            {!showContext ? (
              <button className="btn-ghost" onClick={() => setShowContext(true)}>
                + Add context · notes, emails, messages
              </button>
            ) : (
              <>
                <p style={{ fontSize: 12, color: 'var(--text-4)', marginBottom: 8 }}>
                  Paste relevant context — emails, WhatsApp, term sheets
                </p>
                <textarea rows={3} style={{ fontSize: 13 }} placeholder="Paste context here..." value={context} onChange={e => setContext(e.target.value)} />
              </>
            )}
          </div>

          {error && <p style={{ marginTop: 12, fontSize: 13, color: '#e05050' }}>{error}</p>}

          <button
            className="btn-primary"
            style={{ width: '100%', fontSize: 15, padding: '14px', marginTop: 20, letterSpacing: '0.06em' }}
            onClick={handleSubmit}
            disabled={loading || !decision.trim()}
          >
            {loading ? 'Convening the Council…' : 'Convene the Council'}
          </button>
        </div>

        {/* ── Persona grid ─────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 20 }}>
          {PERSONAS_GRID.map(p => (
            <div key={p.label} style={{ background: 'var(--bg-card)', border: '1px solid var(--border-dim)', borderRadius: 10, padding: '12px 14px', display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <div style={{ flexShrink: 0, width: 28, height: 28, borderRadius: 7, background: `${p.col}44`, border: `1px solid ${p.col}88`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--gold)' }} />
              </div>
              <div>
                <p style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-1)', marginBottom: 2 }}>{p.label}</p>
                <p style={{ fontSize: 10.5, color: 'var(--text-4)', lineHeight: 1.4 }}>{p.hint}</p>
              </div>
            </div>
          ))}
        </div>

        {/* ── How to get the most out of Quorum ────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 36 }}>
          {/* Pushback tip */}
          <div style={{ background: 'rgba(201,168,76,0.06)', border: '1px solid var(--gold-dim)', borderRadius: 12, padding: '14px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <div style={{ width: 24, height: 24, borderRadius: 6, background: 'rgba(201,168,76,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/>
                </svg>
              </div>
              <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--gold)', margin: 0 }}>
                Challenge the advisors
              </p>
            </div>
            <p style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.6, margin: 0 }}>
              After each advisor responds, you&apos;ll see a <span style={{ color: 'var(--gold)', fontWeight: 600 }}>&quot;Challenge this · add context&quot;</span> button. Use it. Disagree with their analysis, add information they missed, or ask a follow-up. The Council re-synthesises after every pushback.
            </p>
          </div>

          {/* Outcome tip */}
          <div style={{ background: 'rgba(26,58,34,0.3)', border: '1px solid #2a4a2e', borderRadius: 12, padding: '14px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <div style={{ width: 24, height: 24, borderRadius: 6, background: 'rgba(74,222,128,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              </div>
              <p style={{ fontSize: 12, fontWeight: 700, color: '#4ade80', margin: 0 }}>
                Log what you decided
              </p>
            </div>
            <p style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.6, margin: 0 }}>
              Decisions often take time. Once you decide, return to this page — your past sessions appear below. Open any session and log your outcome. Over time this builds a private record of how you actually decide.
            </p>
          </div>
        </div>

        {/* ── Decision history ─────────────────────────── */}
        {(sessions.length > 0 || loadingHist) && (
          <div>
            {/* Section header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-3)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                Your Decisions
              </p>
              <div style={{ display: 'flex', gap: 6 }}>
                {(['all', 'pending', 'decided'] as const).map(tab => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    style={{
                      fontSize: 11,
                      padding: '4px 12px',
                      borderRadius: 20,
                      border: '1px solid',
                      borderColor: activeTab === tab ? 'var(--gold-dim)' : 'var(--border-dim)',
                      background: activeTab === tab ? 'rgba(201,168,76,0.1)' : 'transparent',
                      color: activeTab === tab ? 'var(--gold)' : 'var(--text-4)',
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                    }}
                  >
                    {tab === 'all'     ? `All ${sessions.length}`       : ''}
                    {tab === 'pending' ? `Outcome pending ${pending.length}` : ''}
                    {tab === 'decided' ? `Decided ${decided.length}`   : ''}
                  </button>
                ))}
              </div>
            </div>

            {/* Device note */}
            <p style={{ fontSize: 11, color: 'var(--text-4)', marginBottom: 16, lineHeight: 1.5 }}>
              History saved on this device. Bookmark session URLs to access from other devices.
            </p>

            {loadingHist && (
              <div style={{ textAlign: 'center', padding: 24 }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--border-mid)', animation: 'blink 1.2s infinite', display: 'inline-block' }} />
              </div>
            )}

            {/* Session list */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {filtered.map(s => {
                const date = new Date(s.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
                const snippet = s.decision_text.length > 120
                  ? s.decision_text.slice(0, 120) + '…'
                  : s.decision_text

                return (
                  <div
                    key={s.id}
                    onClick={() => router.push(`/record/${s.id}`)}
                    style={{
                      background: 'var(--bg-card)',
                      border: '1px solid var(--border-dim)',
                      borderRadius: 12,
                      padding: '14px 18px',
                      cursor: 'pointer',
                      transition: 'border-color 0.2s',
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 14,
                    }}
                    onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--border-hi)')}
                    onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border-dim)')}
                  >
                    {/* Status indicator */}
                    <div style={{ flexShrink: 0, marginTop: 3 }}>
                      {s.outcome ? (
                        <div style={{ width: 20, height: 20, borderRadius: '50%', background: helpedColor[s.outcome.council_helped] || '#1a3a2a', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#4ade80' }}>
                          <IconCheck />
                        </div>
                      ) : (
                        <div style={{ width: 20, height: 20, borderRadius: '50%', background: 'var(--bg-inset)', border: '1px solid var(--border-mid)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-4)' }}>
                          <IconDot />
                        </div>
                      )}
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 13.5, color: 'var(--text-1)', lineHeight: 1.5, marginBottom: 6 }}>
                        {snippet}
                      </p>

                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 11, color: 'var(--text-4)', display: 'flex', alignItems: 'center', gap: 4 }}>
                          <IconClock /> {date}
                        </span>
                        {s.outcome ? (
                          <span style={{ fontSize: 11, padding: '2px 10px', borderRadius: 20, background: helpedColor[s.outcome.council_helped] || '#1a3a2a', color: 'var(--text-2)' }}>
                            {helpedLabel[s.outcome.council_helped] || 'Decided'}
                          </span>
                        ) : (
                          <span style={{ fontSize: 11, color: '#c9a84c', padding: '2px 10px', borderRadius: 20, background: 'rgba(201,168,76,0.08)', border: '1px solid var(--gold-dim)' }}>
                            Outcome pending
                          </span>
                        )}
                        {s.outcome?.what_decided && (
                          <span style={{ fontSize: 11, color: 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 220 }}>
                            {s.outcome.what_decided}
                          </span>
                        )}
                      </div>
                    </div>

                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, color: 'var(--text-4)', marginTop: 4 }}>
                      <polyline points="9 18 15 12 9 6"/>
                    </svg>
                  </div>
                )
              })}

              {filtered.length === 0 && !loadingHist && (
                <p style={{ fontSize: 13, color: 'var(--text-4)', textAlign: 'center', padding: '20px 0', fontStyle: 'italic' }}>
                  {activeTab === 'pending' ? 'No pending outcomes — all decisions logged.' : 'No decisions in this category yet.'}
                </p>
              )}
            </div>
          </div>
        )}

        <p style={{ marginTop: 32, fontSize: 11, color: 'var(--text-4)', letterSpacing: '0.04em', textAlign: 'center' }}>
          Sessions are private by URL. No account linked.
        </p>
      </div>
    </main>
  )
}

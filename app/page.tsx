'use client'

import { useState, useEffect, useRef } from 'react'
import { getStoredSessionIds, pushSessionId, removeSessionId, getOrCreateDeviceId, storeUserEmail } from '@/lib/storage'
import { useRouter } from 'next/navigation'
import MemoryEngineStatus from '@/components/MemoryEngineStatus'
import AuthPanel from '@/components/AuthPanel'
import BehaviorAlerts from '@/components/BehaviorAlerts'
import VoiceInput from '@/components/VoiceInput'

// ── Icons ────────────────────────────────────────────────
const IconScale = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
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
const IconTrash = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6"/>
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
    <path d="M10 11v6M14 11v6"/>
    <path d="M9 6V4h6v2"/>
  </svg>
)
const IconChevron = ({ open }: { open: boolean }) => (
  <svg
    width="11" height="11" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
    style={{ transition: 'transform 0.25s ease', transform: open ? 'rotate(90deg)' : 'rotate(0deg)', flexShrink: 0 }}
  >
    <polyline points="9 18 15 12 9 6"/>
  </svg>
)

const PERSONAS_GRID = [
  { label: 'The Contrarian',    hint: 'Argues your instinct away', col: '#c04040' },
  { label: 'Risk Architect',    hint: 'Pre-mortems all failures',  col: '#3a78c4' },
  { label: 'Pattern Analyst',   hint: 'Finds your past analogues', col: '#38a468' },
  { label: 'Stakeholder Mirror',hint: 'Who else is affected',      col: '#8840c4' },
  { label: 'The Elder',         hint: 'Decade-level wisdom',       col: '#c08030' },
  { label: 'The Competitor',    hint: 'Bets against your choice',  col: '#788040' },
]

interface SessionSummary {
  id: string
  decision_text: string
  created_at: string
  outcome: { what_decided: string; council_helped: string } | null
}

export default function Home() {
  const router      = useRouter()
  const historyRef  = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // ── Core form state (unchanged) ──────────────────────────
  const [decision,    setDecision]    = useState('')
  const [context,     setContext]     = useState('')
  const [formKey,     setFormKey]     = useState(0)
  const [loading,     setLoading]     = useState(false)
  const [showContext, setShowContext] = useState(false)
  const [error,       setError]       = useState('')
  const [registerMode,          setRegisterMode]          = useState<'analytical'|'clarification'>('analytical')
  const [preDecisionConfidence, setPreDecisionConfidence] = useState<number>(5)
  // Sprint 6b: read ?em= param written by auth callback so cross-browser
  // magic link clicks still land with correct identity (Custom Tab → Chrome main)
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search)
      const em = params.get('em')
      if (em && em.includes('@')) {
        storeUserEmail(em)
        setUserEmail(em)
        // Clean the URL so it doesn't persist across refreshes
        window.history.replaceState({}, '', '/')
      }
    } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [userEmail,   setUserEmail]   = useState<string | null>(() => {
    if (typeof window === 'undefined') return null
    try { return localStorage.getItem('quorum_user_email') } catch { return null }
  })

  // ── History + auth state (unchanged) ─────────────────────
  const [sessions,    setSessions]    = useState<SessionSummary[]>([])
  const [loadingHist, setLoadingHist] = useState(false)
  const [activeTab,   setActiveTab]   = useState<'all'|'pending'|'decided'>('all')
  const [authToken,   setAuthToken]   = useState<string | null>(null)
  const [inputGlowing,setInputGlowing]= useState(false)

  // ── UI state (new) ────────────────────────────────────────
  // Tips open: true on first visit, persisted thereafter
  const [tipsOpen, setTipsOpen] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    try {
      const v = localStorage.getItem('quorum_tips_open')
      return v === null ? false : v === 'true'
    } catch { return false }
  })
  const [navScrolled,    setNavScrolled]    = useState(false)
  const [historyShowAll, setHistoryShowAll] = useState(false)
  const HISTORY_PREVIEW = 5

  // ── Effects (all original effects preserved) ─────────────
  useEffect(() => {
    setDecision('')
    setContext('')
    setShowContext(false)
    setPreDecisionConfidence(5)
    setFormKey(k => k + 1)
    const t1 = setTimeout(() => setInputGlowing(true),  600)
    const t2 = setTimeout(() => setInputGlowing(false), 2400)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [])

  useEffect(() => {
    const onScroll = () => setNavScrolled(window.scrollY > 24)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    const ids = getStoredSessionIds()
    setLoadingHist(true)
    const loadHistory = async () => {
      try {
        const { createClient } = await import('@/lib/supabase')
        const supabase = createClient()
        const { data: { session: authSession } } = await supabase.auth.getSession()
        const token = authSession?.access_token ?? null
        setAuthToken(token)
        if (authSession?.user?.email) {
          setUserEmail(authSession.user.email)
          try { localStorage.setItem('user_email', authSession.user.email) } catch { /* ignore */ }
        }
        const headers: Record<string, string> = { 'Content-Type': 'application/json' }
        if (token) headers['Authorization'] = `Bearer ${token}`
        const res  = await fetch('/api/history', { method: 'POST', headers, body: JSON.stringify({ ids }) })
        const data = await res.json()
        setSessions(data.sessions ?? [])
      } catch { /* silent fail */ }
      finally  { setLoadingHist(false) }
    }
    loadHistory()
  }, [])

  // ── Handlers (all original handlers preserved) ────────────
  const handleSubmit = async () => {
    if (!decision.trim() || decision.trim().length < 20) {
      setError('Please describe your decision in at least a sentence.')
      return
    }
    setError('')
    setLoading(true)
    try {
      let resolvedUserId: string | null = null
      try {
        const { createClient: getClient } = await import('@/lib/supabase')
        const sb = getClient()
        const { data: { session: authSession } } = await sb.auth.getSession()
        resolvedUserId = authSession?.user?.id ?? null
      } catch { /* non-blocking */ }
      const res = await fetch('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decision_text:           decision.trim(),
          context_text:            context.trim() || null,
          register_mode:           registerMode,
          pre_decision_confidence: preDecisionConfidence,
          user_email:              userEmail ?? null,
          device_id:               getOrCreateDeviceId(),
          user_id:                 resolvedUserId,
        }),
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

  const handleDeleteSession = async (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation()
    if (!window.confirm('Delete this decision? This cannot be undone.')) return
    setSessions(prev => prev.filter(s => s.id !== sessionId))
    removeSessionId(sessionId)
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (authToken) headers['Authorization'] = `Bearer ${authToken}`
      await fetch('/api/record', { method: 'DELETE', headers, body: JSON.stringify({ sessionId }) })
    } catch { /* silent */ }
  }

  const handleTipsToggle = () => {
    const next = !tipsOpen
    setTipsOpen(next)
    try { localStorage.setItem('quorum_tips_open', String(next)) } catch {}
  }

  // ── Derived values ────────────────────────────────────────
  const pending      = sessions.filter(s => !s.outcome)
  const decided      = sessions.filter(s =>  s.outcome)
  const filtered     = activeTab === 'all' ? sessions : activeTab === 'pending' ? pending : decided
  const showControls = decision.trim().length > 0   // state-gate for register + slider

  const helpedColor: Record<string, string> = {
    yes:       'var(--outcome-yes)',
    partially: 'var(--outcome-partial)',
    no:        'var(--outcome-no)',
  }
  const helpedLabel: Record<string, string> = {
    yes:       'Changed thinking',
    partially: 'New angles surfaced',
    no:        'Not helpful',
  }

  return (
    <>
      {/* ── Fixed Navbar ─────────────────────────────────── */}
      <nav style={{
        position: 'fixed', top: 0, left: 0, right: 0,
        height: 56, zIndex: 100,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 20px',
        background: navScrolled ? 'var(--bg-void)' : 'transparent',
        borderBottom: `1px solid ${navScrolled ? 'var(--border-dim)' : 'transparent'}`,
        backdropFilter: navScrolled ? 'blur(18px)' : 'none',
        WebkitBackdropFilter: navScrolled ? 'blur(18px)' : 'none',
        transition: 'background 0.3s ease, border-color 0.3s ease',
      }}>
        {/* Wordmark */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--gold)', flexShrink: 0 }}>
          <div style={{
            width: 32, height: 32, borderRadius: '50%',
            border: '1px solid var(--gold-dim)',
            background: 'rgba(201,168,76,0.06)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <IconScale />
          </div>
          <span style={{
            fontSize: 15, fontWeight: 400,
            letterSpacing: '0.22em', textTransform: 'uppercase',
            fontFamily: 'var(--font-display)', color: 'var(--gold)',
          }}>
            Quorum
          </span>
        </div>

        {/* Tagline — hidden on mobile */}
        <span className="nav-tagline">
          Judgment Operating System
        </span>
      </nav>

      {/* ── Main content ─────────────────────────────────── */}
      <main style={{
        minHeight: '100vh',
        paddingTop: 72,
        paddingBottom: 80,
        paddingLeft: 16,
        paddingRight: 16,
        background: 'var(--bg-void)',
      }}>
        <div style={{ maxWidth: 680, margin: '0 auto' }}>

          {/* ── Judgment Profile Card ───────────────────── */}
          <div style={{
            background:    'var(--bg-card)',
            border:        '1px solid var(--border-mid)',
            borderRadius:  14,
            padding:       '16px 20px',
            marginBottom:  12,
            display:       'flex',
            alignItems:    'center',
            justifyContent:'space-between',
            gap:           12,
          }}>
            <div>
              <p style={{
                fontSize:      10.5,
                fontWeight:    700,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color:         'var(--text-4)',
                fontFamily:    'var(--font-mono)',
                margin:        '0 0 3px',
              }}>
                Your judgment record
              </p>
              <p style={{ fontSize: 20, fontWeight: 400, color: 'var(--text-1)', margin: 0, fontFamily: 'var(--font-display)', letterSpacing: '-0.01em' }}>
                {sessions.length === 0
                  ? 'No decisions yet'
                  : `${sessions.length} decision${sessions.length !== 1 ? 's' : ''}`}
              </p>
            </div>
            <button
              onClick={() => textareaRef.current?.focus()}
              style={{
                display:       'flex',
                alignItems:    'center',
                gap:           7,
                padding:       '9px 18px',
                borderRadius:  8,
                border:        '1px solid var(--gold-dim)',
                background:    'rgba(201,168,76,0.08)',
                color:         'var(--gold)',
                fontSize:      12.5,
                fontWeight:    600,
                cursor:        'pointer',
                fontFamily:    'inherit',
                whiteSpace:    'nowrap',
                transition:    'all 0.15s',
                flexShrink:    0,
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(201,168,76,0.14)'; e.currentTarget.style.borderColor = 'var(--gold)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(201,168,76,0.08)'; e.currentTarget.style.borderColor = 'var(--gold-dim)' }}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
              Add decision to your record
            </button>
          </div>

          {/* ── Input Card ──────────────────────────────── */}
          <div style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border-mid)',
            borderRadius: 18,
            padding: '28px 24px 24px',
            marginBottom: 14,
            boxShadow: 'var(--shadow-card)',
          }}>
            <h1 style={{
              fontSize: 21,
              fontWeight: 400,
              color: 'var(--text-1)',
              marginBottom: 5,
              fontFamily: 'var(--font-display)',
              lineHeight: 1.2,
              letterSpacing: '-0.01em',
            }}>
              What decision are you bringing to your record?
            </h1>
            <p style={{ fontSize: 12, color: 'var(--text-4)', marginBottom: 16, lineHeight: 1.6, fontStyle: 'italic' }}>
              Add it to your judgment record. The Council runs on every decision you bring.
            </p>

            {/* Main decision textarea */}
            <textarea
              ref={textareaRef}
              key={formKey}
              className="decision-input"
              rows={5}
              style={{
                fontSize: 15,
                transition: 'box-shadow 0.5s ease, border-color 0.5s ease',
                ...(inputGlowing ? {
                  boxShadow: '0 0 0 2px rgba(201,168,76,0.18), 0 0 18px 4px rgba(201,168,76,0.13)',
                  borderColor: 'rgba(201,168,76,0.55)',
                } : {}),
              }}
              autoComplete="off"
              placeholder="e.g. I am considering whether to sell my 40% stake in the family business to a PE firm at 8× EBITDA. The offer expires in 3 weeks…"
              value={decision}
              onChange={e => setDecision(e.target.value)}
            />

            {/* VoiceInput */}
            <div style={{ marginTop: 10 }}>
              <VoiceInput onTranscript={(text) => setDecision(text)} />
            </div>

            {/* Context toggle */}
            <div style={{ marginTop: 12 }}>
              {!showContext ? (
                <button className="btn-ghost" onClick={() => setShowContext(true)}>
                  + Add context · notes, emails, messages
                </button>
              ) : (
                <>
                  <p style={{ fontSize: 11, color: 'var(--text-4)', marginBottom: 8 }}>
                    Paste relevant context — emails, WhatsApp, term sheets
                  </p>
                  <textarea
                    rows={3}
                    style={{ fontSize: 13 }}
                    placeholder="Paste context here..."
                    value={context}
                    onChange={e => setContext(e.target.value)}
                  />
                </>
              )}
            </div>

            {/* BehaviorAlerts — unchanged */}
            <BehaviorAlerts decision={decision} authToken={authToken} />

            {/* ── State-gated controls (register + slider) ─
                Revealed only after user starts typing.
                Uses CSS height/opacity transition — no logic change. */}
            <div style={{
              overflow: 'hidden',
              maxHeight: showControls ? 420 : 0,
              opacity: showControls ? 1 : 0,
              marginTop: showControls ? 18 : 0,
              transition: 'max-height 0.45s cubic-bezier(0.4,0,0.2,1), opacity 0.35s ease, margin-top 0.35s ease',
            }}>
              {/* Register mode selector */}
              <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-3)', marginBottom: 10, letterSpacing: '0.04em' }}>
                What are you looking for from the Council?
              </p>
              <div className="home-two-col" style={{ gap: 8 }}>
                <button
                  type="button"
                  onClick={() => setRegisterMode('analytical')}
                  style={{
                    padding: '12px 14px', borderRadius: 10,
                    border: `1px solid ${registerMode === 'analytical' ? 'var(--gold)' : 'var(--border-dim)'}`,
                    background: registerMode === 'analytical' ? 'rgba(201,168,76,0.1)' : 'transparent',
                    textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s',
                  }}
                >
                  <p style={{ fontSize: 13, fontWeight: 600, color: registerMode === 'analytical' ? 'var(--gold)' : 'var(--text-2)', marginBottom: 3 }}>
                    ⚔ Challenge my thinking
                  </p>
                  <p style={{ fontSize: 11, color: 'var(--text-4)', lineHeight: 1.4 }}>
                    Stress-test the decision. Find what I am missing.
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => setRegisterMode('clarification')}
                  style={{
                    padding: '12px 14px', borderRadius: 10,
                    border: `1px solid ${registerMode === 'clarification' ? 'var(--green-border)' : 'var(--border-dim)'}`,
                    background: registerMode === 'clarification' ? 'var(--green-soft)' : 'transparent',
                    textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s',
                  }}
                >
                  <p style={{ fontSize: 13, fontWeight: 600, color: registerMode === 'clarification' ? 'var(--green-text)' : 'var(--text-2)', marginBottom: 3 }}>
                    🪞 Help me understand what I want
                  </p>
                  <p style={{ fontSize: 11, color: 'var(--text-4)', lineHeight: 1.4 }}>
                    Values, identity, what matters most here.
                  </p>
                </button>
              </div>

              {/* Pre-decision confidence slider */}
              <div style={{ marginTop: 18, marginBottom: 4 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                  <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-3)', letterSpacing: '0.04em', margin: 0 }}>
                    Pre-session clarity
                  </p>
                  <span style={{
                    fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-mono)',
                    color: preDecisionConfidence <= 3 ? '#c04040'
                         : preDecisionConfidence <= 6 ? 'var(--gold)'
                         : 'var(--green-text)',
                    minWidth: 28, textAlign: 'right',
                  }}>
                    {preDecisionConfidence}
                    <span style={{ fontSize: 10, fontWeight: 400, color: 'var(--text-4)' }}>/10</span>
                  </span>
                </div>
                <p style={{ fontSize: 11, color: 'var(--text-4)', margin: '0 0 10px', lineHeight: 1.5 }}>
                  How clearly do you understand this decision right now? The Council will test this and we track how your read compares to hindsight over time.
                </p>
                <input
                  type="range" min={1} max={10} step={1}
                  value={preDecisionConfidence}
                  onChange={e => setPreDecisionConfidence(Number(e.target.value))}
                  style={{
                    width: '100%',
                    accentColor: preDecisionConfidence <= 3 ? '#c04040'
                               : preDecisionConfidence <= 6 ? 'var(--gold)'
                               : 'var(--green-text)',
                    cursor: 'pointer', height: 4,
                  }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 5 }}>
                  <span style={{ fontSize: 10, color: 'var(--text-4)' }}>Foggy</span>
                  <span style={{ fontSize: 10, color: 'var(--text-4)' }}>Fully clear</span>
                </div>
              </div>
            </div>

            {error && <p style={{ marginTop: 12, fontSize: 13, color: 'var(--error)' }}>{error}</p>}

            <button
              className="btn-primary"
              style={{ width: '100%', fontSize: 15, padding: '14px', marginTop: 20, letterSpacing: '0.06em' }}
              onClick={handleSubmit}
              disabled={loading || !decision.trim()}
            >
              {loading ? 'Convening the Council…' : 'Convene the Council'}
            </button>
          </div>

          {/* ── Advisor caption + Persona pill strip ────── */}
          <p style={{ fontSize: 11, color: 'var(--text-4)', marginBottom: 8, padding: '0 2px', fontStyle: 'italic' }}>
            Six private advisors · each from a distinct angle
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginBottom: 14, padding: '0 2px' }}>
            {PERSONAS_GRID.map(p => (
              <div
                key={p.label}
                title={p.hint}
                style={{
                  display: 'flex', alignItems: 'center', gap: 7,
                  padding: '6px 12px', borderRadius: 999,
                  border: '1px solid var(--border-dim)',
                  background: 'var(--bg-card)',
                  cursor: 'default',
                  transition: 'border-color 0.2s',
                }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--border-mid)')}
                onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border-dim)')}
              >
                <div style={{
                  width: 7, height: 7, borderRadius: '50%',
                  background: p.col, opacity: 0.85, flexShrink: 0,
                }} />
                <span style={{
                  fontSize: 11, color: 'var(--text-3)',
                  fontFamily: 'var(--font-mono)', letterSpacing: '0.05em',
                  whiteSpace: 'nowrap',
                }}>
                  {p.label}
                </span>
              </div>
            ))}
          </div>

          {/* ── Tips — collapsible ───────────────────────── */}
          <div style={{ marginBottom: 32 }}>
            <button
              onClick={handleTipsToggle}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                background: 'transparent', border: 'none',
                color: 'var(--text-4)', fontSize: 11,
                fontFamily: 'var(--font-mono)', letterSpacing: '0.1em',
                textTransform: 'uppercase', cursor: 'pointer',
                padding: '6px 2px', transition: 'color 0.2s',
              }}
              onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-2)')}
              onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-4)')}
            >
              <IconChevron open={tipsOpen} />
              How to get the most out of Quorum
            </button>

            <div style={{
              overflow: 'hidden',
              maxHeight: tipsOpen ? 500 : 0,
              opacity: tipsOpen ? 1 : 0,
              transition: 'max-height 0.4s cubic-bezier(0.4,0,0.2,1), opacity 0.3s ease',
            }}>
              <div className="home-two-col" style={{ gap: 10, marginTop: 12 }}>
                {/* Pushback tip */}
                <div style={{ background: 'rgba(201,168,76,0.06)', border: '1px solid var(--gold-dim)', borderRadius: 12, padding: '14px 16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <div style={{ width: 24, height: 24, borderRadius: 6, background: 'rgba(201,168,76,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/>
                      </svg>
                    </div>
                    <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--gold)', margin: 0 }}>Challenge the advisors</p>
                  </div>
                  <p style={{ fontSize: 13, color: 'var(--text-3)', lineHeight: 1.6, margin: 0 }}>
                    After each advisor responds, you&apos;ll see a <span style={{ color: 'var(--gold)', fontWeight: 600 }}>&quot;Challenge this · add context&quot;</span> button. Disagree, add information they missed, or ask a follow-up.
                  </p>
                </div>

                {/* Outcome tip */}
                <div style={{ background: 'var(--green-soft)', border: '1px solid var(--green-border)', borderRadius: 12, padding: '14px 16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <div style={{ width: 24, height: 24, borderRadius: 6, background: 'var(--green-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--green-text)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12"/>
                      </svg>
                    </div>
                    <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--green-text)', margin: 0 }}>Log what you decided</p>
                  </div>
                  <p style={{ fontSize: 13, color: 'var(--text-3)', lineHeight: 1.6, margin: 0 }}>
                    Once you decide, return and open any past session to log the outcome. Over time this builds a private record of how you actually decide.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* ── Memory Engine Status ──────────────────────── */}
          {sessions.length > 0 && (
            <MemoryEngineStatus
              sessionCount={sessions.length}
              pendingOutcomes={pending.length}
              decidedCount={decided.length}
              hasIdentity={!!userEmail}
              onScrollToHistory={() => {
                historyRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                setActiveTab('pending')
              }}
            />
          )}

          {/* ── Decision history ─────────────────────────── */}
          {(sessions.length > 0 || loadingHist) && (
            <div
              ref={historyRef}
              style={{
                opacity: loadingHist ? 0 : 1,
                transition: 'opacity 0.6s ease',
              }}
            >
              {/* Section header + tab filters */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
                <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-3)', letterSpacing: '0.1em', textTransform: 'uppercase', fontFamily: 'var(--font-mono)', margin: 0 }}>
                  Your judgment record
                </p>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {(['all', 'pending', 'decided'] as const).map(tab => (
                    <button
                      key={tab}
                      onClick={() => { setActiveTab(tab); setHistoryShowAll(false) }}
                      style={{
                        fontSize: 11, padding: '4px 12px', borderRadius: 20,
                        border: '1px solid',
                        borderColor: activeTab === tab ? 'var(--gold-dim)' : 'var(--border-dim)',
                        background: activeTab === tab ? 'rgba(201,168,76,0.1)' : 'transparent',
                        color: activeTab === tab ? 'var(--gold)' : 'var(--text-4)',
                        cursor: 'pointer', fontFamily: 'inherit',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {tab === 'all'     ? `All ${sessions.length}`    : ''}
                      {tab === 'pending' ? `Open ${pending.length}`    : ''}
                      {tab === 'decided' ? `Logged ${decided.length}`  : ''}
                    </button>
                  ))}
                </div>
              </div>

              {/* Auth nudge / linked email badge */}
              {!userEmail && (
                <div style={{ marginBottom: 16 }}>
                  <AuthPanel onAuthenticated={email => setUserEmail(email)} userEmail={userEmail} />
                </div>
              )}
              {userEmail && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '8px 14px', marginBottom: 14,
                  background: 'var(--green-soft)',
                  border: '1px solid var(--green-border)',
                  borderRadius: 10,
                }}>
                  <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--green-text)', flexShrink: 0 }} />
                  <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
                    Sessions linked to <span style={{ color: 'var(--text-2)', fontWeight: 600 }}>{userEmail}</span>
                    {' · '}cross-device history active
                  </span>
                </div>
              )}

              {loadingHist && (
                <div style={{ textAlign: 'center', padding: 24 }}>
                  <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--border-mid)', animation: 'blink 1.2s infinite', display: 'inline-block' }} />
                </div>
              )}

              {/* Session list */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {(historyShowAll ? filtered : filtered.slice(0, HISTORY_PREVIEW)).map(s => {
                  const date    = new Date(s.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
                  const snippet = s.decision_text.length > 120 ? s.decision_text.slice(0, 120) + '…' : s.decision_text
                  return (
                    <div
                      key={s.id}
                      onClick={() => router.push(`/record/${s.id}`)}
                      style={{
                        background: 'var(--bg-card)', border: '1px solid var(--border-dim)',
                        borderRadius: 12, padding: '14px 16px',
                        cursor: 'pointer', transition: 'border-color 0.2s',
                        display: 'flex', alignItems: 'flex-start', gap: 12,
                      }}
                      onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--border-hi)')}
                      onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border-dim)')}
                    >
                      {/* Status indicator */}
                      <div style={{ flexShrink: 0, marginTop: 3 }}>
                        {s.outcome ? (
                          <div style={{ width: 20, height: 20, borderRadius: '50%', background: helpedColor[s.outcome.council_helped] || 'var(--outcome-yes)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--green-text)' }}>
                            <IconCheck />
                          </div>
                        ) : (
                          <div style={{ width: 20, height: 20, borderRadius: '50%', background: 'var(--bg-inset)', border: '1px solid var(--border-mid)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-4)' }}>
                            <IconDot />
                          </div>
                        )}
                      </div>

                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontSize: 13, color: 'var(--text-1)', lineHeight: 1.5, marginBottom: 6 }}>{snippet}</p>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 11, color: 'var(--text-4)', display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                            <IconClock /> {date}
                          </span>
                          {s.outcome ? (
                            <span style={{ fontSize: 11, padding: '2px 10px', borderRadius: 20, background: helpedColor[s.outcome.council_helped] || 'var(--outcome-yes)', color: 'var(--text-2)', flexShrink: 0 }}>
                              {helpedLabel[s.outcome.council_helped] || 'Decided'}
                            </span>
                          ) : (
                            <span style={{ fontSize: 11, color: '#c9a84c', padding: '2px 10px', borderRadius: 20, background: 'rgba(201,168,76,0.08)', border: '1px solid var(--gold-dim)', flexShrink: 0 }}>
                              Outcome pending
                            </span>
                          )}
                          {s.outcome?.what_decided && (
                            <span style={{ fontSize: 11, color: 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>
                              {s.outcome.what_decided}
                            </span>
                          )}
                        </div>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, marginTop: 2 }}>
                        <button
                          onClick={e => handleDeleteSession(e, s.id)}
                          title="Delete this decision"
                          style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            width: 30, height: 30, borderRadius: 6,
                            border: '1px solid transparent', background: 'transparent',
                            color: 'var(--text-4)', cursor: 'pointer', transition: 'all 0.15s',
                            flexShrink: 0, padding: 0,
                          }}
                          onMouseEnter={e => {
                            e.currentTarget.style.color = '#c04040'
                            e.currentTarget.style.borderColor = 'rgba(192,64,64,0.3)'
                            e.currentTarget.style.background = 'rgba(192,64,64,0.07)'
                          }}
                          onMouseLeave={e => {
                            e.currentTarget.style.color = 'var(--text-4)'
                            e.currentTarget.style.borderColor = 'transparent'
                            e.currentTarget.style.background = 'transparent'
                          }}
                        >
                          <IconTrash />
                        </button>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-4)' }}>
                          <polyline points="9 18 15 12 9 6"/>
                        </svg>
                      </div>
                    </div>
                  )
                })}

                {filtered.length === 0 && !loadingHist && (
                  <p style={{ fontSize: 13, color: 'var(--text-4)', textAlign: 'center', padding: '20px 0', fontStyle: 'italic' }}>
                    {activeTab === 'pending' ? 'No open outcomes — all decisions logged.' : 'No decisions in this category yet.'}
                  </p>
                )}
              </div>

              {/* Show More */}
              {filtered.length > HISTORY_PREVIEW && !historyShowAll && (
                <button
                  onClick={() => setHistoryShowAll(true)}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    width: '100%', marginTop: 10,
                    background: 'transparent', border: '1px solid var(--border-dim)',
                    borderRadius: 10, padding: '10px 0',
                    fontSize: 12, color: 'var(--text-4)', cursor: 'pointer',
                    fontFamily: 'inherit', transition: 'border-color 0.2s, color 0.2s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--border-mid)'; e.currentTarget.style.color = 'var(--text-3)' }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-dim)'; e.currentTarget.style.color = 'var(--text-4)' }}
                >
                  Show {filtered.length - HISTORY_PREVIEW} more decisions
                </button>
              )}
            </div>
          )}

          <p style={{ marginTop: 32, fontSize: 11, color: 'var(--text-4)', letterSpacing: '0.04em', textAlign: 'center' }}>
            {userEmail
              ? `Sessions linked to ${userEmail} · private by URL`
              : 'Sessions are private by URL. No account linked.'
            }
          </p>
        </div>
      </main>
    </>
  )
}

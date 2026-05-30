'use client'

import { useState, useEffect, useRef } from 'react'
import { getStoredSessionIds, pushSessionId, removeSessionId, getOrCreateDeviceId, storeUserEmail } from '@/lib/storage'
import { useRouter } from 'next/navigation'
import MemoryEngineStatus from '@/components/MemoryEngineStatus'
import AuthPanel from '@/components/AuthPanel'
import BehaviorAlerts from '@/components/BehaviorAlerts'
import dynamic from 'next/dynamic'
const VoiceInput = dynamic(() => import('@/components/VoiceInput'), { ssr: false })
import PatternSurfaceCard from '@/components/PatternSurfaceCard'
import RecurringConditionCard from '@/components/RecurringConditionCard'

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

  // ── Form state ────────────────────────────────────────
  const [decision,    setDecision]    = useState('')
  const [context,     setContext]     = useState('')
  const [formKey,     setFormKey]     = useState(0)
  const [loading,     setLoading]     = useState(false)
  const [showContext, setShowContext] = useState(false)
  const [error,       setError]       = useState('')
  const [registerMode,          setRegisterMode]          = useState<'analytical'|'clarification'>('analytical')
  const [preDecisionConfidence, setPreDecisionConfidence] = useState<number>(5)

  // Sprint 6b: read ?em= param written by auth callback
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search)
      const em = params.get('em')
      if (em && em.includes('@')) {
        storeUserEmail(em)
        setUserEmail(em)
        window.history.replaceState({}, '', '/')
      }
    } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [userEmail, setUserEmail] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null
    try { return localStorage.getItem('quorum_user_email') } catch { return null }
  })

  // ── History + auth state ──────────────────────────────
  const [sessions,       setSessions]       = useState<SessionSummary[]>([])
  const [loadingHist,    setLoadingHist]    = useState(false)
  const [activeTab,      setActiveTab]      = useState<'all'|'pending'|'decided'>('all')
  const [authToken,      setAuthToken]      = useState<string | null>(null)
  const [mirrorUnlocked, setMirrorUnlocked] = useState(false)
  const [patternDimensions, setPatternDimensions] = useState<Array<{dim:string;label:string;avg_score:number;high_count:number}> >([])

  // ── UI state ──────────────────────────────────────────
  const [inputRevealed,  setInputRevealed]  = useState(false)
  const [cardHovered,    setCardHovered]    = useState(false)
  const [onboardingPanel, setOnboardingPanel] = useState(0)   // 0 | 1 | 2; panel 2 = QUORUM face
  const [isOnboarding,    setIsOnboarding]    = useState(false)
  const [tipsOpen,       setTipsOpen]       = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    try {
      const v = localStorage.getItem('quorum_tips_open')
      return v === null ? false : v === 'true'
    } catch { return false }
  })
  const [navScrolled,    setNavScrolled]    = useState(false)
  const [historyShowAll, setHistoryShowAll] = useState(false)
  const HISTORY_PREVIEW = 5

  // ── Effects ───────────────────────────────────────────
  useEffect(() => {
    setDecision('')
    setContext('')
    setShowContext(false)
    setPreDecisionConfidence(5)
    setFormKey(k => k + 1)
    // Onboarding: show panels only for genuinely new users
    try {
      const alreadyOnboarded = localStorage.getItem('quorum_onboarded') === 'true'
      const hasDecisions     = getStoredSessionIds().length > 0
      if (!alreadyOnboarded && !hasDecisions) setIsOnboarding(true)
    } catch {}
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
        if (token) {
          fetch('/api/mirror/status', { headers: { Authorization: `Bearer ${token}` } })
            .then(r => r.json())
            .then(d => {
              if (d?.gateState === 'unlocked') {
                setMirrorUnlocked(true)
                // Also fetch pattern dimensions for 4c (RecurringConditionCard)
                fetch('/api/mirror/patterns', { headers: { Authorization: `Bearer ${token}` } })
                  .then(r => r.json())
                  .then(pd => { if (pd?.top_dimensions) setPatternDimensions(pd.top_dimensions) })
                  .catch(() => {})
              }
            })
            .catch(() => {})
        }
        if (authSession?.user?.email) {
          setUserEmail(authSession.user.email)
          try { localStorage.setItem('user_email', authSession.user.email) } catch {}
        }
        const headers: Record<string, string> = { 'Content-Type': 'application/json' }
        if (token) headers['Authorization'] = `Bearer ${token}`
        const res  = await fetch('/api/history', { method: 'POST', headers, body: JSON.stringify({ ids }) })
        const data = await res.json()
        setSessions(data.sessions ?? [])
      } catch {}
      finally { setLoadingHist(false) }
    }
    loadHistory()
  }, [])

  // ── Handlers ──────────────────────────────────────────
  const markOnboarded = () => {
    try { localStorage.setItem('quorum_onboarded', 'true') } catch {}
    setIsOnboarding(false)
  }

  const handleReveal = () => {
    setInputRevealed(true)
    setTimeout(() => textareaRef.current?.focus(), 380)
  }

  const handleCardClick = () => {
    if (isOnboarding) {
      if (onboardingPanel < 2) {
        setOnboardingPanel(p => p + 1)
      } else {
        markOnboarded()
        handleReveal()
      }
    } else {
      handleReveal()
    }
  }

  const handleSkipOnboarding = (e: React.MouseEvent) => {
    e.stopPropagation()
    markOnboarded()
    handleReveal()
  }

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
      } catch {}
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
    } catch {}
  }

  const handleTipsToggle = () => {
    const next = !tipsOpen
    setTipsOpen(next)
    try { localStorage.setItem('quorum_tips_open', String(next)) } catch {}
  }

  // ── Derived values ────────────────────────────────────
  const isReturning  = sessions.length > 0
  const pending      = sessions.filter(s => !s.outcome)
  const decided      = sessions.filter(s =>  s.outcome)
  const filtered     = activeTab === 'all' ? sessions : activeTab === 'pending' ? pending : decided
  const showControls = decision.trim().length > 0

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
      <style>{`
        @keyframes blink { 0%, 100% { opacity: 0.4; } 50% { opacity: 1; } }
        .card-back-inner { transition: opacity 0.18s ease; }
        .card-back-inner:hover .card-cta { color: var(--text-3) !important; letter-spacing: 0.22em !important; }
      `}</style>

      {/* ── Fixed Navbar ─────────────────────────────────── */}
      <nav style={{
        position: 'fixed', top: 0, left: 0, right: 0,
        height: 56, zIndex: 100,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 24px',
        background: navScrolled ? 'var(--bg-void)' : 'transparent',
        borderBottom: `1px solid ${navScrolled ? 'var(--border-dim)' : 'transparent'}`,
        backdropFilter: navScrolled ? 'blur(20px)' : 'none',
        WebkitBackdropFilter: navScrolled ? 'blur(20px)' : 'none',
        transition: 'background 0.3s ease, border-color 0.3s ease',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <div style={{
            width: 30, height: 30, borderRadius: '50%',
            border: '1px solid var(--gold-dim)',
            background: 'rgba(201,168,76,0.06)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--gold)',
          }}>
            <IconScale />
          </div>
          <span style={{
            fontSize: 14, fontWeight: 400,
            letterSpacing: '0.22em', textTransform: 'uppercase',
            fontFamily: 'var(--font-display)', color: 'var(--gold)',
          }}>
            Quorum
          </span>
        </div>
        <span className="nav-tagline">Judgment Operating System</span>
      </nav>

      {/* ── Main ─────────────────────────────────────────── */}
      <main style={{
        minHeight: '100vh',
        paddingTop: 56,
        paddingBottom: 80,
        background: 'var(--bg-void)',
      }}>
        <div style={{ maxWidth: 680, margin: '0 auto', padding: '0 16px' }}>

          {/* ── Judgment Record strip (all users) ───────── */}
          <div style={{
            padding:        '14px 0 10px',
            display:        'flex',
            flexDirection:  'column',
            alignItems:     'center',
            gap:            5,
          }}>
            <p style={{
              fontFamily:    'var(--font-mono)',
              fontSize:      10,
              letterSpacing: '0.16em',
              textTransform: 'uppercase',
              color:         'var(--text-4)',
              margin:        0,
            }}>
              Your judgment record
              <span style={{ margin: '0 10px', opacity: 0.4 }}>·</span>
              <span style={{ color: 'var(--text-3)' }}>
                {loadingHist ? '—' : `${sessions.length} decision${sessions.length !== 1 ? 's' : ''}`}
              </span>
            </p>
            {!isReturning && !loadingHist && (
              <p style={{
                fontFamily:    'var(--font-mono)',
                fontSize:      9.5,
                letterSpacing: '0.1em',
                color:         'var(--text-4)',
                margin:        0,
                opacity:       0.65,
              }}>
                Every decision builds your private judgment OS
              </p>
            )}
          </div>

          {/* ── Flip card wrapper ─────────────────────────── */}
          <div style={{ position: 'relative', marginBottom: 0 }}>

            {/* ── Radial bloom behind card — dark navy glow, not visible decoration ── */}
            {!inputRevealed && (
              <div style={{
                position:     'absolute',
                inset:        '-80px -100px',
                background:   'radial-gradient(ellipse at 50% 48%, rgba(22, 42, 88, 0.72) 0%, rgba(10, 20, 48, 0.38) 42%, transparent 68%)',
                pointerEvents:'none',
                zIndex:       0,
              }} />
            )}

            {/* ── BACK FACE — QUORUM entry point / onboarding ─ */}
            <div
              className="card-back-inner"
              onClick={handleCardClick}
              onMouseEnter={() => setCardHovered(true)}
              onMouseLeave={() => setCardHovered(false)}
              style={{
                position:      inputRevealed ? 'absolute' : 'relative',
                top: 0, left: 0, right: 0,
                background:    'linear-gradient(160deg, rgba(16, 24, 44, 0.82) 0%, rgba(9, 13, 26, 0.94) 100%)',
                backdropFilter:'blur(20px)',
                WebkitBackdropFilter: 'blur(20px)',
                border:        '1px solid var(--gold-dim)',
                borderRadius:  20,
                minHeight:     inputRevealed ? 0 : 'clamp(460px, 78svh, calc(100vh - 120px))',
                display:       'flex',
                flexDirection: 'column',
                alignItems:    'center',
                justifyContent:'center',
                cursor:        'pointer',
                opacity:       inputRevealed ? 0 : 1,
                transform:     inputRevealed ? 'scale(0.985)' : cardHovered ? 'scale(1.002)' : 'scale(1)',
                transition:    'opacity 0.38s ease, transform 0.38s ease, box-shadow 0.38s ease',
                pointerEvents: inputRevealed ? 'none' : 'auto',
                zIndex:        inputRevealed ? 0 : 1,
                boxShadow:     cardHovered
                  ? '0 0 0 1px var(--gold-dim), inset 0 1px 0 rgba(255,255,255,0.08), inset 0 0 100px var(--gold-glow), 0 40px 120px rgba(0,0,0,0.60)'
                  : '0 0 0 1px var(--gold-dim), inset 0 1px 0 rgba(255,255,255,0.05), inset 0 0 70px var(--gold-glow), 0 28px 90px rgba(0,0,0,0.50)',
                padding:       '60px 40px',
                userSelect:    'none',
              }}
            >
              {/* Skip — only shown during onboarding panels 0 & 1 */}
              {isOnboarding && onboardingPanel < 2 && (
                <button
                  onClick={handleSkipOnboarding}
                  style={{
                    position:      'absolute',
                    top:           20,
                    right:         24,
                    background:    'none',
                    border:        'none',
                    fontFamily:    'var(--font-mono)',
                    fontSize:      9.5,
                    letterSpacing: '0.14em',
                    textTransform: 'uppercase',
                    color:         'var(--text-4)',
                    cursor:        'pointer',
                    padding:       '6px 4px',
                    opacity:       0.6,
                    transition:    'opacity 0.2s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
                  onMouseLeave={e => (e.currentTarget.style.opacity = '0.6')}
                >
                  Skip →
                </button>
              )}

              {/* ── Panel 0 — THE COUNCIL ──────────────────── */}
              {isOnboarding && onboardingPanel === 0 && (
                <>
                  <p style={{
                    fontFamily:    'var(--font-mono)',
                    fontSize:      11,
                    letterSpacing: '0.2em',
                    textTransform: 'uppercase',
                    color:         'var(--gold)',
                    margin:        '0 0 28px',
                    opacity:       0.75,
                  }}>
                    01 · The Council
                  </p>
                  <div style={{ width: 40, height: 1, background: 'var(--gold-dim)', marginBottom: 28, opacity: 0.5 }} />
                  <p style={{
                    fontFamily:    'var(--font-display)',
                    fontSize:      'clamp(28px, 5vw, 38px)',
                    fontWeight:    400,
                    color:         'var(--text-1)',
                    letterSpacing: '-0.01em',
                    lineHeight:    1.35,
                    textAlign:     'center',
                    margin:        0,
                    maxWidth:      340,
                  }}>
                    Six advisors analyse every decision you bring
                  </p>
                  <p style={{
                    fontFamily:    'var(--font-mono)',
                    fontSize:      13,
                    color:         'var(--text-4)',
                    lineHeight:    1.65,
                    textAlign:     'center',
                    margin:        '20px 0 0',
                    maxWidth:      320,
                    letterSpacing: '0.02em',
                  }}>
                    Each from a structurally distinct angle — stress-testing, risk mapping, pattern matching, and more.
                  </p>
                </>
              )}

              {/* ── Panel 1 — YOUR MIRROR ─────────────────── */}
              {isOnboarding && onboardingPanel === 1 && (
                <>
                  <p style={{
                    fontFamily:    'var(--font-mono)',
                    fontSize:      11,
                    letterSpacing: '0.2em',
                    textTransform: 'uppercase',
                    color:         'var(--gold)',
                    margin:        '0 0 28px',
                    opacity:       0.75,
                  }}>
                    02 · Your Mirror
                  </p>
                  <div style={{ width: 40, height: 1, background: 'var(--gold-dim)', marginBottom: 28, opacity: 0.5 }} />
                  <p style={{
                    fontFamily:    'var(--font-display)',
                    fontSize:      'clamp(28px, 5vw, 38px)',
                    fontWeight:    400,
                    color:         'var(--text-1)',
                    letterSpacing: '-0.01em',
                    lineHeight:    1.35,
                    textAlign:     'center',
                    margin:        0,
                    maxWidth:      340,
                  }}>
                    Every decision is recorded and remembered
                  </p>
                  <p style={{
                    fontFamily:    'var(--font-mono)',
                    fontSize:      13,
                    color:         'var(--text-4)',
                    lineHeight:    1.65,
                    textAlign:     'center',
                    margin:        '20px 0 0',
                    maxWidth:      320,
                    letterSpacing: '0.02em',
                  }}>
                    Over time, Mirror builds a precise model of how you actually make decisions — not how you think you do.
                  </p>
                </>
              )}

              {/* ── Panel 2 / Default — QUORUM face ────────── */}
              {(!isOnboarding || onboardingPanel === 2) && (
                <>
                  <div style={{
                    width:      56, height: 1,
                    background: 'var(--gold-dim)',
                    marginBottom: 28,
                    opacity:    cardHovered ? 0.9 : 0.7,
                    transition: 'opacity 0.3s ease',
                  }} />
                  <p style={{
                    fontFamily:    'var(--font-display)',
                    fontSize:      'clamp(52px, 9vw, 80px)',
                    fontWeight:    400,
                    color:         'var(--gold)',
                    letterSpacing: '0.38em',
                    margin:        0,
                    lineHeight:    1,
                    textTransform: 'uppercase',
                    textAlign:     'center',
                  }}>
                    Quorum
                  </p>
                  <div style={{
                    width:      56, height: 1,
                    background: 'var(--gold-dim)',
                    marginTop:  28, marginBottom: 36,
                    opacity:    cardHovered ? 0.9 : 0.7,
                    transition: 'opacity 0.3s ease',
                  }} />
                  <p className="card-cta" style={{
                    fontFamily:    'var(--font-mono)',
                    fontSize:      10.5,
                    letterSpacing: '0.18em',
                    textTransform: 'uppercase',
                    color:         'var(--text-4)',
                    margin:        0,
                    transition:    'color 0.3s ease, letter-spacing 0.35s ease',
                  }}>
                    Add to your judgment record
                  </p>
                </>
              )}

              {/* ── Bottom strip: dots + tap prompt ────────── */}
              <div style={{
                position:       'absolute',
                bottom:         28,
                left:           0, right: 0,
                display:        'flex',
                flexDirection:  'column',
                alignItems:     'center',
                gap:            10,
              }}>
                {/* Dot indicators — only during onboarding */}
                {isOnboarding && (
                  <div style={{ display: 'flex', gap: 7, alignItems: 'center' }}>
                    {[0, 1, 2].map(i => (
                      <div key={i} style={{
                        width:        i === onboardingPanel ? 18 : 6,
                        height:       6,
                        borderRadius: 3,
                        background:   i === onboardingPanel ? 'var(--gold)' : 'var(--border-mid)',
                        opacity:      i === onboardingPanel ? 1 : 0.5,
                        transition:   'width 0.3s ease, background 0.3s ease',
                      }} />
                    ))}
                  </div>
                )}

                {/* Tap prompt — panels 0 & 1 only */}
                {isOnboarding && onboardingPanel < 2 && (
                  <p style={{
                    fontFamily:    'var(--font-mono)',
                    fontSize:      9,
                    letterSpacing: '0.2em',
                    textTransform: 'uppercase',
                    color:         'var(--gold-dim)',
                    margin:        0,
                    opacity:       0.75,
                    display:       'flex',
                    alignItems:    'center',
                    gap:           6,
                  }}>
                    Tap to continue
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--gold-dim)' }}>
                      <polyline points="9 18 15 12 9 6"/>
                    </svg>
                  </p>
                )}
              </div>
            </div>

            {/* ── FRONT FACE — Decision form ──────────────── */}
            <div style={{
              background:    'var(--bg-card)',
              border:        '1px solid var(--border-mid)',
              borderRadius:  20,
              padding:       '32px 28px 28px',
              boxShadow:     'var(--shadow-card)',
              opacity:       inputRevealed ? 1 : 0,
              transform:     inputRevealed ? 'scale(1)' : 'scale(0.985)',
              transition:    'opacity 0.4s ease 0.2s, transform 0.4s ease 0.2s',
              pointerEvents: inputRevealed ? 'auto' : 'none',
            }}>
              <h1 style={{
                fontSize:      22,
                fontWeight:    400,
                color:         'var(--text-1)',
                marginBottom:  6,
                fontFamily:    'var(--font-display)',
                lineHeight:    1.2,
                letterSpacing: '-0.01em',
              }}>
                What decision are you bringing to your record?
              </h1>
              <p style={{ fontSize: 12, color: 'var(--text-4)', marginBottom: 18, lineHeight: 1.6, fontStyle: 'italic' }}>
                Add it to your judgment record. The Council runs on every decision you bring.
              </p>

              <textarea
                ref={textareaRef}
                key={formKey}
                className="decision-input"
                rows={5}
                style={{ fontSize: 15 }}
                autoComplete="off"
                placeholder="e.g. I am considering whether to sell my 40% stake in the family business to a PE firm at 8× EBITDA. The offer expires in 3 weeks…"
                value={decision}
                onChange={e => setDecision(e.target.value)}
              />

              <div style={{ marginTop: 10 }}>
                <VoiceInput onTranscript={(text) => setDecision(text)} />
              </div>

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

              <BehaviorAlerts decision={decision} authToken={authToken} />

              {/* State-gated: register mode + slider */}
              <div style={{
                overflow:   'hidden',
                maxHeight:  showControls ? 420 : 0,
                opacity:    showControls ? 1 : 0,
                marginTop:  showControls ? 20 : 0,
                transition: 'max-height 0.45s cubic-bezier(0.4,0,0.2,1), opacity 0.35s ease, margin-top 0.35s ease',
              }}>
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

                <div style={{ marginTop: 18, marginBottom: 4 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                    <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-3)', letterSpacing: '0.04em', margin: 0 }}>
                      Pre-session clarity
                    </p>
                    <span style={{
                      fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-mono)',
                      color: preDecisionConfidence <= 3 ? '#c04040' : preDecisionConfidence <= 6 ? 'var(--gold)' : 'var(--green-text)',
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
                      accentColor: preDecisionConfidence <= 3 ? '#c04040' : preDecisionConfidence <= 6 ? 'var(--gold)' : 'var(--green-text)',
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
                style={{ width: '100%', fontSize: 15, padding: '14px', marginTop: 22, letterSpacing: '0.06em' }}
                onClick={handleSubmit}
                disabled={loading || !decision.trim()}
              >
                {loading ? 'Convening the Council…' : 'Convene the Council'}
              </button>
            </div>
          </div>

          {/* ── Personas — reveal after CTA click ─────────── */}
          <div style={{
            overflow:   'hidden',
            maxHeight:  inputRevealed ? 160 : 0,
            opacity:    inputRevealed ? 1 : 0,
            marginTop:  inputRevealed ? 20 : 0,
            transition: 'max-height 0.5s ease 0.35s, opacity 0.5s ease 0.35s, margin-top 0.4s ease 0.35s',
          }}>
            <p style={{ fontSize: 11, color: 'var(--text-4)', marginBottom: 10, padding: '0 2px', fontStyle: 'italic' }}>
              Six advisors · stress-test assumptions, surface hidden gaps, and challenge the frame of every decision
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, padding: '0 2px' }}>
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
                  <div style={{ width: 7, height: 7, borderRadius: '50%', background: p.col, opacity: 0.85, flexShrink: 0 }} />
                  <span style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--font-mono)', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>
                    {p.label}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* ── Tips — collapsible (below personas) ─────────── */}
          <div style={{
            overflow:   'hidden',
            maxHeight:  inputRevealed ? 600 : 0,
            opacity:    inputRevealed ? 1 : 0,
            marginTop:  inputRevealed ? 28 : 0,
            transition: 'max-height 0.5s ease 0.5s, opacity 0.5s ease 0.5s, margin-top 0.4s ease 0.5s',
          }}>
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

          {/* ── Chunk 4a — Proactive Pattern Card ─────────── */}
          {mirrorUnlocked && sessions.length >= 5 && (
            <div style={{ marginTop: 28 }}>
              <PatternSurfaceCard
                authToken={authToken}
                sessionCount={sessions.length}
              />
            </div>
          )}

          {/* ── Chunk 4c — Recurring Condition Card ───────── */}
          {mirrorUnlocked && patternDimensions.length > 0 && (
            <RecurringConditionCard
              dimensions={patternDimensions}
              sessionCount={sessions.length}
            />
          )}

          {/* ── Memory Engine (returning users only) ──────── */}
          {sessions.length > 0 && (
            <div style={{ marginTop: 'clamp(20px, 4vw, 28px)' }}>
              <MemoryEngineStatus
                sessionCount={sessions.length}
                pendingOutcomes={pending.length}
                decidedCount={decided.length}
                hasIdentity={!!userEmail}
                mirrorUnlocked={mirrorUnlocked}
                onScrollToHistory={() => {
                  historyRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                  setActiveTab('pending')
                }}
              />
            </div>
          )}

          {/* ── Decision history (returning users only) ────── */}
          {(sessions.length > 0 || loadingHist) && (
            <div ref={historyRef} style={{ marginTop: 8, opacity: loadingHist ? 0 : 1, transition: 'opacity 0.6s ease' }}>
              {/* Header + tabs */}
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
                        cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
                      }}
                    >
                      {tab === 'all'     ? `All ${sessions.length}`   : ''}
                      {tab === 'pending' ? `Open ${pending.length}`   : ''}
                      {tab === 'decided' ? `Logged ${decided.length}` : ''}
                    </button>
                  ))}
                </div>
              </div>

              {/* Auth badge */}
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

          <p style={{ marginTop: 40, fontSize: 11, color: 'var(--text-4)', letterSpacing: '0.04em', textAlign: 'center' }}>
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

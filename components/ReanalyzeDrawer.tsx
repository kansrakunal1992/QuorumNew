'use client'

import { useState, useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getOrCreateDeviceId } from '@/lib/storage'
import TrustBadgeStrip from '@/components/TrustBadgeStrip'

interface Props {
  sessionId:    string
  decisionText: string
  contextText?: string | null
  userId?:      string | null  // passed from server component; component falls back to getSession if null
  /** Vet fix: this drawer is another moment where the user retypes/edits
   *  their (often sensitive) decision text, same as the homepage textarea —
   *  but had zero trust signal anywhere in it. Passed from the caller (same
   *  DB_ENCRYPTION_KEY check used for the record page's own TrustBadgeStrip)
   *  rather than re-derived here, so it can't drift between the two. */
  encryptionEnabled?: boolean
}

export default function ReanalyzeDrawer({ sessionId, decisionText, contextText, userId: userIdProp, encryptionEnabled }: Props) {
  const router = useRouter()

  const [drawerOpen,     setDrawerOpen]     = useState(false)
  const [reDecision,     setReDecision]     = useState(decisionText)
  const [reContext,      setReContext]       = useState(contextText ?? '')
  const [reRegisterMode, setReRegisterMode] = useState<'analytical' | 'clarification'>('analytical')
  const [reFramingIntent, setReFramingIntent] = useState<'right' | null>(null)
  // Root-cause fix (Sprint RET-4 follow-up, June 21, 2026): reanalyzed decisions previously
  // never captured entry confidence, so they were silently invisible to the calibration
  // record (KDD 194). Defaults to 5, same as the homepage form's slider.
  const [rePreConfidence, setRePreConfidence] = useState(5)
  const [reanalyzing,    setReanalyzing]     = useState(false)
  const [reanalyzeError, setReanalyzeError] = useState('')

  // S2-08: prior Council summary — fetched once when the drawer opens, so the user
  // recalls what was already concluded before choosing what to change. Full text is
  // fetched; a short preview shows by default with a toggle to expand (fix: previously
  // truncated server-side with no way to see the rest).
  const [priorSynthesisFull,    setPriorSynthesisFull]    = useState<string | null>(null)
  const [priorSummaryLoaded,    setPriorSummaryLoaded]    = useState(false)
  const [priorSummaryExpanded,  setPriorSummaryExpanded]  = useState(false)
  const PRIOR_SUMMARY_PREVIEW_CHARS = 220
  useEffect(() => {
    if (!drawerOpen || priorSummaryLoaded) return
    setPriorSummaryLoaded(true)
    fetch(`/api/session/${sessionId}/synthesis-summary`)
      .then(r => r.json())
      .then(data => setPriorSynthesisFull(data.full ?? null))
      .catch(() => setPriorSynthesisFull(null))
  }, [drawerOpen, priorSummaryLoaded, sessionId])

  const handleReanalyze = useCallback(async () => {
    if (!reDecision.trim() || reDecision.trim().length < 20) {
      setReanalyzeError('Please describe your decision in at least a sentence.')
      return
    }
    setReanalyzeError('')
    setReanalyzing(true)
    try {
      // S4-02: server derives user_id from Bearer token only — never trust body.
      // Get the access token here and pass it as Authorization header.
      let accessToken: string | null = null
      try {
        const { createClient } = await import('@/lib/supabase')
        const sb = createClient()
        const { data: { session: authSession } } = await sb.auth.getSession()
        accessToken = authSession?.access_token ?? null
      } catch { /* non-blocking */ }

      const res = await fetch('/api/session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { 'Authorization': `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({
          decision_text: reDecision.trim(),
          context_text:  reContext.trim() || null,
          register_mode: reFramingIntent === 'right' ? 'analytical' : reRegisterMode,
          framing_intent: reFramingIntent ?? undefined,
          pre_decision_confidence: rePreConfidence,
          // user_id intentionally omitted — server derives from Bearer token (S4-02)
          device_id:     getOrCreateDeviceId(), // ← device fallback
          parent_session_id: sessionId,         // ← RET-5 Sprint 1: link back to origin
        }),
      })
      if (!res.ok) throw new Error()
      const { id } = await res.json()
      router.push(`/session/${id}`)
    } catch {
      setReanalyzeError('Something went wrong. Please try again.')
      setReanalyzing(false)
    }
  }, [reDecision, reContext, reRegisterMode, reFramingIntent, rePreConfidence, sessionId, router])

  return (
    <>
      {/* Trigger button — styled to match the ghost buttons on the record page */}
      <button
        className="btn-ghost"
        style={{ padding: '10px 20px', fontSize: 13, display: 'flex', alignItems: 'center', gap: 7 }}
        onClick={() => setDrawerOpen(true)}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="1 4 1 10 7 10"/>
          <polyline points="23 20 23 14 17 14"/>
          <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/>
        </svg>
        Reanalyze
      </button>

      {/* Drawer — same pattern as SessionView */}
      {drawerOpen && (
        <>
          <div
            onClick={() => setDrawerOpen(false)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(2,4,10,0.78)', zIndex: 40 }}
          />
          <div style={{
            position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 50,
            background: 'var(--bg-card)',
            border: '1px solid var(--border-mid)', borderBottom: 'none',
            borderRadius: '18px 18px 0 0',
            padding: '28px 28px 40px',
            maxWidth: 760, margin: '0 auto',
            // Fix: drawer had no height cap or scroll — content taller than the viewport
            // (e.g. the S2-08 prior-summary card) was pushed above the visible area with
            // no way to reach it. Caps height and makes the drawer itself scrollable.
            maxHeight: '88vh',
            overflowY: 'auto',
            WebkitOverflowScrolling: 'touch',
          }}>
            {/* Drag handle */}
            <div style={{ width: 40, height: 4, borderRadius: 2, background: 'var(--border-mid)', margin: '0 auto 22px' }} />

            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
              <div>
                <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-1)', margin: 0 }}>Reanalyze</h2>
                <p style={{ fontSize: 12, color: 'var(--text-4)', marginTop: 3 }}>
                  Edit your decision or add context — all six advisors re-run
                </p>
              </div>
              <button className="btn-ghost" style={{ padding: '5px 12px', fontSize: 12 }} onClick={() => setDrawerOpen(false)}>
                ✕ Close
              </button>
            </div>

            {/* Vet fix: same trust signal as the homepage and record page,
                kept to just the strip — no extra copy — since this is
                already a focused, single-purpose drawer. */}
            <TrustBadgeStrip encryptionEnabled={encryptionEnabled} securityHref="/security" />

            {/* S2-08: prior Council summary — reminds the user what was already concluded */}
            {priorSynthesisFull && (
              <div style={{
                padding:      '11px 14px',
                borderRadius:  9,
                border:        '1px solid var(--border-dim)',
                background:    'var(--bg-inset)',
                marginBottom:  16,
              }}>
                <p style={{
                  fontFamily:    'var(--font-mono)',
                  fontSize:      9.5,
                  fontWeight:    700,
                  letterSpacing: '0.11em',
                  textTransform: 'uppercase',
                  color:         'var(--text-4)',
                  margin:        '0 0 6px',
                }}>
                  What the Council concluded last time
                </p>
                <p style={{ fontSize: 12.5, color: 'var(--text-3)', lineHeight: 1.6, margin: 0, fontStyle: 'italic' }}>
                  {priorSummaryExpanded || priorSynthesisFull.length <= PRIOR_SUMMARY_PREVIEW_CHARS
                    ? priorSynthesisFull
                    : `${priorSynthesisFull.slice(0, PRIOR_SUMMARY_PREVIEW_CHARS).trimEnd()}…`}
                </p>
                {priorSynthesisFull.length > PRIOR_SUMMARY_PREVIEW_CHARS && (
                  <button
                    onClick={() => setPriorSummaryExpanded(v => !v)}
                    style={{
                      marginTop:   7,
                      padding:     0,
                      background:  'transparent',
                      border:      'none',
                      color:       'var(--gold)',
                      fontSize:    11.5,
                      fontWeight:  600,
                      cursor:      'pointer',
                      fontFamily:  'inherit',
                    }}
                  >
                    {priorSummaryExpanded ? 'Show less ▴' : 'Show full synthesis ▾'}
                  </button>
                )}
              </div>
            )}

            {/* Decision textarea */}
            <label style={{ display: 'block', fontSize: 12, color: 'var(--text-3)', marginBottom: 6, fontWeight: 500 }}>
              Decision
            </label>
            <textarea
              rows={5}
              value={reDecision}
              onChange={(e) => setReDecision(e.target.value)}
              style={{ fontSize: 13.5, marginBottom: 14 }}
              placeholder="Describe your decision…"
            />

            {/* Context textarea */}
            <label style={{ display: 'block', fontSize: 12, color: 'var(--text-3)', marginBottom: 6, fontWeight: 500 }}>
              Additional context <span style={{ color: 'var(--text-4)', fontWeight: 400 }}>(optional)</span>
            </label>
            <textarea
              rows={3}
              value={reContext}
              onChange={(e) => setReContext(e.target.value)}
              style={{ fontSize: 13, marginBottom: 18 }}
              placeholder="Add new information that has emerged…"
            />

            {/* Register mode / framing toggle */}
            <label style={{ display: 'block', fontSize: 12, color: 'var(--text-3)', marginBottom: 8, fontWeight: 500 }}>
              What are you looking for this time?
            </label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 18 }}>
              {([
                {
                  id: 'analytical', icon: '⚔', label: 'Challenge my thinking',
                  sub: 'Stress-test the decision', activeColor: 'var(--gold)',
                  activeBg: 'rgba(201,168,76,0.1)', activeText: 'var(--gold)',
                },
                {
                  id: 'clarification', icon: '🪞', label: 'Help me understand what I want',
                  sub: 'Values and identity', activeColor: 'var(--success-border)',
                  activeBg: 'var(--success-bg)', activeText: 'var(--success-text)',
                },
                {
                  id: 'right', icon: '⚖', label: "Tell me what's actually right here",
                  sub: 'Give me a clear call, not just perspectives', activeColor: '#9b7fd4',
                  activeBg: 'rgba(155,127,212,0.10)', activeText: '#9b7fd4',
                },
              ] as const).map(opt => {
                const isActive = opt.id === 'right'
                  ? reFramingIntent === 'right'
                  : reFramingIntent !== 'right' && reRegisterMode === opt.id
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => {
                      if (opt.id === 'right') {
                        setReFramingIntent('right')
                      } else {
                        setReFramingIntent(null)
                        setReRegisterMode(opt.id as 'analytical' | 'clarification')
                      }
                    }}
                    style={{
                      padding: '10px 14px', borderRadius: 9, textAlign: 'left',
                      cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s',
                      border: `1px solid ${isActive ? opt.activeColor : 'var(--border-dim)'}`,
                      background: isActive ? opt.activeBg : 'transparent',
                    }}
                  >
                    <p style={{
                      fontSize: 12, fontWeight: 600, marginBottom: 2,
                      color: isActive ? opt.activeText : 'var(--text-2)',
                    }}>
                      {opt.icon} {opt.label}
                    </p>
                    <p style={{ fontSize: 11, color: 'var(--text-4)' }}>{opt.sub}</p>
                  </button>
                )
              })}
            </div>

            {/* Confidence slider — closes the gap that left reanalyzed decisions
                out of the calibration record (KDD 194) */}
            <div style={{ marginBottom: 18 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <label style={{ fontSize: 12, color: 'var(--text-3)', fontWeight: 500 }}>
                  Confidence going into this reanalysis
                </label>
                <span style={{
                  fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-mono)',
                  color: rePreConfidence <= 3 ? '#c04040' : rePreConfidence <= 6 ? 'var(--gold)' : 'var(--success-text)',
                  minWidth: 28, textAlign: 'right',
                }}>
                  {rePreConfidence}<span style={{ fontSize: 10, fontWeight: 400, color: 'var(--text-4)' }}>/10</span>
                </span>
              </div>
              <input
                type="range" min={1} max={10} step={1}
                value={rePreConfidence}
                onChange={(e) => setRePreConfidence(Number(e.target.value))}
                style={{
                  width: '100%',
                  accentColor: rePreConfidence <= 3 ? '#c04040' : rePreConfidence <= 6 ? 'var(--gold)' : 'var(--success-text)',
                  cursor: 'pointer', height: 4,
                }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 5 }}>
                <span style={{ fontSize: 10, color: 'var(--text-4)' }}>Foggy</span>
                <span style={{ fontSize: 10, color: 'var(--text-4)' }}>Fully clear</span>
              </div>
            </div>

            {reanalyzeError && (
              <p style={{ fontSize: 12, color: '#e05050', marginBottom: 12 }}>{reanalyzeError}</p>
            )}

            <div style={{ display: 'flex', gap: 10 }}>
              <button
                className="btn-primary"
                style={{ flex: 1, fontSize: 14, padding: '13px' }}
                onClick={handleReanalyze}
                disabled={reanalyzing || !reDecision.trim()}
              >
                {reanalyzing ? 'Convening new Council…' : 'Convene New Council'}
              </button>
              <button
                className="btn-ghost"
                style={{ padding: '13px 20px', fontSize: 13 }}
                onClick={() => setDrawerOpen(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </>
      )}
    </>
  )
}

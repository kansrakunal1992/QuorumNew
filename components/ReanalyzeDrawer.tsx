'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { getOrCreateDeviceId } from '@/lib/storage'

interface Props {
  sessionId:    string
  decisionText: string
  contextText?: string | null
  userId?:      string | null  // passed from server component; component falls back to getSession if null
}

export default function ReanalyzeDrawer({ sessionId, decisionText, contextText, userId: userIdProp }: Props) {
  const router = useRouter()

  const [drawerOpen,     setDrawerOpen]     = useState(false)
  const [reDecision,     setReDecision]     = useState(decisionText)
  const [reContext,      setReContext]       = useState(contextText ?? '')
  const [reRegisterMode, setReRegisterMode] = useState<'analytical' | 'clarification'>('analytical')
  // Root-cause fix (Sprint RET-4 follow-up, June 21, 2026): reanalyzed decisions previously
  // never captured entry confidence, so they were silently invisible to the calibration
  // record (KDD 194). Defaults to 5, same as the homepage form's slider.
  const [rePreConfidence, setRePreConfidence] = useState(5)
  const [reanalyzing,    setReanalyzing]     = useState(false)
  const [reanalyzeError, setReanalyzeError] = useState('')

  const handleReanalyze = useCallback(async () => {
    if (!reDecision.trim() || reDecision.trim().length < 20) {
      setReanalyzeError('Please describe your decision in at least a sentence.')
      return
    }
    setReanalyzeError('')
    setReanalyzing(true)
    try {
      // Resolve user_id: prefer prop (passed from server component which read the session row).
      // Fall back to live getSession() in case the record page didn't pass it.
      let resolvedUserId: string | null = userIdProp ?? null
      if (!resolvedUserId) {
        try {
          const { createClient } = await import('@/lib/supabase')
          const sb = createClient()
          const { data: { session: authSession } } = await sb.auth.getSession()
          resolvedUserId = authSession?.user?.id ?? null
        } catch { /* non-blocking */ }
      }

      const res = await fetch('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decision_text: reDecision.trim(),
          context_text:  reContext.trim() || null,
          register_mode: reRegisterMode,
          pre_decision_confidence: rePreConfidence,
          user_id:       resolvedUserId,       // ← carry auth into new session
          device_id:     getOrCreateDeviceId(), // ← device fallback
        }),
      })
      if (!res.ok) throw new Error()
      const { id } = await res.json()
      router.push(`/session/${id}`)
    } catch {
      setReanalyzeError('Something went wrong. Please try again.')
      setReanalyzing(false)
    }
  }, [reDecision, reContext, reRegisterMode, rePreConfidence, router])

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

            {/* Register mode toggle */}
            <label style={{ display: 'block', fontSize: 12, color: 'var(--text-3)', marginBottom: 8, fontWeight: 500 }}>
              What are you looking for this time?
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 18 }}>
              {([
                { value: 'analytical',   icon: '⚔', label: 'Challenge my thinking',          sub: 'Stress-test the decision' },
                { value: 'clarification', icon: '🪞', label: 'Help me understand what I want', sub: 'Values and identity' },
              ] as const).map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setReRegisterMode(opt.value)}
                  style={{
                    padding: '10px 12px', borderRadius: 9, textAlign: 'left',
                    cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s',
                    border: `1px solid ${reRegisterMode === opt.value
                      ? (opt.value === 'analytical' ? 'var(--gold)' : 'var(--success-border)')
                      : 'var(--border-dim)'}`,
                    background: reRegisterMode === opt.value
                      ? (opt.value === 'analytical' ? 'rgba(201,168,76,0.1)' : 'var(--success-bg)')
                      : 'transparent',
                  }}
                >
                  <p style={{
                    fontSize: 12, fontWeight: 600, marginBottom: 2,
                    color: reRegisterMode === opt.value
                      ? (opt.value === 'analytical' ? 'var(--gold)' : 'var(--success-text)')
                      : 'var(--text-2)',
                  }}>
                    {opt.icon} {opt.label}
                  </p>
                  <p style={{ fontSize: 11, color: 'var(--text-4)' }}>{opt.sub}</p>
                </button>
              ))}
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

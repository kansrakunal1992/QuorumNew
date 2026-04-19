'use client'

import { useRouter } from 'next/navigation'
import { useState, useCallback } from 'react'
import PersonaPanel from './PersonaPanel'
import SynthesisCard from './SynthesisCard'
import { PERSONAS, PERSONA_ORDER } from '@/lib/personas'
import type { Session } from '@/lib/types'

interface Props {
  session: Session
}

export default function SessionView({ session: initialSession }: Props) {
  const router = useRouter()
  const [saving,  setSaving]  = useState(false)
  const [saved,   setSaved]   = useState(false)

  const [session,    setSession]    = useState<Session>(initialSession)
  const [sessionKey, setSessionKey] = useState(0)

  // Track which personas have completed + their response text
  const [completedResponses, setCompletedResponses] = useState<Record<string, string>>({})

  const [synthesisVersion, setSynthesisVersion] = useState(0)

  const handlePersonaComplete = useCallback((personaKey: string, content: string) => {
    setCompletedResponses(prev => {
      const isUpdate = personaKey in prev  // true = pushback update
      if (isUpdate) setSynthesisVersion(v => v + 1)
      return { ...prev, [personaKey]: content }
    })
  }, [])

  // Reanalyze drawer
  const [drawerOpen,     setDrawerOpen]     = useState(false)
  const [reDecision,     setReDecision]     = useState(initialSession.decision_text)
  const [reContext,      setReContext]       = useState(initialSession.context_text ?? '')
  const [reanalyzing,    setReanalyzing]     = useState(false)
  const [reanalyzeError, setReanalyzeError] = useState('')

  const handleNewDecision = () => {
    if (!saved) {
      const ok = window.confirm(
        `Start a new decision?\n\nThis session is still available at its URL, but you haven\u2019t saved the Decision Record yet.`
      )
      if (!ok) return
    }
    router.push('/')
  }

  const handleSaveRecord = async () => {
    setSaving(true)
    try {
      const res = await fetch('/api/record', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: session.id }),
      })
      if (!res.ok) throw new Error()
      setSaved(true)
      router.push(`/record/${session.id}`)
    } catch {
      setSaving(false)
      alert('Could not save record. Please try again.')
    }
  }

  const handleReanalyze = useCallback(async () => {
    if (!reDecision.trim() || reDecision.trim().length < 20) {
      setReanalyzeError('Please describe your decision in at least a sentence.')
      return
    }
    setReanalyzeError('')
    setReanalyzing(true)
    try {
      const res = await fetch('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision_text: reDecision.trim(), context_text: reContext.trim() || null }),
      })
      if (!res.ok) throw new Error()
      const { id } = await res.json()
      const sessionRes = await fetch(`/api/session?id=${id}`)
      if (!sessionRes.ok) throw new Error()
      const newSession: Session = await sessionRes.json()
      setSession(newSession)
      setSessionKey(k => k + 1)
      setCompletedResponses({})  // reset synthesis tracking
      setSynthesisVersion(0)
      setSaved(false)
      setDrawerOpen(false)
      setReanalyzing(false)
      window.history.replaceState(null, '', `/session/${id}`)
    } catch {
      setReanalyzeError('Something went wrong. Please try again.')
      setReanalyzing(false)
    }
  }, [reDecision, reContext])

  return (
    <div className="min-h-screen px-4 py-8" style={{ background: 'var(--bg-void)' }}>

      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="max-w-7xl mx-auto mb-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div style={{ flex: 1, minWidth: 240 }}>
            <div className="flex items-center gap-3 mb-2">
              <span style={{ fontSize: 17, fontWeight: 700, letterSpacing: '0.2em', color: 'var(--gold)', textTransform: 'uppercase' }}>
                Quorum
              </span>
              <span style={{ fontSize: 11, padding: '3px 10px', borderRadius: 20, background: 'var(--bg-inset)', color: 'var(--text-4)', border: '1px solid var(--border-dim)' }}>
                Session active
              </span>
            </div>
            <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-3)', marginBottom: 4, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              The Decision
            </p>
            <p style={{ fontSize: 13.5, lineHeight: 1.65, color: 'var(--text-2)', maxWidth: 640, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
              {session.decision_text}
            </p>
          </div>

          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flexShrink: 0, flexWrap: 'wrap' }}>
            <button className="btn-ghost" style={{ fontSize: 13, padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 7 }} onClick={handleNewDecision}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
              New Decision
            </button>
            <button className="btn-ghost" style={{ fontSize: 13, padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 7 }} onClick={() => { setReDecision(session.decision_text); setReContext(session.context_text ?? ''); setDrawerOpen(true) }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="1 4 1 10 7 10"/><polyline points="23 20 23 14 17 14"/>
                <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/>
              </svg>
              Reanalyze
            </button>
            <button className="btn-primary" style={{ fontSize: 13, padding: '10px 18px' }} onClick={handleSaveRecord} disabled={saving}>
              {saving ? 'Saving…' : 'Save Record → PDF'}
            </button>
          </div>
        </div>

        {session.context_text && (
          <div style={{ marginTop: 10, padding: '8px 14px', borderRadius: 8, background: 'var(--bg-inset)', border: '1px solid var(--border-dim)', fontSize: 12, color: 'var(--text-4)', display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            <span style={{ color: 'var(--text-3)' }}>Context · </span>{session.context_text}
          </div>
        )}
        <p style={{ marginTop: 8, fontSize: 11, color: 'var(--text-4)' }}>
          Sessions are private by URL. No account or identity is linked to this decision.
        </p>
      </div>

      {/* ── Grid: Synthesis card first (full width), then 6 panels ── */}
      <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">

        {/* Synthesis spans all 3 columns */}
        <SynthesisCard
          key={`synthesis-${sessionKey}`}
          sessionId={session.id}
          decisionText={session.decision_text}
          contextText={session.context_text ?? undefined}
          personaResponses={completedResponses}
          totalPersonas={PERSONA_ORDER.length}
          version={synthesisVersion}
        />

        {/* 6 persona panels */}
        {PERSONA_ORDER.map((key) => (
          <PersonaPanel
            key={`${key}-${sessionKey}`}
            persona={PERSONAS[key]}
            sessionId={session.id}
            decisionText={session.decision_text}
            contextText={session.context_text ?? undefined}
            onComplete={handlePersonaComplete}
          />
        ))}
      </div>

      {/* ── Bottom bar ────────────────────────────────────────── */}
      <div style={{ maxWidth: '80rem', margin: '28px auto 0', display: 'flex', justifyContent: 'center', gap: 12, flexWrap: 'wrap' }}>
        <button className="btn-ghost" style={{ fontSize: 13, padding: '11px 20px', display: 'flex', alignItems: 'center', gap: 7 }} onClick={handleNewDecision}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          New Decision
        </button>
        <button className="btn-ghost" style={{ fontSize: 13, padding: '11px 20px', display: 'flex', alignItems: 'center', gap: 7 }} onClick={() => { setReDecision(session.decision_text); setReContext(session.context_text ?? ''); setDrawerOpen(true) }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="1 4 1 10 7 10"/><polyline points="23 20 23 14 17 14"/>
            <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/>
          </svg>
          Reanalyze
        </button>
        <button className="btn-primary" style={{ fontSize: 13, padding: '11px 28px' }} onClick={handleSaveRecord} disabled={saving}>
          {saving ? 'Saving…' : 'Save Decision Record → Export PDF'}
        </button>
      </div>

      {/* ── Reanalyze drawer ─────────────────────────────────── */}
      {drawerOpen && (
        <>
          <div onClick={() => setDrawerOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(2,4,10,0.78)', zIndex: 40 }} />
          <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 50, background: 'var(--bg-card)', border: '1px solid var(--border-mid)', borderBottom: 'none', borderRadius: '18px 18px 0 0', padding: '28px 28px 40px', maxWidth: 760, margin: '0 auto' }}>
            <div style={{ width: 40, height: 4, borderRadius: 2, background: 'var(--border-mid)', margin: '0 auto 22px' }} />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
              <div>
                <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-1)', margin: 0 }}>Reanalyze</h2>
                <p style={{ fontSize: 12, color: 'var(--text-4)', marginTop: 3 }}>Edit your decision or add context — all six advisors re-run</p>
              </div>
              <button className="btn-ghost" style={{ padding: '5px 12px', fontSize: 12 }} onClick={() => setDrawerOpen(false)}>✕ Close</button>
            </div>
            <label style={{ display: 'block', fontSize: 12, color: 'var(--text-3)', marginBottom: 6, fontWeight: 500 }}>Decision</label>
            <textarea rows={5} value={reDecision} onChange={(e) => setReDecision(e.target.value)} style={{ fontSize: 13.5, marginBottom: 14 }} placeholder="Describe your decision…" />
            <label style={{ display: 'block', fontSize: 12, color: 'var(--text-3)', marginBottom: 6, fontWeight: 500 }}>
              Additional context <span style={{ color: 'var(--text-4)', fontWeight: 400 }}>(optional)</span>
            </label>
            <textarea rows={3} value={reContext} onChange={(e) => setReContext(e.target.value)} style={{ fontSize: 13, marginBottom: 18 }} placeholder="Add new information that has emerged…" />
            {reanalyzeError && <p style={{ fontSize: 12, color: '#e05050', marginBottom: 12 }}>{reanalyzeError}</p>}
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn-primary" style={{ flex: 1, fontSize: 14, padding: '13px' }} onClick={handleReanalyze} disabled={reanalyzing || !reDecision.trim()}>
                {reanalyzing ? 'Convening new Council…' : 'Convene New Council'}
              </button>
              <button className="btn-ghost" style={{ padding: '13px 20px', fontSize: 13 }} onClick={() => setDrawerOpen(false)}>Cancel</button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

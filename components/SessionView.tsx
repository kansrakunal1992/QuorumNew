'use client'

import { useRouter } from 'next/navigation'
import { pushSessionId } from '@/lib/storage'
import { useState, useCallback, useEffect } from 'react'
import PersonaPanel from './PersonaPanel'
import ExaminerPanel from './ExaminerPanel'
import SynthesisCard from './SynthesisCard'
import { PERSONAS, PERSONA_ORDER } from '@/lib/personas'
import type { Session, RegisterMode } from '@/lib/types'

interface Props {
  session: Session
}

// ── Gap → Persona mapping ────────────────────────────────────────────────
// Maps examiner gap text to the 1 persona best positioned to update on it
function mapGapToPersona(gap: string): string | null {
  const g = gap.toLowerCase()
  // Stakeholder/relational gaps → Stakeholder Mirror
  if (
    g.includes('stakeholder') || g.includes('spouse') || g.includes('co-founder') ||
    g.includes('sister') || g.includes('brother') || g.includes('wife') ||
    g.includes('children') || g.includes('father') || g.includes('mother') ||
    g.includes('son') || g.includes('daughter') || g.includes('family') ||
    g.includes('succession') || g.includes('motivation') || g.includes('personal') ||
    g.includes('relationship') || g.includes('partner')
  ) return 'stakeholder_mirror'
  // Financial/execution/counterparty gaps → Risk Architect
  if (
    g.includes('financial') || g.includes('health') || g.includes('track record') ||
    g.includes('cash') || g.includes('legal') || g.includes('contract') ||
    g.includes('exit') || g.includes('runway') || g.includes('execution') ||
    g.includes('counterparty') || g.includes('investor') || g.includes('vendor') ||
    g.includes('terms') || g.includes('fee') || g.includes('penalty') ||
    g.includes('valuation') || g.includes('tax')
  ) return 'risk_architect'
  // Market/pattern/competitive gaps → Pattern Analyst
  if (
    g.includes('market') || g.includes('competitive') || g.includes('landscape') ||
    g.includes('demand') || g.includes('industry') || g.includes('precedent')
  ) return 'pattern_analyst'
  return null
}

// Build examiner context string for a persona, from the responses that map to it
function buildExaminerContextForPersona(
  personaKey: string,
  responses: Array<{ question_text: string; response_text: string | null; gap: string }>
): string | undefined {
  const relevant = responses.filter(r => mapGapToPersona(r.gap) === personaKey && r.response_text?.trim())
  if (relevant.length === 0) return undefined
  const lines = relevant.map(r => `Q: ${r.question_text}\nA: ${r.response_text}`).join('\n\n')
  return `The Examiner gathered additional information from the decision-maker after your initial analysis. Review these answers and update your position if the new information changes your assessment:\n\n${lines}\n\nProvide a concise update (under 200 words). If the new information significantly changes your view, say so directly. If it confirms your original analysis, say that — and why.`
}

export default function SessionView({ session: initialSession }: Props) {
  const router = useRouter()
  const [saving,  setSaving]  = useState(false)

  useEffect(() => {
    try {
      const key = 'quorum_session_ids'
      const raw = localStorage.getItem(key)
      const ids: string[] = raw ? JSON.parse(raw) : []
      if (!ids.includes(initialSession.id)) {
        const updated = [initialSession.id, ...ids].slice(0, 20)
        localStorage.setItem(key, JSON.stringify(updated))
      }
    } catch {}
  }, [initialSession.id])

  const [saved, setSaved] = useState(false)

  const [registerMode,    setRegisterMode]    = useState<RegisterMode>(
    (initialSession.register_mode ?? 'analytical') as RegisterMode
  )
  const [reRegisterMode,  setReRegisterMode]  = useState<RegisterMode>(
    (initialSession.register_mode ?? 'analytical') as RegisterMode
  )

  const [session,    setSession]    = useState<Session>(initialSession)
  const [sessionKey, setSessionKey] = useState(0)
  const [completedResponses, setCompletedResponses] = useState<Record<string, string>>({})

  // Sprint 3: synthesis gated on examiner + examiner re-run context per persona
  const [examinerReady,           setExaminerReady]           = useState(false)
  const [synthesisVersion,        setSynthesisVersion]        = useState(0)
  const [examinerContextByPersona, setExaminerContextByPersona] = useState<Record<string, string>>({})

  // Sprint 5: structural context fetched async, injected into eligible personas
  const [structuralContext, setStructuralContext] = useState<string | null>(null)

  useEffect(() => {
    // Fire structural match fetch immediately on load — runs in parallel with personas
    // Only attempt if we have user identity
    if (!storedEmail) return

    fetch('/api/structural-match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId:  initialSession.id,
      }),
    })
      .then(r => r.json())
      .then(data => {
        if (data.threshold_met && data.context_block) {
          setStructuralContext(data.context_block)
          console.log(`[SessionView] Structural context loaded — ${data.matches?.length ?? 0} match(es), ${data.session_count_used} sessions scored`)
        }
      })
      .catch(err => {
        // Silent fail — structural retrieval is background enhancement
        console.error('[SessionView] Structural match fetch failed:', err)
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSession.id])

  const handlePersonaComplete = useCallback((personaKey: string, content: string) => {
    setCompletedResponses(prev => {
      const isUpdate = personaKey in prev
      if (isUpdate) setSynthesisVersion(v => v + 1)
      return { ...prev, [personaKey]: content }
    })
  }, [])

  const allPersonasDone = Object.keys(completedResponses).length >= PERSONA_ORDER.length

  // Receives examiner answers, maps them to personas, triggers selective re-runs
  const handleExaminerComplete = useCallback(
    (responses: Array<{ question_text: string; response_text: string | null; gap: string }>) => {
      setExaminerReady(true)
      if (!responses.length) return

      // Build context for up to 2 unique personas
      const seen = new Set<string>()
      const contextMap: Record<string, string> = {}
      for (const r of responses) {
        if (!r.response_text?.trim()) continue
        const pk = mapGapToPersona(r.gap)
        if (pk && !seen.has(pk) && seen.size < 2) seen.add(pk)
      }
      for (const pk of seen) {
        const ctx = buildExaminerContextForPersona(pk, responses)
        if (ctx) contextMap[pk] = ctx
      }
      if (Object.keys(contextMap).length > 0) {
        setExaminerContextByPersona(contextMap)
      }
    },
    []
  )

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
        body: JSON.stringify({ decision_text: reDecision.trim(), context_text: reContext.trim() || null, register_mode: reRegisterMode }),
      })
      if (!res.ok) throw new Error()
      const { id } = await res.json()
      const sessionRes = await fetch(`/api/session?id=${id}`)
      if (!sessionRes.ok) throw new Error()
      const newSession: Session = await sessionRes.json()
      setSession(newSession)
      setSessionKey(k => k + 1)
      setCompletedResponses({})
      setExaminerReady(false)
      setExaminerContextByPersona({})
      setRegisterMode(reRegisterMode)
      setSynthesisVersion(0)
      setSaved(false)
      setDrawerOpen(false)
      setReanalyzing(false)
      window.history.replaceState(null, '', `/session/${id}`)
    } catch {
      setReanalyzeError('Something went wrong. Please try again.')
      setReanalyzing(false)
    }
  }, [reDecision, reContext, reRegisterMode])

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

      <div className="max-w-7xl mx-auto">

        {/* ── 1. Council Synthesis — pinned at top, always visible ── */}
        <div style={{ marginBottom: 16 }}>
          <SynthesisCard
            key={`synthesis-${sessionKey}`}
            sessionId={session.id}
            decisionText={session.decision_text}
            contextText={session.context_text ?? undefined}
            personaResponses={completedResponses}
            totalPersonas={PERSONA_ORDER.length}
            version={synthesisVersion}
            registerMode={registerMode}
            examinerReady={examinerReady}
          />
        </div>

        {/* ── 2. Examiner Phase 1 — appears once all 6 personas done, gates synthesis ── */}
        <ExaminerPanel
          key={`examiner-${sessionKey}`}
          sessionId={session.id}
          visible={allPersonasDone}
          onComplete={handleExaminerComplete}
        />

        {/* ── 3. Six persona panels in grid ── */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4" style={{ marginTop: 16 }}>
          {PERSONA_ORDER.map((key) => (
            <PersonaPanel
              key={`${key}-${sessionKey}`}
              persona={PERSONAS[key]}
              sessionId={session.id}
              decisionText={session.decision_text}
              contextText={session.context_text ?? undefined}
              registerMode={registerMode}
              onComplete={handlePersonaComplete}
              examinerContext={examinerContextByPersona[key]}
              structuralContext={structuralContext ?? undefined}
            />
          ))}
        </div>

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
            <label style={{ display: 'block', fontSize: 12, color: 'var(--text-3)', marginBottom: 8, fontWeight: 500 }}>
              What are you looking for this time?
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 18 }}>
              {([
                { value: 'analytical', icon: '⚔', label: 'Challenge my thinking', sub: 'Stress-test the decision' },
                { value: 'clarification', icon: '🪞', label: 'Help me understand what I want', sub: 'Values and identity' },
              ] as const).map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setReRegisterMode(opt.value)}
                  style={{
                    padding: '10px 12px', borderRadius: 9, textAlign: 'left',
                    cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s',
                    border: `1px solid ${reRegisterMode === opt.value ? (opt.value === 'analytical' ? 'var(--gold)' : '#4ade80') : 'var(--border-dim)'}`,
                    background: reRegisterMode === opt.value ? (opt.value === 'analytical' ? 'rgba(201,168,76,0.1)' : 'rgba(74,222,128,0.08)') : 'transparent',
                  }}
                >
                  <p style={{ fontSize: 12, fontWeight: 600, color: reRegisterMode === opt.value ? (opt.value === 'analytical' ? 'var(--gold)' : '#4ade80') : 'var(--text-2)', marginBottom: 2 }}>
                    {opt.icon} {opt.label}
                  </p>
                  <p style={{ fontSize: 11, color: 'var(--text-4)' }}>{opt.sub}</p>
                </button>
              ))}
            </div>
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

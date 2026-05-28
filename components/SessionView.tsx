'use client'

import { useRouter } from 'next/navigation'
import { pushSessionId, getOrCreateDeviceId, getStoredSessionIds } from '@/lib/storage'
import { useState, useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import PersonaPanel from './PersonaPanel'
import ExaminerPanel from './ExaminerPanel'
import SynthesisCard from './SynthesisCard'
import CouncilStatusBar from './CouncilStatusBar'
import { TTSProvider } from '@/context/TTSContext'
import { PERSONAS, PERSONA_ORDER, computePersonaOrder } from '@/lib/personas'
import type { Session, RegisterMode } from '@/lib/types'
import type { PersonaKey } from '@/lib/types'
import { createClient } from '@/lib/supabase'
import RecordReceipt from './RecordReceipt'

interface Props {
  session: Session
  initialMessages?: Record<string, string>
  totalSessionCount?: number   // real DB count for RecordReceipt, passed from server
}

type RuleMode = 'REDIRECT' | 'GATE' | 'OPEN' | null

// ── Gap → Persona mapping ────────────────────────────────────────────────
function mapGapToPersona(gap: string): string | null {
  const g = gap.toLowerCase()
  if (
    g.includes('stakeholder') || g.includes('spouse') || g.includes('co-founder') ||
    g.includes('sister') || g.includes('brother') || g.includes('wife') ||
    g.includes('children') || g.includes('father') || g.includes('mother') ||
    g.includes('son') || g.includes('daughter') || g.includes('family') ||
    g.includes('succession') || g.includes('motivation') || g.includes('personal') ||
    g.includes('relationship') || g.includes('partner')
  ) return 'stakeholder_mirror'
  if (
    g.includes('financial') || g.includes('health') || g.includes('track record') ||
    g.includes('cash') || g.includes('legal') || g.includes('contract') ||
    g.includes('exit') || g.includes('runway') || g.includes('execution') ||
    g.includes('counterparty') || g.includes('investor') || g.includes('vendor') ||
    g.includes('terms') || g.includes('fee') || g.includes('penalty') ||
    g.includes('valuation') || g.includes('tax')
  ) return 'risk_architect'
  if (
    g.includes('market') || g.includes('competitive') || g.includes('landscape') ||
    g.includes('demand') || g.includes('industry') || g.includes('precedent')
  ) return 'pattern_analyst'
  return null
}

function buildExaminerContextForPersona(
  personaKey: string,
  responses: Array<{ question_text: string; response_text: string | null; gap: string }>
): string | undefined {
  const relevant = responses.filter(r => mapGapToPersona(r.gap) === personaKey && r.response_text?.trim())
  if (relevant.length === 0) return undefined
  const lines = relevant.map(r => `Q: ${r.question_text}\nA: ${r.response_text}`).join('\n\n')
  return `The Examiner gathered additional information from the decision-maker after your initial analysis. Review these answers and update your position if the new information changes your assessment:\n\n${lines}\n\nProvide a concise update (under 200 words). If the new information significantly changes your view, say so directly. If it confirms your original analysis, say that — and why.`
}

export default function SessionView({ session: initialSession, initialMessages = {}, totalSessionCount }: Props) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)

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

  const [registerMode,   setRegisterMode]   = useState<RegisterMode>(
    (initialSession.register_mode ?? 'analytical') as RegisterMode
  )
  const [reRegisterMode, setReRegisterMode] = useState<RegisterMode>(
    (initialSession.register_mode ?? 'analytical') as RegisterMode
  )

  const [session,    setSession]    = useState<Session>(initialSession)
  const [sessionKey, setSessionKey] = useState(0)
  const [completedResponses, setCompletedResponses] = useState<Record<string, string>>(initialMessages)
  const [decisionExpanded, setDecisionExpanded] = useState(false)
  const [contextExpanded,  setContextExpanded]  = useState(false)

  // Synthesis gate state
  const [examinerReady,            setExaminerReady]            = useState(false)
  const [synthesisVersion,         setSynthesisVersion]         = useState(0)
  const [examinerContextByPersona, setExaminerContextByPersona] = useState<Record<string, string>>({})

  // New flow: personas fire AFTER examiner, not before.
  const [examinerSubmitted,      setExaminerSubmitted]      = useState(false)
  const [examinerInitialContext, setExaminerInitialContext] = useState<Record<string, string>>({})
  const [synthExaminerContext,   setSynthExaminerContext]   = useState<string | undefined>(undefined)

  // Sprint 11b: rule engine state
  const [ruleMode,          setRuleMode]          = useState<RuleMode>(null)
  const [redirectBlocked,   setRedirectBlocked]   = useState(false)
  const [redirectQuestion,  setRedirectQuestion]  = useState<string | undefined>(undefined)
  const [examinerDismissed, setExaminerDismissed] = useState(false)

  // Sprint 5: structural context
  const [structuralContext, setStructuralContext] = useState<string | null>(null)

  // Council status bar state
  const [ontologyReady,      setOntologyReady]      = useState(false)
  const [synthesisStreaming,  setSynthesisStreaming]  = useState(false)
  const [synthesisDone,       setSynthesisDone]       = useState(false)

  // Dynamic grid order
  const [orderedPersonaKeys, setOrderedPersonaKeys] = useState<PersonaKey[]>([...PERSONA_ORDER])
  const [gridReordered,      setGridReordered]      = useState(false)
  const [labelText,          setLabelText]          = useState('')
  const pendingOrderRef      = useRef<PersonaKey[] | null>(null)
  const allPersonasDoneRef   = useRef(false)
  const examinerSubmittedRef = useRef(false)
  const styleCueRef          = useRef<string | null>(null)

  // ── FLIP animation refs ──────────────────────────────────────────────────
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const snapRef  = useRef<Record<string, DOMRect>>({})

  // FLIP — Play step
  useLayoutEffect(() => {
    const snap = snapRef.current
    if (Object.keys(snap).length === 0) return

    const DURATION = 1100
    const EASING   = 'cubic-bezier(0.4, 0, 0.2, 1)'

    for (const [key, el] of Object.entries(cardRefs.current)) {
      if (!el || !snap[key]) continue
      const newRect = el.getBoundingClientRect()
      const oldRect = snap[key]
      const dx = oldRect.left - newRect.left
      const dy = oldRect.top  - newRect.top
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue

      el.style.transition = 'none'
      el.style.transform  = `translate(${dx}px, ${dy}px)`

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          el.style.transition = `transform ${DURATION}ms ${EASING}`
          el.style.transform  = ''
        })
      })
    }

    const cleanup = setTimeout(() => {
      for (const el of Object.values(cardRefs.current)) {
        if (el) { el.style.transition = ''; el.style.transform = '' }
      }
    }, DURATION + 60)

    snapRef.current = {}
    return () => clearTimeout(cleanup)
  }, [orderedPersonaKeys])

  const applyOrderWithFlip = useCallback((newOrder: PersonaKey[]) => {
    const snap: Record<string, DOMRect> = {}
    for (const [key, el] of Object.entries(cardRefs.current)) {
      if (el) snap[key] = el.getBoundingClientRect()
    }
    snapRef.current = snap
    setOrderedPersonaKeys(newOrder)
    setGridReordered(true)
  }, [])

  const LABEL_FULL = 'Ranked by relevance to your decision \u2192'
  useEffect(() => {
    if (!gridReordered) return
    let i = 0
    setLabelText('')
    const iv = setInterval(() => {
      i++
      setLabelText(LABEL_FULL.slice(0, i))
      if (i >= LABEL_FULL.length) clearInterval(iv)
    }, 32)
    return () => clearInterval(iv)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gridReordered])

  useEffect(() => {
    async function fetchStyleCue() {
      try {
        const supabase = createClient()
        const { data: { session: authSession } } = await supabase.auth.getSession()
        if (!authSession?.access_token) return
        const res = await fetch('/api/mirror/preferences', {
          headers: { Authorization: `Bearer ${authSession.access_token}` },
        })
        if (!res.ok) return
        const { style_cue } = await res.json()
        if (style_cue) styleCueRef.current = style_cue
      } catch {
        // Non-critical
      }
    }
    fetchStyleCue()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    let attempt = 0
    const MAX_ATTEMPTS = 4
    const RETRY_MS     = 6000

    const fetchStructuralContext = () => {
      fetch('/api/structural-match', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ sessionId: initialSession.id }),
      })
        .then(r => r.json())
        .then(data => {
          if (data.ontology_ready && !pendingOrderRef.current) {
            setOntologyReady(true)
            const ordered = computePersonaOrder(
              data.rule_engine_result ?? null,
              data.ontology_vector    ?? null,
              styleCueRef.current,
            )
            pendingOrderRef.current = ordered as PersonaKey[]
            if (allPersonasDoneRef.current && examinerSubmittedRef.current) {
              const isDifferent = ordered.some((k: string, i: number) => k !== PERSONA_ORDER[i])
              if (isDifferent) {
                applyOrderWithFlip(ordered as PersonaKey[])
              }
              pendingOrderRef.current = null
            }
          }
          if (data.threshold_met && data.context_block) {
            setStructuralContext(data.context_block)
            return
          }
          if (!data.ontology_ready && attempt < MAX_ATTEMPTS) {
            attempt++
            setTimeout(fetchStructuralContext, RETRY_MS)
          }
        })
        .catch(err => console.error('[SessionView] Structural match fetch failed:', err))
    }

    fetchStructuralContext()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSession.id])

  const handlePersonaComplete = useCallback((personaKey: string, content: string) => {
    setCompletedResponses(prev => {
      const isUpdate = personaKey in prev
      if (isUpdate) setSynthesisVersion(v => v + 1)
      const next = { ...prev, [personaKey]: content }

      if (!isUpdate && Object.keys(next).length >= PERSONA_ORDER.length) {
        allPersonasDoneRef.current = true
        const pending = pendingOrderRef.current
        if (pending && examinerSubmittedRef.current) {
          const isDifferent = pending.some((k, i) => k !== PERSONA_ORDER[i])
          if (isDifferent) {
            setTimeout(() => {
              applyOrderWithFlip(pending as PersonaKey[])
              pendingOrderRef.current = null
            }, 0)
          } else {
            pendingOrderRef.current = null
          }
        }
      }
      return next
    })
  }, [])

  const allPersonasDone = Object.keys(completedResponses).length >= PERSONA_ORDER.length

  const handleExaminerComplete = useCallback(
    (
      responses:       Array<{ question_text: string; response_text: string | null; gap: string }>,
      mode:            RuleMode,
      redirectQuestion?: string
    ) => {
      setRuleMode(mode)

      if (mode === 'REDIRECT') {
        setRedirectBlocked(true)
        if (redirectQuestion) setRedirectQuestion(redirectQuestion)
        setExaminerReady(false)
        setExaminerSubmitted(true)
        examinerSubmittedRef.current = true
        return
      }

      examinerSubmittedRef.current = true
      setExaminerSubmitted(true)
      setExaminerReady(true)

      const pending = pendingOrderRef.current
      if (pending && allPersonasDoneRef.current) {
        const isDifferent = pending.some((k, i) => k !== PERSONA_ORDER[i])
        if (isDifferent) {
          setTimeout(() => {
            applyOrderWithFlip(pending as PersonaKey[])
            pendingOrderRef.current = null
          }, 0)
        } else {
          pendingOrderRef.current = null
        }
      }

      if (!responses.length) return

      const allAnswered = responses.filter(r => r.response_text?.trim())
      if (allAnswered.length > 0) {
        setSynthExaminerContext(
          allAnswered.map(r => `Q: ${r.question_text}\nA: ${r.response_text}`).join('\n\n')
        )
      }

      const c0Responses = responses.filter(r => r.gap === 'C0 — CONTEXT' && r.response_text?.trim())
      const c0Block = c0Responses.length > 0
        ? `USER STATED INTENT:\nQ: ${c0Responses[0].question_text}\nA: ${c0Responses[0].response_text}\n\n`
        : ''

      const initialCtx: Record<string, string> = {}
      for (const pk of PERSONA_ORDER) {
        const ruleAnswers = responses.filter(r =>
          r.gap !== 'C0 — CONTEXT' &&
          mapGapToPersona(r.gap) === pk &&
          r.response_text?.trim()
        )
        const ruleBlock = ruleAnswers.length > 0
          ? `ADDITIONAL CONTEXT FROM EXAMINER:\n${ruleAnswers.map(r => `Q: ${r.question_text}\nA: ${r.response_text}`).join('\n\n')}`
          : ''
        const combined = (c0Block + ruleBlock).trim()
        if (combined) initialCtx[pk] = combined
      }
      if (c0Block.trim() && Object.keys(initialCtx).length < PERSONA_ORDER.length) {
        for (const pk of PERSONA_ORDER) {
          if (!initialCtx[pk]) initialCtx[pk] = c0Block.trim()
        }
      }
      if (Object.keys(initialCtx).length > 0) {
        setExaminerInitialContext(initialCtx)
      }
    },
    []
  )

  const shareContextPendingRef = useRef<Set<string>>(new Set())

  const handleExaminerUpdateComplete = useCallback((personaKey: string) => {
    if (!shareContextPendingRef.current.has(personaKey)) return
    shareContextPendingRef.current.delete(personaKey)
    if (shareContextPendingRef.current.size === 0) {
      setSynthesisVersion(v => v + 1)
    }
  }, [])

  const handleShareContext = useCallback((originPersonaKey: string, text: string) => {
    const examinerMsg = `The user submitted the following new information while challenging another advisor. Review it and update your position if it changes your assessment:\n\n"${text}"\n\nProvide a concise update (under 200 words). If this materially changes your view, say so directly. If it confirms your original analysis, say that — and why.`
    const pendingKeys = PERSONA_ORDER.filter(k => k !== originPersonaKey)
    shareContextPendingRef.current = new Set(pendingKeys)
    setExaminerContextByPersona(prev => {
      const next = { ...prev }
      for (const key of pendingKeys) {
        next[key] = examinerMsg
      }
      return next
    })
  }, [])

  const handleOverrideRedirect = useCallback(async () => {
    fetch('/api/ontology', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ sessionId: session.id }),
    }).catch(() => {})

    setRedirectBlocked(false)
    setRuleMode(null)
    setExaminerReady(true)
    setExaminerDismissed(true)
    examinerSubmittedRef.current = true
    setExaminerSubmitted(true)
    const pending = pendingOrderRef.current
    if (pending && allPersonasDoneRef.current) {
      const isDifferent = pending.some((k, i) => k !== PERSONA_ORDER[i])
      if (isDifferent) {
        setTimeout(() => { applyOrderWithFlip(pending as PersonaKey[]); pendingOrderRef.current = null }, 0)
      } else {
        pendingOrderRef.current = null
      }
    }
  }, [session.id])

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
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ sessionId: session.id }),
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
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          decision_text: reDecision.trim(),
          context_text:  reContext.trim() || null,
          register_mode: reRegisterMode,
          user_id:       session.user_id   ?? null,
          device_id:     getOrCreateDeviceId(),
        }),
      })
      if (!res.ok) throw new Error()
      const { id }         = await res.json()
      const sessionRes     = await fetch(`/api/session?id=${id}`)
      if (!sessionRes.ok) throw new Error()
      const newSession: Session = await sessionRes.json()
      setSession(newSession)
      setSessionKey(k => k + 1)
      setCompletedResponses({})
      setExaminerReady(false)
      setExaminerContextByPersona({})
      setExaminerSubmitted(false)
      setExaminerInitialContext({})
      setSynthExaminerContext(undefined)
      setRegisterMode(reRegisterMode)
      setSynthesisVersion(0)
      setSaved(false)
      setDrawerOpen(false)
      setReanalyzing(false)
      setRuleMode(null)
      setRedirectBlocked(false)
      setRedirectQuestion(undefined)
      setExaminerDismissed(false)
      setOrderedPersonaKeys([...PERSONA_ORDER])
      setGridReordered(false)
      setLabelText('')
      allPersonasDoneRef.current = false
      pendingOrderRef.current = null
      examinerSubmittedRef.current = false
      setOntologyReady(false)
      setSynthesisStreaming(false)
      setSynthesisDone(false)
      window.history.replaceState(null, '', `/session/${id}`)
    } catch {
      setReanalyzeError('Something went wrong. Please try again.')
      setReanalyzing(false)
    }
  }, [reDecision, reContext, reRegisterMode])

  // ── Scroll state for navbar shadow ───────────────────────────────────────
  const [navScrolled, setNavScrolled] = useState(false)
  useEffect(() => {
    const onScroll = () => setNavScrolled(window.scrollY > 32)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <>
      {/* ── Entrance animation keyframes (CSS-only, no logic) ── */}
      <style>{`
        @keyframes sessionFadeIn {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .sv-fade { animation: sessionFadeIn 400ms ease-out both; }
        .sv-fade-1 { animation-delay: 0ms; }
        .sv-fade-2 { animation-delay: 120ms; }
        .sv-fade-3 { animation-delay: 240ms; }
        .sv-fade-4 { animation-delay: 360ms; }

        /* Drawer slide-up */
        @keyframes drawerSlideUp {
          from { transform: translateY(100%); opacity: 0; }
          to   { transform: translateY(0);    opacity: 1; }
        }
        .sv-drawer { animation: drawerSlideUp 280ms cubic-bezier(0.32, 0.72, 0, 1) both; }

        /* Session navbar */
        .sv-navbar {
          position: fixed;
          top: 0; left: 0; right: 0;
          z-index: 8500;
          display: flex;
          align-items: center;
          height: 56px;
          padding: 0 20px;
          background: var(--bg-card);
          border-bottom: 1px solid var(--border-mid);
          transition: box-shadow 0.3s ease, border-color 0.3s ease;
          gap: 16px;
        }
        .sv-navbar.scrolled {
          box-shadow: 0 2px 20px rgba(0,0,0,0.35);
          border-bottom-color: var(--border-mid);
        }
        [data-theme="light"] .sv-navbar.scrolled {
          box-shadow: 0 2px 12px rgba(6,13,28,0.10);
        }
        .sv-navbar-wordmark {
          flex-shrink: 0;
          font-family: var(--font-mono);
          font-size: 13px;
          font-weight: 600;
          letter-spacing: 0.22em;
          text-transform: uppercase;
          color: var(--gold);
          text-decoration: none;
        }
        .sv-navbar-divider {
          width: 1px;
          height: 18px;
          background: var(--border-dim);
          flex-shrink: 0;
        }
        .sv-navbar-decision {
          flex: 1;
          min-width: 0;
          font-size: 12px;
          color: var(--text-3);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          font-family: var(--font-body);
          letter-spacing: -0.005em;
        }
        .sv-navbar-badge {
          flex-shrink: 0;
          font-size: 10px;
          font-family: var(--font-mono);
          letter-spacing: 0.09em;
          text-transform: uppercase;
          color: var(--text-4);
          padding: 3px 9px;
          border-radius: 20px;
          background: var(--bg-inset);
          border: 1px solid var(--border-dim);
          white-space: nowrap;
        }
        .sv-navbar-actions {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-shrink: 0;
          /* Clear ThemeToggle on the right — it's at right: 20px, ~120px wide */
          margin-right: 116px;
        }
        .sv-save-short { display: none; }
        .sv-save-full  { display: inline; }

        @media (max-width: 600px) {
          .sv-navbar            { padding: 0 10px; }
          .sv-navbar-decision   { display: none; }
          .sv-navbar-divider    { display: none; }
          .sv-navbar-badge      { display: none; }
          .sv-navbar-reanalyze  { display: none; }
          .sv-navbar-actions    { margin-right: 100px; gap: 0; }
          .sv-save-short        { display: inline; }
          .sv-save-full         { display: none; }
        }

        /* Decision hero card */
        .sv-hero {
          background: var(--bg-card);
          border: 1px solid var(--border-mid);
          border-radius: 18px;
          box-shadow: var(--shadow-card);
          padding: 24px 28px 20px;
          position: relative;
          overflow: hidden;
        }
        .sv-hero::before {
          content: '';
          position: absolute;
          top: 0; left: 0; right: 0;
          height: 1px;
          background: linear-gradient(90deg, transparent, var(--gold-dim), transparent);
          pointer-events: none;
        }
        @media (max-width: 600px) {
          .sv-hero { padding: 18px 16px 16px; }
        }
        .sv-hero-decision {
          font-family: var(--font-display);
          font-size: clamp(17px, 2.2vw, 22px);
          font-weight: 500;
          line-height: 1.45;
          letter-spacing: -0.015em;
          color: var(--text-1);
        }
        .sv-hero-context {
          font-size: 12.5px;
          line-height: 1.65;
          color: var(--text-3);
        }

        /* Bottom action tray */
        .sv-tray {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          flex-wrap: wrap;
        }
        .sv-tray-left { display: flex; gap: 8px; flex-wrap: wrap; }
        @media (max-width: 480px) {
          .sv-tray { flex-direction: column; align-items: stretch; }
          .sv-tray-left { justify-content: stretch; }
          .sv-tray-left .btn-ghost { flex: 1; justify-content: center; }
        }

        /* Register mode option buttons (reanalyze drawer) */
        .sv-mode-btn {
          padding: 11px 14px;
          border-radius: 10px;
          text-align: left;
          cursor: pointer;
          font-family: var(--font-body);
          transition: border-color 0.15s, background 0.15s;
          border: 1px solid var(--border-dim);
          background: transparent;
        }
        .sv-mode-btn.active-analytical {
          border-color: var(--gold);
          background: var(--gold-glow);
        }
        .sv-mode-btn.active-clarification {
          border-color: var(--green-text);
          background: rgba(74,222,128,0.07);
        }
        [data-theme="light"] .sv-mode-btn.active-clarification {
          background: var(--green-soft);
        }
      `}</style>

      <div style={{ minHeight: '100vh', background: 'var(--bg-void)' }}>

        {/* ── Fixed Session Navbar ──────────────────────────────────── */}
        <nav className={`sv-navbar${navScrolled ? ' scrolled' : ''}`}>
          <button className="sv-navbar-wordmark" onClick={handleNewDecision} style={{background:'none',border:'none',cursor:'pointer',padding:0}}>Quorum</button>
          <div className="sv-navbar-divider" />
          <span className="sv-navbar-decision">{session.decision_text}</span>
          <span className="sv-navbar-badge">Session active</span>
          <div className="sv-navbar-actions">
            <div className="sv-navbar-reanalyze" style={{display:'flex'}}>
            <button
              className="btn-ghost"
              style={{ fontSize: 12, padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 6 }}
              onClick={() => { setReDecision(session.decision_text); setReContext(session.context_text ?? ''); setDrawerOpen(true) }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="1 4 1 10 7 10"/><polyline points="23 20 23 14 17 14"/>
                <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/>
              </svg>
              <span className="nav-tagline" style={{ display: 'inline', margin: 0, fontSize: 12, letterSpacing: '0.04em', textTransform: 'none', color: 'inherit' }}>Reanalyze</span>
            </button>
            </div>
            <button
              className="btn-primary"
              style={{ fontSize: 12, padding: '9px 16px' }}
              onClick={handleSaveRecord}
              disabled={saving}
            >
              {saving ? 'Saving…' : <><span className="sv-save-full">Save Record</span><span className="sv-save-short">Save</span></>}
            </button>
          </div>
        </nav>

        {/* ── Main content — padded below fixed navbar ──────────────── */}
        <div style={{ paddingTop: 72, paddingBottom: 60, paddingLeft: 16, paddingRight: 16 }}>
          <div style={{ maxWidth: '80rem', margin: '0 auto' }}>

            {/* ── Decision Hero Card ────────────────────────────────── */}
            <div className="sv-hero sv-fade sv-fade-1" style={{ marginBottom: 20 }}>
              {/* Section label */}
              <p style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                color: 'var(--text-4)',
                marginBottom: 10,
              }}>
                The Decision
              </p>

              {/* Decision text — display serif, prominent */}
              <p
                className="sv-hero-decision"
                style={decisionExpanded ? {} : {
                  display: '-webkit-box',
                  WebkitLineClamp: 4,
                  WebkitBoxOrient: 'vertical' as const,
                  overflow: 'hidden',
                }}
              >
                {session.decision_text}
              </p>
              {session.decision_text.length > 220 && (
                <button
                  onClick={() => setDecisionExpanded(v => !v)}
                  style={{
                    marginTop: 6,
                    fontSize: 11,
                    color: 'var(--text-4)',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    padding: 0,
                    fontFamily: 'var(--font-mono)',
                    letterSpacing: '0.05em',
                  }}
                >
                  {decisionExpanded ? '↑ Show less' : '↓ Show more'}
                </button>
              )}

              {/* Context — below gold divider */}
              {session.context_text && (
                <>
                  <div className="gold-rule" style={{ margin: '14px 0' }} />
                  <p
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 9.5,
                      letterSpacing: '0.13em',
                      textTransform: 'uppercase',
                      color: 'var(--text-4)',
                      marginBottom: 6,
                    }}
                  >
                    Context
                  </p>
                  <p
                    className="sv-hero-context"
                    style={contextExpanded ? {} : {
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical' as const,
                      overflow: 'hidden',
                    }}
                  >
                    {session.context_text}
                  </p>
                  {session.context_text.length > 120 && (
                    <button
                      onClick={() => setContextExpanded(v => !v)}
                      style={{
                        marginTop: 4,
                        fontSize: 11,
                        color: 'var(--text-4)',
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        padding: 0,
                        fontFamily: 'var(--font-mono)',
                        letterSpacing: '0.05em',
                      }}
                    >
                      {contextExpanded ? '↑ Show less' : '↓ Show more'}
                    </button>
                  )}
                </>
              )}

              {/* Privacy notice — footer inside hero card */}
              <p style={{
                marginTop: 14,
                paddingTop: 12,
                borderTop: '1px solid var(--border-dim)',
                fontSize: 11,
                color: 'var(--text-4)',
                fontFamily: 'var(--font-mono)',
                letterSpacing: '0.04em',
              }}>
                {session.user_id
                  ? 'Linked to your account · included in decision memory'
                  : 'Private by URL · no account or identity linked'
                }
              </p>
            </div>

            <TTSProvider>
              {/* ── Council Status Bar ── */}
              <div className="sv-fade sv-fade-1">
                <CouncilStatusBar
                  key={`statusbar-${sessionKey}`}
                  personasComplete={Object.keys(completedResponses).length}
                  totalPersonas={PERSONA_ORDER.length}
                  ontologyReady={ontologyReady}
                  examinerActive={ontologyReady && !examinerReady && !redirectBlocked}
                  examinerDone={examinerReady || (redirectBlocked && examinerSubmitted)}
                  synthesisStreaming={synthesisStreaming}
                  synthesisDone={synthesisDone}
                />
              </div>

              {/* ── 1. Council Synthesis ── */}
              <div className="sv-fade sv-fade-2">
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
                  redirectBlocked={redirectBlocked}
                  redirectQuestion={redirectQuestion}
                  onOverrideRedirect={handleOverrideRedirect}
                  onSynthesisStart={() => setSynthesisStreaming(true)}
                  onSynthesisComplete={() => { setSynthesisStreaming(false); setSynthesisDone(true) }}
                  examinerContext={synthExaminerContext}
                />
              </div>

              {/* ── 1b. Record Receipt (appears after synthesis completes) ── */}
              {synthesisDone && (
                <div className="sv-fade sv-fade-2" style={{ marginTop: 0 }}>
                  <RecordReceipt
                    sessionCount={totalSessionCount ?? getStoredSessionIds().length}
                    decisionType={session.decision_type_primary ?? undefined}
                    irreversibility={(() => {
                      const s = (session.stakes_reversibility ?? '').toLowerCase()
                      if (s.includes('high') || s.includes('irrevers')) return 'high'
                      if (s.includes('medium') || s.includes('partial')) return 'medium'
                      if (s.includes('low') || s.includes('revers')) return 'low'
                      return undefined
                    })()}
                    mirrorActive={false}
                  />
                </div>
              )}

              {/* ── 2. Examiner ── */}
              <div className="sv-fade sv-fade-2">
                <ExaminerPanel
                  key={`examiner-${sessionKey}`}
                  sessionId={session.id}
                  visible={true}
                  onComplete={handleExaminerComplete}
                  forceDismissed={examinerDismissed}
                />
              </div>

              {/* ── 3. Relevance label ── */}
              {gridReordered && !redirectBlocked && (
                <div style={{ display: 'flex', justifyContent: 'center', margin: '16px 0 12px' }}>
                  <span className="relevance-label">
                    {labelText}
                    {labelText.length < LABEL_FULL.length && (
                      <span style={{ opacity: 1, animation: 'blink 0.7s step-end infinite', marginLeft: 1 }}>|</span>
                    )}
                  </span>
                </div>
              )}

              {/* ── 4. Six persona panels ── */}
              <div
                className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 sv-fade sv-fade-3"
                style={{
                  paddingTop:    12,
                  opacity:       redirectBlocked ? 0.55 : 1,
                  pointerEvents: redirectBlocked ? 'none' : 'auto',
                }}
              >
                {orderedPersonaKeys.map((key) => (
                  <div
                    key={`${key}-${sessionKey}`}
                    ref={el => { cardRefs.current[key] = el }}
                    style={{ willChange: 'transform' }}
                  >
                    <PersonaPanel
                      persona={PERSONAS[key]}
                      sessionId={session.id}
                      decisionText={session.decision_text}
                      contextText={session.context_text ?? undefined}
                      registerMode={registerMode}
                      onComplete={handlePersonaComplete}
                      examinerContext={examinerContextByPersona[key]}
                      structuralContext={structuralContext ?? undefined}
                      onShareContext={(text) => handleShareContext(key, text)}
                      onExaminerUpdateComplete={handleExaminerUpdateComplete}
                      initialContent={initialMessages[key]}
                      canStream={examinerSubmitted || !!initialMessages[key]}
                      initialExaminerContext={examinerInitialContext[key]}
                    />
                  </div>
                ))}
              </div>
            </TTSProvider>

            {/* ── Bottom Action Tray ── */}
            <div className="sv-fade sv-fade-4" style={{ marginTop: 44 }}>
              <div className="gold-rule" style={{ marginBottom: 20 }} />
              <div className="sv-tray">
                <div className="sv-tray-left">
                  <button
                    className="btn-ghost"
                    style={{ fontSize: 13, padding: '11px 18px', display: 'flex', alignItems: 'center', gap: 7, minHeight: 44 }}
                    onClick={handleNewDecision}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                      <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                    </svg>
                    New Decision
                  </button>
                  <button
                    className="btn-ghost"
                    style={{ fontSize: 13, padding: '11px 18px', display: 'flex', alignItems: 'center', gap: 7, minHeight: 44 }}
                    onClick={() => { setReDecision(session.decision_text); setReContext(session.context_text ?? ''); setDrawerOpen(true) }}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="1 4 1 10 7 10"/><polyline points="23 20 23 14 17 14"/>
                      <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/>
                    </svg>
                    Reanalyze
                  </button>
                </div>
                <button
                  className="btn-primary"
                  style={{ fontSize: 13, padding: '12px 28px', minHeight: 44 }}
                  onClick={handleSaveRecord}
                  disabled={saving}
                >
                  {saving ? 'Saving…' : 'Save to Record'}
                </button>
              </div>
            </div>

          </div>
        </div>

        {/* ── Reanalyze Drawer ── */}
        {drawerOpen && (
          <>
            <div
              onClick={() => setDrawerOpen(false)}
              style={{
                position: 'fixed', inset: 0,
                background: 'rgba(2,4,10,0.72)',
                zIndex: 9100,
                backdropFilter: 'blur(2px)',
                WebkitBackdropFilter: 'blur(2px)',
              }}
            />
            <div
              className="sv-drawer"
              style={{
                position: 'fixed', bottom: 0, left: 0, right: 0,
                zIndex: 9200,
                background: 'var(--bg-card)',
                border: '1px solid var(--border-mid)',
                borderBottom: 'none',
                borderRadius: '18px 18px 0 0',
                padding: '28px 28px 44px',
                maxWidth: 760,
                margin: '0 auto',
                boxShadow: '0 -8px 40px rgba(0,0,0,0.4)',
              }}
            >
              {/* Drag handle */}
              <div style={{
                width: 36, height: 4, borderRadius: 2,
                background: 'var(--border-mid)',
                margin: '0 auto 24px',
              }} />

              {/* Header */}
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 22, gap: 12 }}>
                <div>
                  <h2 style={{
                    fontFamily: 'var(--font-display)',
                    fontSize: 20,
                    fontWeight: 500,
                    color: 'var(--text-1)',
                    margin: 0,
                    letterSpacing: '-0.015em',
                  }}>
                    Reanalyze
                  </h2>
                  <p style={{ fontSize: 12, color: 'var(--text-4)', marginTop: 4, fontStyle: 'italic' }}>
                    Edit the decision or add new context — all six advisors re-run
                  </p>
                </div>
                <button
                  className="btn-ghost"
                  style={{ padding: '6px 12px', fontSize: 12, flexShrink: 0, minHeight: 36 }}
                  onClick={() => setDrawerOpen(false)}
                >
                  ✕ Close
                </button>
              </div>

              {/* Decision textarea */}
              <label style={{
                display: 'block',
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                letterSpacing: '0.13em',
                textTransform: 'uppercase',
                color: 'var(--text-4)',
                marginBottom: 7,
              }}>
                Decision
              </label>
              <textarea
                rows={5}
                value={reDecision}
                onChange={(e) => setReDecision(e.target.value)}
                style={{ fontSize: 13.5, marginBottom: 16 }}
                placeholder="Describe your decision…"
              />

              {/* Context textarea */}
              <label style={{
                display: 'block',
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                letterSpacing: '0.13em',
                textTransform: 'uppercase',
                color: 'var(--text-4)',
                marginBottom: 7,
              }}>
                Additional context{' '}
                <span style={{ color: 'var(--text-4)', textTransform: 'none', letterSpacing: '0.02em', opacity: 0.7 }}>(optional)</span>
              </label>
              <textarea
                rows={3}
                value={reContext}
                onChange={(e) => setReContext(e.target.value)}
                style={{ fontSize: 13, marginBottom: 20 }}
                placeholder="Add new information that has emerged…"
              />

              {/* Register mode */}
              <label style={{
                display: 'block',
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                letterSpacing: '0.13em',
                textTransform: 'uppercase',
                color: 'var(--text-4)',
                marginBottom: 10,
              }}>
                What are you looking for this time?
              </label>
              <div className="home-two-col" style={{ gap: 8, marginBottom: 20 }}>
                {([
                  { value: 'analytical',    icon: '⚔',  label: 'Challenge my thinking',        sub: 'Stress-test the decision' },
                  { value: 'clarification', icon: '🪞', label: 'Help me understand what I want', sub: 'Values and identity' },
                ] as const).map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setReRegisterMode(opt.value)}
                    className={`sv-mode-btn${reRegisterMode === opt.value ? ` active-${opt.value}` : ''}`}
                    style={{ minHeight: 44 }}
                  >
                    <p style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: reRegisterMode === opt.value
                        ? (opt.value === 'analytical' ? 'var(--gold)' : 'var(--green-text)')
                        : 'var(--text-2)',
                      marginBottom: 3,
                    }}>
                      {opt.icon} {opt.label}
                    </p>
                    <p style={{ fontSize: 11, color: 'var(--text-4)', fontStyle: 'italic' }}>{opt.sub}</p>
                  </button>
                ))}
              </div>

              {reanalyzeError && (
                <p style={{ fontSize: 12, color: 'var(--error)', marginBottom: 12 }}>
                  {reanalyzeError}
                </p>
              )}

              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  className="btn-primary"
                  style={{ flex: 1, fontSize: 14, padding: '13px', minHeight: 48 }}
                  onClick={handleReanalyze}
                  disabled={reanalyzing || !reDecision.trim()}
                >
                  {reanalyzing ? 'Convening new Council…' : 'Convene New Council'}
                </button>
                <button
                  className="btn-ghost"
                  style={{ padding: '13px 20px', fontSize: 13, minHeight: 48 }}
                  onClick={() => setDrawerOpen(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  )
}
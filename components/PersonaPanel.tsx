'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import type { PersonaMeta, Message } from '@/lib/types'

const ICONS: Record<string, React.ReactNode> = {
  contrarian: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
    </svg>
  ),
  risk_architect: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
    </svg>
  ),
  pattern_analyst: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
    </svg>
  ),
  stakeholder_mirror: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
      <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>
    </svg>
  ),
  elder: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 22h14M5 2h14M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"/>
    </svg>
  ),
  competitor: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5"/>
      <line x1="13" y1="19" x2="19" y2="13"/>
      <line x1="16" y1="16" x2="20" y2="20"/>
      <line x1="19" y1="21" x2="21" y2="19"/>
    </svg>
  ),
}

const ACCENT_COLORS: Record<string, string> = {
  contrarian:        '#7c2020',
  risk_architect:    '#1e3a6e',
  pattern_analyst:   '#1a4a36',
  stakeholder_mirror:'#4a2070',
  elder:             '#5c3a10',
  competitor:        '#3a2a10',
}

interface Props {
  persona: PersonaMeta
  sessionId: string
  decisionText: string
  contextText?: string
  onComplete?: (personaKey: string, content: string) => void
}

type PanelState = 'idle' | 'streaming' | 'done' | 'error'

export default function PersonaPanel({ persona, sessionId, decisionText, contextText, onComplete }: Props) {
  const [response, setResponse]           = useState('')
  const [panelState, setPanelState]       = useState<PanelState>('idle')
  const [messages, setMessages]           = useState<Message[]>([])
  const [pushback, setPushback]           = useState('')
  const [showPushback, setShowPushback]   = useState(false)
  const [isPushingBack, setIsPushingBack] = useState(false)
  const [exchanges, setExchanges]         = useState<{ user: string; reply: string }[]>([])

  // Keep a ref to the latest initial response for building full content on pushback
  const responseRef = useRef('')

  const accentColor = ACCENT_COLORS[persona.key] ?? '#1c2b4a'
  const icon = ICONS[persona.key]

  const buildFullContent = (initialResp: string, exs: { user: string; reply: string }[]) => {
    if (exs.length === 0) return initialResp
    const exchangeText = exs
      .map(e => `[After pushback: "${e.user}"]\n${e.reply}`)
      .join('\n\n')
    return `${initialResp}\n\n${exchangeText}`
  }

  const streamResponse = useCallback(async (msgs: Message[], isFirst: boolean) => {
    setPanelState('streaming')
    if (isFirst) setResponse('')

    try {
      const res = await fetch('/api/persona', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, personaKey: persona.key, messages: msgs, decisionText, contextText }),
      })
      if (!res.ok || !res.body) { setPanelState('error'); setResponse('Failed to load. Check API key.'); return }

      const reader  = res.body.getReader()
      const decoder = new TextDecoder()
      let acc = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        acc += decoder.decode(value, { stream: true })
        if (isFirst) setResponse(acc)
      }

      if (isFirst) {
        responseRef.current = acc
        onComplete?.(persona.key, acc)
      } else {
        // Pushback completed — build full content and notify parent for synthesis recalibration
        const newExchanges = [...exchanges, { user: msgs[msgs.length - 1].content, reply: acc }]
        setExchanges(newExchanges)
        setIsPushingBack(false)
        const fullContent = buildFullContent(responseRef.current, newExchanges)
        onComplete?.(persona.key, fullContent)
      }
      setPanelState('done')
    } catch {
      setPanelState('error')
      setResponse('Connection error.')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, persona.key, decisionText, contextText, onComplete, exchanges])

  useEffect(() => { streamResponse([], true) }, [streamResponse])

  const handlePushback = async () => {
    if (!pushback.trim()) return
    const userMsg: Message = { persona: persona.key, role: 'user', content: pushback.trim() }
    const updated = [...messages, userMsg]
    setMessages(updated)
    setPushback('')
    setShowPushback(false)
    setIsPushingBack(true)
    await streamResponse(updated, false)
  }

  const StatusBadge = () => {
    if (panelState === 'streaming') return (
      <span style={{ fontSize: 11, color: 'var(--gold)', display: 'flex', alignItems: 'center', gap: 5 }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--gold)', display: 'inline-block', animation: 'blink 1s step-end infinite' }} />
        Reading
      </span>
    )
    if (panelState === 'done') return <span style={{ fontSize: 11, color: '#4ade80' }}>✓</span>
    if (panelState === 'error') return <span style={{ fontSize: 11, color: '#e05050' }}>✗ error</span>
    return null
  }

  return (
    <div className={`persona-card ${panelState === 'streaming' ? 'streaming' : panelState === 'done' ? 'done' : ''}`} style={{ minHeight: 280 }}>
      <div style={{ padding: '12px 16px 10px', borderBottom: '1px solid var(--border-dim)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: `${accentColor}55`, borderRadius: '14px 14px 0 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 28, height: 28, borderRadius: 7, background: `${accentColor}99`, border: `1px solid ${accentColor}ff`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--gold)', flexShrink: 0 }}>
            {icon}
          </div>
          <div>
            <p style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-1)', lineHeight: 1.2 }}>{persona.label}</p>
            <p style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.2, marginTop: 1 }}>{persona.tagline}</p>
          </div>
        </div>
        <StatusBadge />
      </div>

      <div style={{ flex: 1, padding: '14px 16px', overflowY: 'auto', maxHeight: 340 }}>
        {response && (
          <p className={`persona-response ${panelState === 'streaming' ? 'cursor' : ''}`}>{response}</p>
        )}
        {exchanges.map((ex, i) => (
          <div key={i} style={{ marginTop: 16 }}>
            <div style={{ borderRadius: 8, padding: '8px 12px', background: 'var(--bg-inset)', border: '1px solid var(--border-dim)', marginBottom: 10 }}>
              <p style={{ fontSize: 11, color: 'var(--text-4)', marginBottom: 3 }}>Your pushback</p>
              <p style={{ fontSize: 12.5, color: 'var(--text-3)', lineHeight: 1.5 }}>{ex.user}</p>
            </div>
            <p className="persona-response">{ex.reply}</p>
          </div>
        ))}
        {isPushingBack && <p style={{ fontSize: 12, color: 'var(--text-4)', marginTop: 14 }}>Responding…</p>}
        {panelState === 'idle' && (
          <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 50 }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--border-mid)', animation: 'blink 1.2s ease-in-out infinite' }} />
          </div>
        )}
      </div>

      {panelState === 'done' && !isPushingBack && (
        <div style={{ padding: '8px 16px 12px', borderTop: '1px solid var(--border-dim)' }}>
          {!showPushback ? (
            <button className="btn-pushback" onClick={() => setShowPushback(true)}>↩ Push back</button>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <textarea rows={2} style={{ fontSize: 13, padding: '8px 12px' }} placeholder="Challenge this or add new information…" value={pushback} onChange={(e) => setPushback(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handlePushback() }} />
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn-primary" style={{ padding: '6px 16px', fontSize: 12 }} onClick={handlePushback}>Send</button>
                <button className="btn-ghost" onClick={() => { setShowPushback(false); setPushback('') }}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

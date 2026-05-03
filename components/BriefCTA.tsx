'use client'

// components/BriefCTA.tsx
// Fix: Card wrapper moved OUTSIDE BriefCTA function.
// When defined inside, every keystroke → state change → render → new Card
// function reference → React unmounts/remounts subtree → input loses focus.

import { useState, useRef } from 'react'

interface Props { sessionId: string }
type State = 'teaser' | 'input' | 'validating' | 'invalid' | 'downloading'

// ── Card wrapper — defined at module level, stable reference ──────────────────
const CARD_STYLE: React.CSSProperties = {
  borderRadius: 14,
  padding:      '18px 22px',
  background:   'var(--bg-card)',
  border:       '1px solid rgba(201,168,76,0.2)',
  position:     'relative',
  overflow:     'hidden',
}
const TOP_RULE_STYLE: React.CSSProperties = {
  position:   'absolute',
  top: 0, left: 0,
  width:      '100%',
  height:     2,
  background: 'linear-gradient(90deg, var(--gold-dim) 0%, transparent 70%)',
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div style={CARD_STYLE}>
      <div style={TOP_RULE_STYLE} />
      {children}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

export default function BriefCTA({ sessionId }: Props) {
  const [state,    setState]    = useState<State>('teaser')
  const [token,    setToken]    = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const inputRef                 = useRef<HTMLInputElement>(null)

  const handleSubmit = async () => {
    if (!token.trim()) return
    setState('validating')
    setErrorMsg('')
    try {
      const res  = await fetch('/api/brief-access', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ token: token.trim() }),
      })
      const data = await res.json() as { valid: boolean }
      if (!data.valid) {
        setState('invalid')
        setErrorMsg("That token doesn't match. Check the one shared with you.")
        return
      }
      setState('downloading')
      window.location.href = `/api/record/${sessionId}/brief?token=${encodeURIComponent(token.trim())}`
      setTimeout(() => setState('teaser'), 4000)
    } catch {
      setState('invalid')
      setErrorMsg('Something went wrong. Try again.')
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter')  handleSubmit()
    if (e.key === 'Escape') setState('teaser')
  }

  const reset = () => { setState('teaser'); setToken(''); setErrorMsg('') }

  // ── Teaser ─────────────────────────────────────────────────────────────────
  if (state === 'teaser') {
    return (
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <p style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--gold)', margin: '0 0 4px', letterSpacing: '0.05em' }}>
              Decision Brief
            </p>
            <p style={{ fontSize: 12, color: 'var(--text-4)', margin: 0, lineHeight: 1.55 }}>
              A formatted PDF of this session — all six advisors, the synthesis, and your pushbacks. Ready to share.
            </p>
          </div>
          <button
            onClick={() => { setState('input'); setTimeout(() => inputRef.current?.focus(), 50) }}
            style={{ background: 'rgba(201,168,76,0.12)', border: '1px solid rgba(201,168,76,0.35)', borderRadius: 8, padding: '9px 18px', fontSize: 12, fontWeight: 700, color: 'var(--gold)', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}
          >
            Get Brief →
          </button>
        </div>
      </Card>
    )
  }

  // ── Downloading ────────────────────────────────────────────────────────────
  if (state === 'downloading') {
    return (
      <Card>
        <style>{`@keyframes brief-spin { to { transform: rotate(360deg); } }`}</style>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 16, height: 16, borderRadius: '50%', border: '2px solid rgba(201,168,76,0.2)', borderTopColor: 'var(--gold)', animation: 'brief-spin 0.8s linear infinite', flexShrink: 0 }} />
          <p style={{ fontSize: 12.5, color: 'var(--text-2)', margin: 0 }}>Preparing your Brief — downloading now…</p>
        </div>
      </Card>
    )
  }

  // ── Input / validating / invalid ───────────────────────────────────────────
  const isInvalid = state === 'invalid'
  const isBusy    = state === 'validating'

  return (
    <Card>
      <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-3)', margin: '0 0 10px', letterSpacing: '0.03em' }}>
        Enter your access token
      </p>

      <div style={{ display: 'flex', gap: 8 }}>
        <input
          ref={inputRef}
          type="text"
          value={token}
          onChange={e => { setToken(e.target.value); if (isInvalid) setState('input') }}
          onKeyDown={handleKeyDown}
          placeholder="Paste token here"
          disabled={isBusy}
          autoComplete="off"
          spellCheck={false}
          style={{
            flex: 1, background: 'var(--bg-inset)',
            border: `1px solid ${isInvalid ? 'rgba(220,80,60,0.5)' : 'var(--border-mid)'}`,
            borderRadius: 8, padding: '9px 13px', fontSize: 13,
            color: 'var(--text-1)', outline: 'none', fontFamily: 'monospace',
            letterSpacing: '0.05em',
          }}
        />
        <button
          onClick={handleSubmit}
          disabled={isBusy || !token.trim()}
          style={{ background: 'rgba(201,168,76,0.15)', border: '1px solid rgba(201,168,76,0.3)', borderRadius: 8, padding: '9px 16px', fontSize: 12, fontWeight: 700, color: 'var(--gold)', cursor: isBusy ? 'wait' : 'pointer', whiteSpace: 'nowrap', opacity: isBusy || !token.trim() ? 0.6 : 1 }}
        >
          {isBusy ? 'Checking…' : 'Download PDF'}
        </button>
      </div>

      {isInvalid && errorMsg && (
        <p style={{ fontSize: 11, color: 'rgba(220,80,60,0.9)', margin: '8px 0 0', lineHeight: 1.5 }}>{errorMsg}</p>
      )}

      <button
        onClick={reset}
        style={{ background: 'none', border: 'none', fontSize: 11, color: 'var(--text-4)', cursor: 'pointer', marginTop: 8, padding: 0 }}
      >
        Cancel
      </button>

      <p style={{ fontSize: 10.5, color: 'var(--text-4)', margin: '10px 0 0', lineHeight: 1.5 }}>
        Token shared privately for verified sessions.
      </p>
    </Card>
  )
}

'use client'

// components/BriefCTA.tsx
// ── Sprint 8: Decision Brief CTA ─────────────────────────────────────────────
//
// Shown on the record page below the decision block. Handles the full
// Brief access flow:
//
//   1. Default state: teaser card with "Get your Decision Brief" CTA
//   2. Expanded: token input field (user pastes the token received via WhatsApp)
//   3. Validating: spinner while POST /api/brief-access runs
//   4. Invalid: red error state, input remains
//   5. Valid: auto-triggers PDF download via window.location
//
// Props:
//   sessionId  → used to construct the download URL
//
// Note: The token is validated client-side first via /api/brief-access,
// then passed as a query param to /api/record/[id]/brief which re-validates
// it server-side. Double validation ensures no URL-guessing bypass.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useRef } from 'react'

interface Props {
  sessionId: string
}

type State = 'teaser' | 'input' | 'validating' | 'invalid' | 'downloading'

export default function BriefCTA({ sessionId }: Props) {
  const [state,     setState]     = useState<State>('teaser')
  const [token,     setToken]     = useState('')
  const [errorMsg,  setErrorMsg]  = useState('')
  const inputRef                   = useRef<HTMLInputElement>(null)

  // ── Token validation + download trigger ────────────────────────────────────
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
      const data = await res.json() as { valid: boolean; devMode?: boolean }

      if (!data.valid) {
        setState('invalid')
        setErrorMsg('That token doesn\'t match. Check the one shared with you.')
        return
      }

      // Valid — trigger download
      setState('downloading')
      const url = `/api/record/${sessionId}/brief?token=${encodeURIComponent(token.trim())}`
      window.location.href = url

      // Reset to teaser after a moment (download is handled by browser)
      setTimeout(() => setState('teaser'), 4000)
    } catch {
      setState('invalid')
      setErrorMsg('Something went wrong. Try again.')
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSubmit()
    if (e.key === 'Escape') setState('teaser')
  }

  // ── Shared card wrapper ────────────────────────────────────────────────────
  const Card = ({ children }: { children: React.ReactNode }) => (
    <div style={{
      borderRadius: 14,
      padding:      '18px 22px',
      background:   'var(--bg-card)',
      border:       '1px solid rgba(201,168,76,0.2)',
      position:     'relative',
      overflow:     'hidden',
    }}>
      {/* Gold top rule */}
      <div style={{
        position:   'absolute',
        top: 0, left: 0,
        width:      '100%',
        height:     2,
        background: 'linear-gradient(90deg, var(--gold-dim) 0%, transparent 70%)',
      }} />
      {children}
    </div>
  )

  // ── Teaser state ───────────────────────────────────────────────────────────
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
            onClick={() => {
              setState('input')
              setTimeout(() => inputRef.current?.focus(), 50)
            }}
            style={{
              background:   'rgba(201,168,76,0.12)',
              border:       '1px solid rgba(201,168,76,0.35)',
              borderRadius: 8,
              padding:      '9px 18px',
              fontSize:     12,
              fontWeight:   700,
              color:        'var(--gold)',
              cursor:       'pointer',
              whiteSpace:   'nowrap',
              transition:   'background 0.15s',
              flexShrink:   0,
            }}
            onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.background = 'rgba(201,168,76,0.2)')}
            onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.background = 'rgba(201,168,76,0.12)')}
          >
            Get Brief →
          </button>
        </div>
      </Card>
    )
  }

  // ── Downloading state ──────────────────────────────────────────────────────
  if (state === 'downloading') {
    return (
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 16, height: 16, borderRadius: '50%',
            border: '2px solid rgba(201,168,76,0.2)',
            borderTopColor: 'var(--gold)',
            animation: 'spin 0.8s linear infinite',
            flexShrink: 0,
          }} />
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          <p style={{ fontSize: 12.5, color: 'var(--text-2)', margin: 0 }}>
            Preparing your Brief — downloading now…
          </p>
        </div>
      </Card>
    )
  }

  // ── Input / validating / invalid states ────────────────────────────────────
  return (
    <Card>
      <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-3)', margin: '0 0 10px', letterSpacing: '0.03em' }}>
        Enter your access token
      </p>

      <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
        <input
          ref={inputRef}
          type="text"
          value={token}
          onChange={e => { setToken(e.target.value); if (state === 'invalid') setState('input') }}
          onKeyDown={handleKeyDown}
          placeholder="Paste token here"
          disabled={state === 'validating'}
          style={{
            flex:        1,
            background:  'var(--bg-inset)',
            border:      `1px solid ${state === 'invalid' ? 'rgba(220,80,60,0.5)' : 'var(--border-mid)'}`,
            borderRadius: 8,
            padding:     '9px 13px',
            fontSize:    13,
            color:       'var(--text-1)',
            outline:     'none',
            fontFamily:  'monospace',
            letterSpacing: '0.05em',
            transition:  'border-color 0.15s',
          }}
        />

        <button
          onClick={handleSubmit}
          disabled={state === 'validating' || !token.trim()}
          style={{
            background:   state === 'validating' ? 'rgba(201,168,76,0.08)' : 'rgba(201,168,76,0.15)',
            border:       '1px solid rgba(201,168,76,0.3)',
            borderRadius: 8,
            padding:      '9px 16px',
            fontSize:     12,
            fontWeight:   700,
            color:        'var(--gold)',
            cursor:       state === 'validating' ? 'wait' : 'pointer',
            whiteSpace:   'nowrap',
            transition:   'background 0.15s',
            opacity:      state === 'validating' || !token.trim() ? 0.6 : 1,
          }}
        >
          {state === 'validating' ? 'Checking…' : 'Download PDF'}
        </button>
      </div>

      {/* Error message */}
      {state === 'invalid' && errorMsg && (
        <p style={{ fontSize: 11, color: 'rgba(220,80,60,0.9)', margin: '8px 0 0', lineHeight: 1.5 }}>
          {errorMsg}
        </p>
      )}

      {/* Cancel */}
      <button
        onClick={() => { setState('teaser'); setToken(''); setErrorMsg('') }}
        style={{
          background: 'none', border: 'none', fontSize: 11,
          color: 'var(--text-4)', cursor: 'pointer', marginTop: 8,
          padding: 0, opacity: 0.7, transition: 'opacity 0.15s',
        }}
        onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.opacity = '1')}
        onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.opacity = '0.7')}
      >
        Cancel
      </button>

      <p style={{ fontSize: 10.5, color: 'var(--text-4)', margin: '10px 0 0', lineHeight: 1.5 }}>
        Token is shared privately via WhatsApp for verified sessions.{' '}
        <a href="https://wa.me/your-number" style={{ color: 'var(--gold)', textDecoration: 'none', opacity: 0.8 }}>
          Request access →
        </a>
      </p>
    </Card>
  )
}

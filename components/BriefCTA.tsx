'use client'

// components/BriefCTA.tsx
// Sprint: Brief freemium + dark/light PDF mode
//
// Token gate removed — Brief PDF is now free for all users.
// Added dark/light theme toggle so users can download whichever suits their
// use-case (dark for screen sharing / presentations; light for printing).

import { useState } from 'react'

interface Props { sessionId: string }

// ── Stable card wrapper — defined at module level to prevent remount on state change ──
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
  const [theme,       setTheme]       = useState<'dark' | 'light'>('dark')
  const [downloading, setDownloading] = useState(false)

  const handleDownload = () => {
    setDownloading(true)
    window.location.href = `/api/record/${sessionId}/brief?theme=${theme}`
    // Reset after a brief delay — browser takes over the download
    setTimeout(() => setDownloading(false), 4000)
  }

  const pillBase: React.CSSProperties = {
    padding:      '5px 13px',
    borderRadius: 20,
    fontSize:     11,
    fontWeight:   600,
    cursor:       'pointer',
    border:       '1px solid transparent',
    transition:   'all 0.15s ease',
  }

  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        {/* Left: label + theme toggle */}
        <div>
          <p style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--gold)', margin: '0 0 6px', letterSpacing: '0.05em' }}>
            Decision Brief
          </p>
          <p style={{ fontSize: 12, color: 'var(--text-4)', margin: '0 0 10px', lineHeight: 1.55 }}>
            A formatted PDF — all six advisors, synthesis, and pushbacks.
          </p>

          {/* Theme pills */}
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={() => setTheme('dark')}
              style={{
                ...pillBase,
                background:   theme === 'dark' ? 'rgba(201,168,76,0.15)' : 'transparent',
                border:       theme === 'dark' ? '1px solid rgba(201,168,76,0.4)' : '1px solid var(--border-mid)',
                color:        theme === 'dark' ? 'var(--gold)'             : 'var(--text-4)',
              }}
            >
              Dark
            </button>
            <button
              onClick={() => setTheme('light')}
              style={{
                ...pillBase,
                background:   theme === 'light' ? 'rgba(201,168,76,0.15)' : 'transparent',
                border:       theme === 'light' ? '1px solid rgba(201,168,76,0.4)' : '1px solid var(--border-mid)',
                color:        theme === 'light' ? 'var(--gold)'             : 'var(--text-4)',
              }}
            >
              Light
            </button>
          </div>
        </div>

        {/* Right: download button */}
        {downloading ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            <style>{`@keyframes brief-spin { to { transform: rotate(360deg); } }`}</style>
            <div style={{
              width: 14, height: 14, borderRadius: '50%',
              border: '2px solid rgba(201,168,76,0.2)', borderTopColor: 'var(--gold)',
              animation: 'brief-spin 0.8s linear infinite', flexShrink: 0,
            }} />
            <span style={{ fontSize: 12, color: 'var(--text-3)' }}>Preparing…</span>
          </div>
        ) : (
          <button
            onClick={handleDownload}
            style={{
              background:    'rgba(201,168,76,0.12)',
              border:        '1px solid rgba(201,168,76,0.35)',
              borderRadius:  8,
              padding:       '9px 18px',
              fontSize:      12,
              fontWeight:    700,
              color:         'var(--gold)',
              cursor:        'pointer',
              whiteSpace:    'nowrap',
              flexShrink:    0,
            }}
          >
            Download PDF →
          </button>
        )}
      </div>
    </Card>
  )
}

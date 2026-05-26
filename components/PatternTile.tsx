'use client'

// components/PatternTile.tsx
// ── Mirror Module: Individual Pattern Tile (Sprint 7b, updated Sprint 20) ─────
//
// Sprint 20 additions:
//   - signalType pill: 'distorting' | 'neutral' | 'adaptive' shown in footer
//     when signalType is non-null (null for pre-Sprint-20 sessions → no pill)
//   - Source session drawer: clicking "N of your sessions" in the footer
//     fetches /api/mirror/sessions-lookup and shows an inline list of the
//     decisions that drove the detection. Closes on click-outside.
//     Requires authToken prop (passed down from BiasFingerprint → PatternTile).
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useRef } from 'react'
import type { FingerprintTile, SessionPreview, BiasSignalType } from '@/lib/types'

// ── Confidence dot row ────────────────────────────────────────────────────────

function ConfidenceDots({ filled }: { filled: number }) {
  return (
    <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
      {[0, 1, 2].map(i => (
        <div
          key={i}
          title={i === 0 ? '1 detection' : i === 1 ? '2 detections' : '3+ detections'}
          style={{
            width:        7,
            height:       7,
            borderRadius: '50%',
            background:   i < filled ? 'var(--gold)' : 'transparent',
            border:       `1.5px solid ${i < filled ? 'var(--gold)' : 'var(--border-mid)'}`,
            transition:   'all 0.3s',
          }}
        />
      ))}
    </div>
  )
}

// ── Lock icon ─────────────────────────────────────────────────────────────────

const IconLock = () => (
  <svg width={11} height={11} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
    <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
  </svg>
)

// ── Signal type pill ──────────────────────────────────────────────────────────
//
// Shown only for confirmed tiles with a non-null signalType.
// Absent for forming tiles and for detections from before Sprint 20.

const SIGNAL_CONFIG: Record<BiasSignalType, { label: string; color: string; bg: string }> = {
  distorting: { label: 'Working against you here', color: '#e05a5a', bg: 'rgba(224,90,90,0.07)'   },
  neutral:    { label: 'Neutral in this context',  color: 'var(--text-4)', bg: 'transparent'      },
  adaptive:   { label: 'May be an asset here',     color: '#4caf7d', bg: 'rgba(76,175,125,0.07)'  },
}

function SignalPill({ signalType }: { signalType: BiasSignalType }) {
  const cfg = SIGNAL_CONFIG[signalType]
  // Don't render a pill for 'neutral' — it's the default state, not worth labelling
  if (signalType === 'neutral') return null
  return (
    <span style={{
      display:       'inline-flex',
      alignItems:    'center',
      fontSize:      9.5,
      fontWeight:    600,
      letterSpacing: '0.04em',
      color:         cfg.color,
      background:    cfg.bg,
      border:        `1px solid ${cfg.color}40`,
      borderRadius:  4,
      padding:       '2px 7px',
    }}>
      {cfg.label}
    </span>
  )
}

// ── Source session drawer ─────────────────────────────────────────────────────
//
// Inline popover listing the decisions that triggered this pattern.
// Fetched lazily on first open — result cached in component state.

interface DrawerProps {
  sessionIds:  string[]
  authToken:   string
  onClose:     () => void
}

function SourceDrawer({ sessionIds, authToken, onClose }: DrawerProps) {
  const [sessions, setSessions] = useState<SessionPreview[] | null>(null)
  const [loading,  setLoading]  = useState(true)
  const ref = useRef<HTMLDivElement>(null)

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  // Fetch session previews
  useEffect(() => {
    if (!sessionIds.length) { setLoading(false); return }
    const ids = sessionIds.slice(0, 30).join(',')
    fetch(`/api/mirror/sessions-lookup?ids=${encodeURIComponent(ids)}`, {
      headers: { Authorization: `Bearer ${authToken}` },
    })
      .then(r => r.json())
      .then(d => setSessions(d.sessions ?? []))
      .catch(() => setSessions([]))
      .finally(() => setLoading(false))
  }, [sessionIds, authToken])

  return (
    <div
      ref={ref}
      style={{
        marginTop:    8,
        background:   'var(--bg-card)',
        border:       '1px solid var(--border-mid)',
        borderRadius: 8,
        padding:      '12px 14px',
        fontSize:     11.5,
      }}
    >
      <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-4)', margin: '0 0 8px' }}>
        Detected in these decisions
      </p>

      {loading && (
        <p style={{ color: 'var(--text-4)', margin: 0 }}>Loading…</p>
      )}

      {!loading && sessions && sessions.length === 0 && (
        <p style={{ color: 'var(--text-4)', margin: 0 }}>No sessions found.</p>
      )}

      {!loading && sessions && sessions.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 320, overflowY: 'auto', paddingRight: 4 }}>
          {sessions.map(s => (
            <div key={s.id} style={{
              borderBottom: '1px solid var(--border-dim)',
              paddingBottom: 8,
              marginBottom: 2,
            }}>
              <p style={{ fontSize: 12, color: 'var(--text-2)', margin: '0 0 3px', lineHeight: 1.55 }}>
                {s.decision_preview}
              </p>
              <p style={{ fontSize: 10, color: 'var(--text-4)', margin: 0 }}>
                {new Date(s.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Forming tile ──────────────────────────────────────────────────────────────

function FormingTile({ tile }: { tile: FingerprintTile }) {
  return (
    <div style={{
      background:   'var(--bg-card)',
      border:       '1px solid var(--border-dim)',
      borderRadius: 10,
      padding:      '15px 16px',
      position:     'relative',
      overflow:     'hidden',
    }}>
      <div style={{
        position:   'absolute', top: 0, left: 0, width: '100%', height: 2,
        background: 'linear-gradient(90deg, var(--border-mid) 0%, transparent 100%)',
      }} />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 10, gap: 8 }}>
        <span style={{
          fontSize: 9.5, fontWeight: 700, letterSpacing: '0.1em',
          textTransform: 'uppercase', color: 'var(--text-4)', lineHeight: 1.4, flex: 1,
        }}>
          {tile.biasLabel}
        </span>
        <span style={{ color: 'var(--text-4)', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
          <IconLock />
        </span>
      </div>

      <div style={{ filter: 'blur(4px)', userSelect: 'none', pointerEvents: 'none', marginBottom: 10 }}>
        <div style={{ height: 7, background: 'var(--border-mid)', borderRadius: 3, marginBottom: 5, width: '90%', opacity: 0.6 }} />
        <div style={{ height: 7, background: 'var(--border-mid)', borderRadius: 3, marginBottom: 5, width: '75%', opacity: 0.5 }} />
        <div style={{ height: 7, background: 'var(--border-mid)', borderRadius: 3, width: '55%', opacity: 0.4 }} />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <ConfidenceDots filled={1} />
        <span style={{ fontSize: 10, color: 'var(--text-4)', fontStyle: 'italic' }}>Pattern forming</span>
      </div>
    </div>
  )
}

// ── Confirmed tile ────────────────────────────────────────────────────────────

function ConfirmedTile({ tile, authToken }: { tile: FingerprintTile; authToken: string }) {
  const isStrong         = tile.confidenceDots === 3
  const [drawerOpen, setDrawerOpen] = useState(false)

  return (
    <div
      style={{
        background:   'var(--bg-card)',
        border:       '1px solid var(--border-mid)',
        borderRadius: 10,
        padding:      '15px 16px',
        position:     'relative',
        overflow:     'hidden',
        transition:   'border-color 0.2s',
      }}
      onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--border-hi)')}
      onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border-mid)')}
    >
      {/* Active indicator stripe */}
      <div style={{
        position: 'absolute', top: 0, left: 0, width: '100%', height: 2,
        background: 'linear-gradient(90deg, var(--gold-dim) 0%, transparent 70%)',
      }} />

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 10, gap: 8 }}>
        <span style={{
          fontSize: 9.5, fontWeight: 700, letterSpacing: '0.1em',
          textTransform: 'uppercase', color: 'var(--text-3)', lineHeight: 1.4, flex: 1,
        }}>
          {tile.biasLabel}
        </span>
        <ConfidenceDots filled={tile.confidenceDots} />
      </div>

      {/* AI interpretation */}
      <p style={{ fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.6, margin: '0 0 10px' }}>
        {tile.interpretation}
      </p>

      {/* Activation summary */}
      {tile.activationSummary && (
        <div style={{
          background:   isStrong ? 'rgba(201,168,76,0.05)' : 'transparent',
          border:       `1px solid ${isStrong ? 'var(--gold-dim)' : 'var(--border-dim)'}`,
          borderRadius: 6,
          padding:      '7px 10px',
          marginBottom: 10,
        }}>
          <p style={{
            fontSize:   11,
            color:      isStrong ? 'var(--gold)' : 'var(--text-4)',
            margin:     0,
            lineHeight: 1.5,
            fontWeight: isStrong ? 500 : 400,
          }}>
            <span style={{
              fontSize:      9.5,
              fontWeight:    700,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              opacity:       0.6,
              marginRight:   5,
            }}>
              Activates when:
            </span>
            {tile.activationSummary}
          </p>
        </div>
      )}

      {/* Footer: signal pill + session count link */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {/* Signal type pill — only shown when non-null and non-neutral */}
          {tile.signalType && <SignalPill signalType={tile.signalType} />}
        </div>

        {/* Clickable session count — opens source drawer */}
        <button
          onClick={() => setDrawerOpen(o => !o)}
          style={{
            background:  'transparent',
            border:      'none',
            cursor:      'pointer',
            fontFamily:  'inherit',
            fontSize:    10,
            color:       drawerOpen ? 'var(--gold)' : 'var(--text-4)',
            padding:     0,
            transition:  'color 0.15s',
            fontVariantNumeric: 'tabular-nums',
            textDecoration: 'underline',
            textDecorationColor: 'transparent',
          }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLButtonElement).style.color = 'var(--gold)'
            ;(e.currentTarget as HTMLButtonElement).style.textDecorationColor = 'var(--gold)'
          }}
          onMouseLeave={e => {
            if (!drawerOpen) {
              (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-4)'
              ;(e.currentTarget as HTMLButtonElement).style.textDecorationColor = 'transparent'
            }
          }}
        >
          {tile.detectionCount} of your sessions ↓
        </button>
      </div>

      {/* Source session drawer */}
      {drawerOpen && tile.sessionIds.length > 0 && (
        <SourceDrawer
          sessionIds={tile.sessionIds}
          authToken={authToken}
          onClose={() => setDrawerOpen(false)}
        />
      )}
    </div>
  )
}

// ── Main export ───────────────────────────────────────────────────────────────

export default function PatternTile({
  tile,
  authToken = '',
}: {
  tile: FingerprintTile
  authToken?: string
}) {
  return tile.isTeaser
    ? <FormingTile tile={tile} />
    : <ConfirmedTile tile={tile} authToken={authToken} />
}

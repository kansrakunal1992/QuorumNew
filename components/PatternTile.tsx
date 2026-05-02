'use client'

// components/PatternTile.tsx
// ── Mirror Module: Individual Pattern Tile (Sprint 7b) ────────────────────────
//
// Renders a single detected bias pattern as a card.
//
// Two visual states:
//
//   CONFIRMED (isTeaser: false, detectionCount >= 2)
//     Shows: bias label, confidence dots, AI interpretation,
//            activation summary (if available), detection count footer
//
//   FORMING   (isTeaser: true, detectionCount === 1)
//     Shows: bias label, single confidence dot, "Pattern forming" copy,
//            blurred content bars — signals more sessions needed
//
// Confidence dots:
//   ● ○ ○   1 detection — forming
//   ● ● ○   2 detections — confirmed
//   ● ● ●   3+ detections — conditional pattern known
//
// Used in BiasFingerprint.tsx — rendered in a 2-column grid on desktop,
// single column on mobile.
// ─────────────────────────────────────────────────────────────────────────────

import type { FingerprintTile } from '@/lib/types'

// ── Confidence dot row ────────────────────────────────────────────────────────

function ConfidenceDots({ dots, filled }: { dots: 1 | 2 | 3; filled: number }) {
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

// ── Forming tile (isTeaser: true) ─────────────────────────────────────────────

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
      {/* Subtle forming indicator stripe */}
      <div style={{
        position:   'absolute',
        top:        0,
        left:       0,
        width:      '100%',
        height:     2,
        background: 'linear-gradient(90deg, var(--border-mid) 0%, transparent 100%)',
      }} />

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 10, gap: 8 }}>
        <span style={{
          fontSize:      9.5,
          fontWeight:    700,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color:         'var(--text-4)',
          lineHeight:    1.4,
          flex:          1,
        }}>
          {tile.biasLabel}
        </span>
        <span style={{ color: 'var(--text-4)', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
          <IconLock />
        </span>
      </div>

      {/* Blurred placeholder bars */}
      <div style={{ filter: 'blur(4px)', userSelect: 'none', pointerEvents: 'none', marginBottom: 10 }}>
        <div style={{ height: 7, background: 'var(--border-mid)', borderRadius: 3, marginBottom: 5, width: '90%', opacity: 0.6 }} />
        <div style={{ height: 7, background: 'var(--border-mid)', borderRadius: 3, marginBottom: 5, width: '75%', opacity: 0.5 }} />
        <div style={{ height: 7, background: 'var(--border-mid)', borderRadius: 3, width: '55%', opacity: 0.4 }} />
      </div>

      {/* Footer */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <ConfidenceDots dots={1} filled={1} />
        <span style={{ fontSize: 10, color: 'var(--text-4)', fontStyle: 'italic' }}>
          Pattern forming
        </span>
      </div>
    </div>
  )
}

// ── Confirmed tile (isTeaser: false) ─────────────────────────────────────────

function ConfirmedTile({ tile }: { tile: FingerprintTile }) {
  // Show activation summary for ALL confirmed tiles — gold for 3+, subtle for 2
  const isStrong = tile.confidenceDots === 3

  return (
    <div style={{
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
        position:   'absolute',
        top:        0,
        left:       0,
        width:      '100%',
        height:     2,
        background: 'linear-gradient(90deg, var(--gold-dim) 0%, transparent 70%)',
      }} />

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 10, gap: 8 }}>
        <span style={{
          fontSize:      9.5,
          fontWeight:    700,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color:         'var(--text-3)',
          lineHeight:    1.4,
          flex:          1,
        }}>
          {tile.biasLabel}
        </span>
        <ConfidenceDots dots={tile.confidenceDots} filled={tile.confidenceDots} />
      </div>

      {/* AI interpretation */}
      <p style={{
        fontSize:   12.5,
        color:      'var(--text-2)',
        lineHeight: 1.6,
        margin:     '0 0 10px',
      }}>
        {tile.interpretation}
      </p>

      {/* Activation summary — own block for ALL confirmed tiles.
          3+ detections: gold border + gold text (strong signal)
          2 detections:  dim border + text-4 (emerging signal) */}
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
            {tile.activationSummary}
          </p>
        </div>
      )}

      {/* Footer — session count only, activation summary moved above */}
      <div style={{ marginTop: 4 }}>
        <span style={{ fontSize: 10, color: 'var(--text-4)', fontVariantNumeric: 'tabular-nums' }}>
          {tile.detectionCount} of your sessions
        </span>
      </div>
    </div>
  )
}

// ── Main export ───────────────────────────────────────────────────────────────

export default function PatternTile({ tile }: { tile: FingerprintTile }) {
  return tile.isTeaser
    ? <FormingTile tile={tile} />
    : <ConfirmedTile tile={tile} />
}

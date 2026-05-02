'use client'

// components/BiasFingerprint.tsx
// ── Mirror Module: Bias Fingerprint Section (Sprint 7b) ───────────────────────
//
// Fetches and renders the user's full bias fingerprint.
// Only rendered inside UnlockedView (mirror_access confirmed by parent).
//
// Layout:
//   1. Narrative — AI-generated personal decision profile (2–3 sentences)
//   2. Confirmed tiles — detection_count >= 2, full interpretation
//   3. Forming tiles — detection_count == 1, blurred / label only
//
// Loading state: skeleton pulse while fetch is in flight
// Error state: graceful — shows "analysis unavailable" without breaking page
// Empty state: < 2 confirmed patterns — shows "Pattern forming" with session count
//
// Fetch is triggered once on mount with the auth token passed from parent.
// No refetch on re-render unless the component is remounted.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect } from 'react'
import PatternTile              from '@/components/PatternTile'
import type { FingerprintData } from '@/lib/types'

// ── Skeleton loader ───────────────────────────────────────────────────────────

function FingerprintSkeleton() {
  const bar = (w: string, h = 8) => (
    <div style={{
      height:     h,
      width:      w,
      background: 'var(--border-dim)',
      borderRadius: 4,
      animation:  'fp-pulse 1.8s ease-in-out infinite',
    }} />
  )

  return (
    <>
      <style>{`
        @keyframes fp-pulse {
          0%, 100% { opacity: 0.3; }
          50%       { opacity: 0.7; }
        }
      `}</style>

      {/* Narrative skeleton */}
      <div style={{
        background:   'var(--bg-card)',
        border:       '1px solid var(--border-dim)',
        borderRadius: 12,
        padding:      '20px 22px',
        marginBottom: 20,
        display:      'flex',
        flexDirection:'column',
        gap:          8,
      }}>
        {bar('95%', 9)}
        {bar('88%', 9)}
        {bar('72%', 9)}
        {bar('60%', 9)}
      </div>

      {/* Tile skeletons */}
      <div style={{
        display:               'grid',
        gridTemplateColumns:   'repeat(auto-fill, minmax(220px, 1fr))',
        gap:                   10,
      }}>
        {[0, 1, 2].map(i => (
          <div key={i} style={{
            background:   'var(--bg-card)',
            border:       '1px solid var(--border-dim)',
            borderRadius: 10,
            padding:      '15px 16px',
            display:      'flex',
            flexDirection:'column',
            gap:          8,
          }}>
            {bar('50%', 7)}
            {bar('90%', 7)}
            {bar('75%', 7)}
            {bar('55%', 7)}
          </div>
        ))}
      </div>
    </>
  )
}

// ── Narrative block ───────────────────────────────────────────────────────────

function NarrativeBlock({ narrative, sessionCount }: { narrative: string | null; sessionCount: number }) {
  if (!narrative) {
    return (
      <div style={{
        background:   'var(--bg-card)',
        border:       '1px solid var(--border-dim)',
        borderRadius: 12,
        padding:      '18px 20px',
        marginBottom: 20,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <div style={{
            width:       6, height: 6, borderRadius: '50%',
            background:  'var(--gold-dim)',
            border:      '1.5px solid var(--gold)',
            animation:   'blink 2s ease-in-out infinite',
          }} />
          <span style={{ fontSize: 11.5, color: 'var(--text-3)', fontWeight: 600 }}>
            Profile forming
          </span>
        </div>
        <p style={{ fontSize: 12.5, color: 'var(--text-4)', margin: 0, lineHeight: 1.65 }}>
          Your personal decision narrative compiles once two or more patterns are confirmed
          across your sessions. Keep running decisions — each one sharpens the picture.
          {sessionCount > 0 && (
            <> You have {sessionCount} session{sessionCount !== 1 ? 's' : ''} logged so far.</>
          )}
        </p>
      </div>
    )
  }

  return (
    <div style={{
      background:    'var(--bg-card)',
      border:        '1px solid var(--border-mid)',
      borderRadius:  12,
      padding:       '20px 22px',
      marginBottom:  20,
      position:      'relative',
      overflow:      'hidden',
    }}>
      {/* Subtle gold top border */}
      <div style={{
        position:  'absolute',
        top:       0, left: 0,
        width:     '100%',
        height:    2,
        background:'linear-gradient(90deg, var(--gold-dim) 0%, transparent 60%)',
      }} />

      <p style={{
        fontSize:   14,
        color:      'var(--text-2)',
        lineHeight: 1.75,
        margin:     0,
        fontStyle:  'italic',
      }}>
        "{narrative}"
      </p>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  authToken: string
}

export default function BiasFingerprint({ authToken }: Props) {
  const [data,    setData]    = useState<FingerprintData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(false)

  useEffect(() => {
    let cancelled = false

    const fetchFingerprint = async () => {
      try {
        const res = await fetch('/api/mirror/fingerprint', {
          headers: { Authorization: `Bearer ${authToken}` },
        })

        if (!res.ok) {
          setError(true)
          return
        }

        const json = await res.json() as FingerprintData
        if (!cancelled) setData(json)
      } catch {
        if (!cancelled) setError(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    fetchFingerprint()
    return () => { cancelled = true }
  }, [authToken])

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading) return <FingerprintSkeleton />

  // ── Error ──────────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div style={{
        background:   'var(--bg-card)',
        border:       '1px solid var(--border-dim)',
        borderRadius: 12,
        padding:      '18px 20px',
      }}>
        <p style={{ fontSize: 12.5, color: 'var(--text-4)', margin: 0, lineHeight: 1.6 }}>
          Pattern analysis temporarily unavailable. Your data is intact — try
          refreshing in a moment.
        </p>
      </div>
    )
  }

  const totalTiles = (data?.confirmedTiles.length ?? 0) + (data?.formingTiles.length ?? 0)

  // ── No bias data at all ────────────────────────────────────────────────────
  if (!data || totalTiles === 0) {
    return (
      <div style={{
        background:   'var(--bg-card)',
        border:       '1px solid var(--border-dim)',
        borderRadius: 12,
        padding:      '20px 22px',
      }}>
        <p style={{ fontSize: 12.5, color: 'var(--text-4)', margin: 0, lineHeight: 1.65 }}>
          No patterns detected yet. Complete the Examiner phase in your next session —
          those answers are what Mirror uses to build your fingerprint.
        </p>
      </div>
    )
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div>
      {/* Narrative */}
      <NarrativeBlock narrative={data.narrative} sessionCount={data.sessionCount} />

      {/* Confirmed tiles */}
      {data.confirmedTiles.length > 0 && (
        <div style={{
          display:             'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
          gap:                 10,
          marginBottom:        data.formingTiles.length > 0 ? 16 : 0,
        }}>
          {data.confirmedTiles.map(tile => (
            <PatternTile key={tile.biasKey} tile={tile} />
          ))}
        </div>
      )}

      {/* Forming tiles (teasers even in paid view — more sessions needed) */}
      {data.formingTiles.length > 0 && (
        <>
          <p style={{
            fontSize:   11,
            color:      'var(--text-4)',
            margin:     '0 0 8px',
            fontStyle:  'italic',
          }}>
            {data.formingTiles.length} pattern{data.formingTiles.length !== 1 ? 's' : ''} forming —
            one more session to confirm
          </p>
          <div style={{
            display:             'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
            gap:                 10,
          }}>
            {data.formingTiles.map(tile => (
              <PatternTile key={tile.biasKey} tile={tile} />
            ))}
          </div>
        </>
      )}

      {/* Generation timestamp */}
      <p style={{
        fontSize:  10,
        color:     'var(--text-4)',
        margin:    '14px 0 0',
        textAlign: 'right',
        fontVariantNumeric: 'tabular-nums',
      }}>
        Analysis from {data.sessionCount} session{data.sessionCount !== 1 ? 's' : ''}
        {' · '}
        {new Date(data.generatedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
      </p>
    </div>
  )
}

'use client'

// components/BiasFingerprint.tsx
// ── Mirror Module: Bias Fingerprint Section (Sprint 7b, updated Sprint 20) ────
//
// Sprint 20: passes authToken down to PatternTile so each tile can open
// a source-session drawer. signalType and sessionIds are now in FingerprintTile
// (populated by mirror-fingerprint.ts) and flow through automatically.

import { useState, useEffect } from 'react'
import { formatShortDate } from '@/lib/dates'
import PatternTile              from '@/components/PatternTile'
import type { FingerprintData } from '@/lib/types'

// ── Skeleton ──────────────────────────────────────────────────────────────────

function FingerprintSkeleton() {
  const bar = (w: string, h = 8) => (
    <div style={{ height: h, width: w, background: 'var(--border-dim)', borderRadius: 4, animation: 'fp-pulse 1.8s ease-in-out infinite' }} />
  )
  return (
    <>
      <style>{`@keyframes fp-pulse { 0%,100%{opacity:0.3} 50%{opacity:0.7} }`}</style>
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-dim)', borderRadius: 12, padding: '20px 22px', marginBottom: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {bar('95%', 9)}{bar('88%', 9)}{bar('72%', 9)}{bar('60%', 9)}
      </div>
      <div className="mirror-bias-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
        {[0, 1, 2].map(i => (
          <div key={i} style={{ background: 'var(--bg-card)', border: '1px solid var(--border-dim)', borderRadius: 10, padding: '15px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {bar('50%', 7)}{bar('90%', 7)}{bar('75%', 7)}{bar('55%', 7)}
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
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-dim)', borderRadius: 12, padding: '18px 20px', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--gold-dim)', border: '1.5px solid var(--gold)', animation: 'blink 2s ease-in-out infinite' }} />
          <span style={{ fontSize: 11.5, color: 'var(--text-3)', fontWeight: 600 }}>Profile forming</span>
        </div>
        <p style={{ fontSize: 12.5, color: 'var(--text-4)', margin: '0 0 12px', lineHeight: 1.65 }}>
          Your personal decision narrative compiles once three or more patterns are confirmed across your sessions.
          {sessionCount > 0 && <> You have {sessionCount} session{sessionCount !== 1 ? 's' : ''} logged so far.</>}
        </p>
        <a href="/" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12.5, color: 'var(--gold)', fontWeight: 600, textDecoration: 'none' }}
          onMouseEnter={e => ((e.currentTarget as HTMLAnchorElement).style.opacity = '0.75')}
          onMouseLeave={e => ((e.currentTarget as HTMLAnchorElement).style.opacity = '1')}>
          Run your next decision →
        </a>
      </div>
    )
  }

  return (
    <div style={{ background: 'linear-gradient(160deg, rgba(201,168,76,0.045) 0%, var(--bg-card) 55%)', border: '1px solid rgba(201,168,76,0.18)', borderRadius: 12, padding: '20px 22px', marginBottom: 20, position: 'relative', overflow: 'hidden', boxShadow: '0 2px 12px rgba(0,0,0,0.45), inset 0 1px 0 rgba(201,168,76,0.08)', backdropFilter: 'blur(4px)' }}>
      <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: 2, background: 'linear-gradient(90deg, var(--gold) 0%, var(--gold-dim) 40%, transparent 80%)' }} />
      <p style={{ fontSize: 14, color: 'var(--text-2)', lineHeight: 1.75, margin: 0, fontStyle: 'italic' }}>
        &ldquo;{narrative}&rdquo;
      </p>
    </div>
  )
}

// ── Section expand button ─────────────────────────────────────────────────────

function SectionToggle({ count, expanded, label, onToggle }: { count: number; expanded: boolean; label: string; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      style={{
        display: 'flex', alignItems: 'center', gap: 7, marginTop: 10, marginBottom: expanded ? 10 : 0,
        padding: '7px 12px', background: 'var(--bg-card-alt)', border: '1px solid var(--border-dim)',
        borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit', fontSize: 12,
        color: 'var(--text-4)', letterSpacing: '0.03em', transition: 'color 0.15s',
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-2)' }}
      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-4)' }}
    >
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
        style={{ transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
        <polyline points="6 9 12 15 18 9"/>
      </svg>
      {expanded ? `Hide ${label}` : `Show ${count} more ${label}`}
    </button>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props { authToken: string }

const CONFIRMED_INITIAL = 3

export default function BiasFingerprint({ authToken }: Props) {
  const [data,              setData]              = useState<FingerprintData | null>(null)
  const [loading,           setLoading]           = useState(true)
  const [error,             setError]             = useState(false)
  const [confirmedExpanded, setConfirmedExpanded] = useState(false)
  const [formingExpanded,   setFormingExpanded]   = useState(false)

  useEffect(() => {
    let cancelled = false
    const fetchFingerprint = async () => {
      try {
        const res = await fetch('/api/mirror/fingerprint', { headers: { Authorization: `Bearer ${authToken}` } })
        if (!res.ok) { setError(true); return }
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

  if (loading) return <FingerprintSkeleton />

  if (error) {
    return (
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-dim)', borderRadius: 12, padding: '18px 20px' }}>
        <p style={{ fontSize: 12.5, color: 'var(--text-4)', margin: 0, lineHeight: 1.6 }}>
          Pattern analysis temporarily unavailable. Your data is intact — try refreshing in a moment.
        </p>
      </div>
    )
  }

  const totalTiles = (data?.confirmedTiles.length ?? 0) + (data?.formingTiles.length ?? 0)

  if (!data || totalTiles === 0) {
    return (
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-dim)', borderRadius: 12, padding: '20px 22px' }}>
        <p style={{ fontSize: 12.5, color: 'var(--text-4)', margin: '0 0 12px', lineHeight: 1.65 }}>
          No patterns detected yet. Complete the Examiner phase in your next session —
          those answers are what Mirror uses to build your fingerprint.
        </p>
        <a href="/" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12.5, color: 'var(--gold)', fontWeight: 600, textDecoration: 'none' }}
          onMouseEnter={e => ((e.currentTarget as HTMLAnchorElement).style.opacity = '0.75')}
          onMouseLeave={e => ((e.currentTarget as HTMLAnchorElement).style.opacity = '1')}>
          Run a decision →
        </a>
      </div>
    )
  }

  const confirmedVisible = confirmedExpanded
    ? data.confirmedTiles
    : data.confirmedTiles.slice(0, CONFIRMED_INITIAL)
  const confirmedHidden = Math.max(0, data.confirmedTiles.length - CONFIRMED_INITIAL)

  return (
    <div>
      <NarrativeBlock narrative={data.narrative} sessionCount={data.sessionCount} />

      {/* Confirmed tiles — authToken passed for source drawer */}
      {data.confirmedTiles.length > 0 && (
        <>
          <div className="mirror-bias-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
            {confirmedVisible.map(tile => (
              <PatternTile key={tile.biasKey} tile={tile} authToken={authToken} />
            ))}
          </div>

          {confirmedHidden > 0 && (
            <SectionToggle
              count={confirmedHidden}
              expanded={confirmedExpanded}
              label={`confirmed pattern${confirmedHidden !== 1 ? 's' : ''}`}
              onToggle={() => setConfirmedExpanded(e => !e)}
            />
          )}
        </>
      )}

      {/* Forming tiles */}
      {data.formingTiles.length > 0 && (
        <div style={{ marginTop: confirmedHidden > 0 && !confirmedExpanded ? 14 : 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
            <p style={{ fontSize: 11, color: 'var(--text-4)', margin: 0, fontStyle: 'italic' }}>
              {data.formingTiles.length} pattern{data.formingTiles.length !== 1 ? 's' : ''} forming — building confidence
            </p>
            <button
              onClick={() => setFormingExpanded(e => !e)}
              style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', background: 'transparent', border: '1px solid var(--border-dim)', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit', fontSize: 11, color: 'var(--text-4)', transition: 'color 0.15s' }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--gold)' }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-4)' }}
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                style={{ transform: formingExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
                <polyline points="6 9 12 15 18 9"/>
              </svg>
              {formingExpanded ? 'Hide' : 'Peek'}
            </button>
          </div>

          {formingExpanded && (
            <div className="mirror-bias-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
              {data.formingTiles.map(tile => (
                <PatternTile key={tile.biasKey} tile={tile} authToken={authToken} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Footer */}
      <p style={{ fontSize: 10, color: 'var(--text-4)', margin: '14px 0 0', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
        Analysis from {data.sessionCount} session{data.sessionCount !== 1 ? 's' : ''}
        {' · '}
        {formatShortDate(data.generatedAt)}
      </p>
    </div>
  )
}

'use client'

// components/MirrorTimeline.tsx
// ── Mirror Module: Decision Timeline (Sprint 7a) ──────────────────────────────
//
// Shows top 5 sessions by default; rest expandable.
// Ambivalence is suppressed — it means "no clear emotion detected" not a
// genuine emotional signal worth surfacing to the user.

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import type { TimelineSession } from '@/lib/types'

// ── Decision type config ─────────────────────────────────────────────────────

const DECISION_TYPE_CONFIG: Record<string, { label: string; color: string; stripe: string }> = {
  commitment:   { label: 'Commitment',   color: 'rgba(201,168,76,0.18)',  stripe: 'var(--gold)' },
  allocation:   { label: 'Allocation',   color: 'rgba(59,130,246,0.14)',  stripe: '#3b82f6' },
  transition:   { label: 'Transition',   color: 'rgba(52,211,153,0.14)',  stripe: '#34d399' },
  acquisition:  { label: 'Acquisition',  color: 'rgba(168,85,247,0.14)',  stripe: '#a855f7' },
  renunciation: { label: 'Renunciation', color: 'rgba(239,68,68,0.12)',   stripe: '#ef4444' },
  governance:   { label: 'Governance',   color: 'rgba(100,116,139,0.14)', stripe: '#64748b' },
  delegation:   { label: 'Delegation',   color: 'rgba(20,184,166,0.12)',  stripe: '#14b8a6' },
}

const DEFAULT_TYPE = { label: 'Decision', color: 'rgba(100,116,139,0.10)', stripe: 'var(--border-mid)' }

// ── Reversibility dots ───────────────────────────────────────────────────────

const REVERSIBILITY_COLOR: Record<string, string> = {
  irreversible: '#ef4444',
  partial:      'var(--gold)',
  full:         'var(--green-text)',
}

// ── Emotion display — suppress 'ambivalence' (tagger default for "unclear") ──

function formatEmotion(emotion: string | null): string | null {
  if (!emotion || emotion === 'ambivalence') return null
  return emotion.charAt(0).toUpperCase() + emotion.slice(1)
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen).trimEnd() + '…'
}

function relativeDate(isoString: string): string {
  const now  = Date.now()
  const then = new Date(isoString).getTime()
  const diff = Math.floor((now - then) / 1000)

  if (diff < 60)           return 'Just now'
  if (diff < 3600)         return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400)        return `${Math.floor(diff / 3600)}h ago`
  if (diff < 86400 * 7)   return `${Math.floor(diff / 86400)}d ago`
  if (diff < 86400 * 30)  return `${Math.floor(diff / 86400 / 7)}w ago`
  if (diff < 86400 * 365) return `${Math.floor(diff / 86400 / 30)}mo ago`
  return `${Math.floor(diff / 86400 / 365)}y ago`
}

// ── Sub-components ───────────────────────────────────────────────────────────

function TypeChip({ type }: { type: string | null }) {
  const config = type ? (DECISION_TYPE_CONFIG[type] ?? DEFAULT_TYPE) : DEFAULT_TYPE
  return (
    <span style={{
      display:         'inline-block',
      padding:         '2px 8px',
      borderRadius:    4,
      fontSize:        10,
      fontWeight:      600,
      letterSpacing:   '0.08em',
      textTransform:   'uppercase',
      background:      config.color,
      color:           config.stripe,
      flexShrink:      0,
    }}>
      {config.label}
    </span>
  )
}

function ReversibilityDot({ reversibility }: { reversibility: string | null }) {
  if (!reversibility) return null
  const color = REVERSIBILITY_COLOR[reversibility] ?? 'var(--border-mid)'
  const title = reversibility.charAt(0).toUpperCase() + reversibility.slice(1)
  return (
    <span title={title} style={{
      display:      'inline-block',
      width:        7,
      height:       7,
      borderRadius: '50%',
      background:   color,
      flexShrink:   0,
      marginTop:    1,
    }} />
  )
}

function OutcomeIndicator({ hasOutcome }: { hasOutcome: boolean }) {
  return (
    <span title={hasOutcome ? 'Outcome logged' : 'Outcome pending'} style={{
      display:        'inline-flex',
      alignItems:     'center',
      justifyContent: 'center',
      width:          14,
      height:         14,
      borderRadius:   '50%',
      border:         `1.5px solid ${hasOutcome ? 'var(--green-text)' : 'var(--border-mid)'}`,
      background:     hasOutcome ? 'var(--green-soft)' : 'transparent',
      flexShrink:     0,
    }}>
      {hasOutcome && (
        <svg width="7" height="7" viewBox="0 0 24 24" fill="none"
          stroke="var(--green-text)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
      )}
    </span>
  )
}

// ── Expand toggle button ─────────────────────────────────────────────────────

function ExpandToggle({ count, expanded, onToggle }: { count: number; expanded: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      style={{
        width:          '100%',
        padding:        '11px 16px',
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'center',
        gap:            8,
        background:     'var(--bg-card-alt)',
        border:         '1px solid var(--border-dim)',
        borderTop:      'none',
        cursor:         'pointer',
        fontFamily:     'inherit',
        fontSize:       12,
        color:          'var(--text-4)',
        letterSpacing:  '0.04em',
        transition:     'color 0.15s, border-color 0.15s',
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-2)' }}
      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-4)' }}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
        style={{ transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
        <polyline points="6 9 12 15 18 9"/>
      </svg>
      {expanded ? 'Show fewer decisions' : `Show ${count} more decision${count !== 1 ? 's' : ''}`}
    </button>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  sessions: TimelineSession[]
  showPatternStripe?: boolean
}

const INITIAL_COUNT = 5

export default function MirrorTimeline({ sessions, showPatternStripe = true }: Props) {
  const router = useRouter()
  const [expanded, setExpanded] = useState(false)

  const visibleSessions = expanded ? sessions : sessions.slice(0, INITIAL_COUNT)
  const hiddenCount     = Math.max(0, sessions.length - INITIAL_COUNT)

  if (sessions.length === 0) {
    return (
      <div style={{ padding: '32px 20px', textAlign: 'center', color: 'var(--text-4)', fontSize: 13, fontStyle: 'italic' }}>
        No sessions found.
      </div>
    )
  }

  const typeFrequency: Record<string, number> = {}
  for (const s of sessions) {
    if (s.decision_type_primary) {
      typeFrequency[s.decision_type_primary] = (typeFrequency[s.decision_type_primary] ?? 0) + 1
    }
  }
  const repeatedTypes = new Set(Object.keys(typeFrequency).filter(t => typeFrequency[t] > 1))

  return (
    <>
      <style>{`
        .timeline-row {
          cursor: pointer;
          transition: background 0.18s, border-color 0.18s;
        }
        .timeline-row:hover {
          background: var(--bg-card-alt) !important;
          border-color: var(--border-hi) !important;
        }
      `}</style>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
        {visibleSessions.map((session, index) => {
          const typeKey   = session.decision_type_primary ?? null
          const config    = typeKey ? (DECISION_TYPE_CONFIG[typeKey] ?? DEFAULT_TYPE) : DEFAULT_TYPE
          const isRepeat  = showPatternStripe && typeKey !== null && repeatedTypes.has(typeKey)
          const isLast    = index === visibleSessions.length - 1
          const emotion   = formatEmotion(session.dominant_emotion)

          return (
            <div
              key={session.id}
              className="timeline-row"
              onClick={() => router.push(`/record/${session.id}`)}
              style={{
                display:      'flex',
                alignItems:   'stretch',
                background:   'var(--bg-card)',
                borderTop:    '1px solid var(--border-dim)',
                borderBottom: isLast && hiddenCount === 0 ? '1px solid var(--border-dim)' : 'none',
                overflow:     'hidden',
              }}
            >
              {/* Pattern stripe */}
              <div style={{
                width:      3,
                flexShrink: 0,
                background: isRepeat ? config.stripe : 'transparent',
                opacity:    0.7,
              }} />

              {/* Row content */}
              <div style={{
                flex:          1,
                padding:       '14px 16px',
                display:       'flex',
                flexDirection: 'column',
                gap:           6,
                minWidth:      0,
              }}>
                {/* Top line */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 10.5, color: 'var(--text-4)', fontVariantNumeric: 'tabular-nums', flexShrink: 0, letterSpacing: '0.04em' }}>
                    {relativeDate(session.created_at)}
                  </span>
                  {typeKey && <TypeChip type={typeKey} />}
                  {session.register_mode && (
                    <span style={{ fontSize: 9.5, color: 'var(--text-4)', letterSpacing: '0.08em', textTransform: 'uppercase', flexShrink: 0 }}>
                      {session.register_mode === 'analytical' ? 'Challenge' : 'Clarify'}
                    </span>
                  )}
                </div>

                {/* Decision text */}
                <p style={{ fontSize: 13.5, color: 'var(--text-2)', margin: 0, lineHeight: 1.5, wordBreak: 'break-word' }}>
                  {truncate(session.decision_text, 110)}
                </p>

                {/* Bottom line */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 2 }}>
                  <ReversibilityDot reversibility={session.stakes_reversibility} />
                  {emotion && (
                    <span style={{ fontSize: 10.5, color: 'var(--text-4)', fontStyle: 'italic', textTransform: 'capitalize' }}>
                      {emotion}
                    </span>
                  )}
                  <span style={{ flex: 1 }} />
                  <OutcomeIndicator hasOutcome={session.has_outcome} />
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
                    stroke="var(--text-4)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6"/>
                  </svg>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Expand / collapse */}
      {hiddenCount > 0 && (
        <ExpandToggle count={hiddenCount} expanded={expanded} onToggle={() => setExpanded(e => !e)} />
      )}

      {/* Legend */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 12, padding: '0 4px', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#ef4444', display: 'inline-block' }} />
          <span style={{ fontSize: 10, color: 'var(--text-4)' }}>Irreversible</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--gold)', display: 'inline-block' }} />
          <span style={{ fontSize: 10, color: 'var(--text-4)' }}>Partial</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--green-text)', display: 'inline-block' }} />
          <span style={{ fontSize: 10, color: 'var(--text-4)' }}>Reversible</span>
        </div>
        <span style={{ flex: 1 }} />
        {repeatedTypes.size > 0 && (
          <span style={{ fontSize: 10, color: 'var(--text-4)', fontStyle: 'italic' }}>
            Colored stripe = recurring decision type
          </span>
        )}
      </div>
    </>
  )
}

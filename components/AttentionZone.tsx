'use client'

// components/AttentionZone.tsx
// ── Sprint M5: Dynamic Attention Zone ────────────────────────────────────────
//
// Renders 0–3 compact action cards between MirrorSummaryCard and MirrorNav.
// Data comes from the summary fetch already done by MirrorSummaryCard — no
// extra API call. Absent entirely when nothing is urgent or notable.
//
// Card priority (max 3, one per signal source):
//   1. New contradictions since last visit    → urgent (coral)
//   2. Open loops ≥ 2 decisions              → action (amber)
//   3. Independence Score moved ≥ 5 pts      → notable (blue)
//
// Dismissible per-card for this session (not persisted — resets on next visit).
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useCallback } from 'react'
import type { SummaryData } from './MirrorSummaryCard'

// ── Card model ────────────────────────────────────────────────────────────────

interface ACard {
  key:       string
  type:      'urgent' | 'action' | 'notable'
  headline:  string
  sub:       string
  targetId:  string    // msec-{key} scroll target
  linkLabel: string
}

// ── Derive cards from summary data ────────────────────────────────────────────

function deriveCards(d: SummaryData): ACard[] {
  const cards: ACard[] = []

  if ((d.newContradictions ?? 0) > 0) {
    const n = d.newContradictions
    cards.push({
      key: 'contradictions', type: 'urgent',
      headline:  `${n} new contradiction${n > 1 ? 's' : ''} detected since your last visit`,
      sub:       'Your reasoning has been checked against itself — review before your next decision.',
      targetId:  'msec-contradictions',
      linkLabel: 'View contradictions',
    })
  }

  if (d.openLoopCount >= 2) {
    cards.push({
      key: 'loops', type: 'action',
      headline:  `${d.openLoopCount} decisions open without an outcome filed`,
      sub:       'Each unresolved loop reduces the signal quality of your Confidence Calibration.',
      targetId:  'msec-sri',
      linkLabel: 'View open loops',
    })
  }

  if (d.scoreDelta !== null && Math.abs(d.scoreDelta) >= 5) {
    const up = d.scoreDelta > 0
    cards.push({
      key: 'score', type: 'notable',
      headline:  `Independence Score ${up ? 'up' : 'down'} ${Math.abs(d.scoreDelta)} pts from last session`,
      sub:       up
        ? 'Your reasoning is becoming more structurally independent.'
        : 'More deference or external anchoring in recent decisions.',
      targetId:  'msec-independence',
      linkLabel: 'View score',
    })
  }

  return cards.slice(0, 3)
}

// ── Colour map ────────────────────────────────────────────────────────────────

const COLORS = {
  urgent:  { dot: '#e05050', border: 'rgba(224,80,80,0.3)',  bg: 'rgba(224,80,80,0.04)'  },
  action:  { dot: '#e8a030', border: 'rgba(232,160,48,0.3)', bg: 'rgba(232,160,48,0.04)' },
  notable: { dot: '#4a9ede', border: 'rgba(74,158,222,0.3)', bg: 'rgba(74,158,222,0.04)' },
}

// ── Single card ───────────────────────────────────────────────────────────────

function Card({ card, onDismiss }: { card: ACard; onDismiss: (k: string) => void }) {
  const c = COLORS[card.type]

  const scrollTo = useCallback(() => {
    const el = document.getElementById(card.targetId)
    if (!el) return
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 96, behavior: 'smooth' })
  }, [card.targetId])

  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 10,
      padding: '10px 14px',
      background: c.bg,
      border: `1px solid ${c.border}`,
      borderLeft: `3px solid ${c.dot}`,
      borderRadius: 8,
    }}>
      <div style={{ width: 6, height: 6, borderRadius: '50%', background: c.dot, flexShrink: 0, marginTop: 5 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-1)', margin: '0 0 2px', lineHeight: 1.35 }}>
          {card.headline}
        </p>
        <p style={{ fontSize: 11.5, color: 'var(--text-3)', margin: '0 0 6px', lineHeight: 1.5 }}>
          {card.sub}
        </p>
        <button
          onClick={scrollTo}
          style={{
            background: 'none', border: 'none', padding: 0, fontFamily: 'inherit',
            fontSize: 11, fontWeight: 600, color: c.dot, cursor: 'pointer',
            opacity: 0.85, transition: 'opacity 0.15s',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.opacity = '1' }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.opacity = '0.85' }}
        >
          {card.linkLabel} →
        </button>
      </div>
      <button
        onClick={() => onDismiss(card.key)}
        aria-label="Dismiss"
        style={{
          background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px',
          color: 'var(--text-4)', fontSize: 15, lineHeight: 1,
          opacity: 0.4, transition: 'opacity 0.15s', flexShrink: 0,
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.opacity = '1' }}
        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.opacity = '0.4' }}
      >×</button>
    </div>
  )
}

// ── Main export ───────────────────────────────────────────────────────────────

export default function AttentionZone({ data }: { data: SummaryData | null }) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())

  if (!data) return null

  const visible = deriveCards(data).filter(c => !dismissed.has(c.key))
  if (visible.length === 0) return null

  const dismiss = (key: string) =>
    setDismissed(prev => new Set([...prev, key]))

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 8,
      marginBottom: 20,
      animation: 'secFadeIn 0.35s ease both',
    }}>
      {visible.map(card => (
        <Card key={card.key} card={card} onDismiss={dismiss} />
      ))}
    </div>
  )
}

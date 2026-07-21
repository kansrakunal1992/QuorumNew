'use client'
// components/WhatChangedDrawer.tsx
// P1: unified "What Changed" surface — covers Gaps #2 (weight deltas), #3
// (advisor position evolution), #5 (reconciliation), #6 (evolution timeline,
// via the version chips), #7 (verdict versioning), #8 ("what changed" bullets).
//
// Deliberately ONE collapsible entry point rather than four separate widgets —
// matches the doc's core principle ("reduce cognitive load... not that
// they're managing six separate AI conversations"). Renders nothing until
// there are at least 2 synthesis versions, so a first-time user doing a
// single-pass decision never sees this at all.

import { useState } from 'react'
import CouncilWeightingStrip from './CouncilWeightingStrip'
import { diffSynthesisVersions, buildLeanTrajectories, PERSONA_LABELS } from '@/lib/synthesis-diff'
import type { SynthesisVersionSnapshot } from '@/lib/synthesis-diff'

interface Props {
  versions: SynthesisVersionSnapshot[]   // ordered ascending by version
}

const LEAN_LABELS: Record<string, string> = {
  proceed: 'Proceed',
  wait:    'Wait',
  mixed:   'Mixed',
}

export default function WhatChangedDrawer({ versions }: Props) {
  const [open, setOpen] = useState(false)
  const [selectedChip, setSelectedChip] = useState<number | null>(null)

  if (versions.length < 2) return null

  const prev = versions[versions.length - 2]
  const curr = versions[versions.length - 1]
  const diff = diffSynthesisVersions(prev, curr)
  const displayVersion = versions.length   // 1-indexed for display

  // Sprint 1 (Feature #3): only worth showing once there's more history than
  // the "Advisor moves" section above already covers (latest vs. previous).
  // With exactly 2 versions the two sections would say the same thing.
  const trajectories = versions.length >= 3 ? buildLeanTrajectories(versions) : []

  const chipVerdict = selectedChip !== null ? versions[selectedChip] : null

  // Phase 1: name the actual outcome instead of a generic version bump, when
  // there's something to name. diff.leanMoves is already computed above (used
  // by the "Advisor moves" section) — reused here, not recomputed.
  const movedCount = diff.leanMoves.length
  const pillLabel = movedCount > 0
    ? `Verdict updated · ${movedCount} advisor${movedCount !== 1 ? 's' : ''} shifted`
    : `Updated · v${displayVersion}`

  return (
    <div style={{ marginTop: 14 }}>
      {/* Collapsed pill — restyled to the gold accent family used by the
          Challenge flow and its automatic council-wide share, so this reads
          as the visible payoff of that same action rather than a separate,
          generic "something changed" indicator. */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display:       'flex',
          alignItems:    'center',
          gap:           6,
          background:    'rgba(201,168,76,0.10)',
          border:        '1px solid var(--gold-dim)',
          borderRadius:  20,
          padding:       '6px 12px',
          fontSize:      11,
          fontFamily:    'var(--font-mono)',
          fontWeight:    700,
          letterSpacing: '0.04em',
          color:         'var(--gold)',
          cursor:        'pointer',
        }}
      >
        {pillLabel}
        <span style={{ fontSize: 9, opacity: 0.7, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>▾</span>
      </button>

      {open && (
        <div style={{
          marginTop:    10,
          padding:      '14px 16px',
          borderRadius: 10,
          border:       '1px solid var(--border-dim)',
          background:   'var(--surface-1, transparent)',
          display:      'flex',
          flexDirection: 'column',
          gap:          16,
        }}>
          {/* 1. What changed */}
          <div>
            <p style={{
              fontSize: 10, fontWeight: 700, letterSpacing: '0.10em', textTransform: 'uppercase',
              color: 'var(--text-4)', margin: '0 0 8px',
            }}>
              What changed since the last synthesis
            </p>
            <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {diff.bullets.map((b, i) => (
                <li key={i} style={{ fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.5 }}>{b}</li>
              ))}
            </ul>
          </div>

          {/* 2. Weight shifts — reuses CouncilWeightingStrip with previousWeights for deltas */}
          <div style={{ borderTop: '1px solid var(--border-dim)', paddingTop: 12 }}>
            <CouncilWeightingStrip weights={curr.weights} previousWeights={prev.weights} />
          </div>

          {/* 3. Advisor moves — only personas whose lean actually flipped */}
          {diff.leanMoves.length > 0 && (
            <div style={{ borderTop: '1px solid var(--border-dim)', paddingTop: 12 }}>
              <p style={{
                fontSize: 10, fontWeight: 700, letterSpacing: '0.10em', textTransform: 'uppercase',
                color: 'var(--text-4)', margin: '0 0 8px',
              }}>
                Advisor moves
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {diff.leanMoves.map(move => (
                  <div key={move.persona} style={{ fontSize: 12.5, color: 'var(--text-2)' }}>
                    <strong style={{ color: 'var(--text-1)' }}>{PERSONA_LABELS[move.persona] ?? move.persona}</strong>
                    {': '}
                    {LEAN_LABELS[move.from] ?? move.from} → {LEAN_LABELS[move.to] ?? move.to}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 3.5 (Sprint 1, Feature #3) — how positions moved across the WHOLE
              session, not just the latest step. Cross-advisor, at-a-glance,
              so seeing this doesn't require opening all 6 cards and scrolling
              through pushback threads individually. Only rendered when there's
              real multi-step history and at least one advisor actually moved
              at some point — matches "only show movers" used everywhere else
              in this drawer. */}
          {trajectories.length > 0 && (
            <div style={{ borderTop: '1px solid var(--border-dim)', paddingTop: 12 }}>
              <p style={{
                fontSize: 10, fontWeight: 700, letterSpacing: '0.10em', textTransform: 'uppercase',
                color: 'var(--text-4)', margin: '0 0 8px',
              }}>
                How positions evolved
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {trajectories.map(t => (
                  <div key={t.persona} style={{ fontSize: 12.5, color: 'var(--text-2)' }}>
                    <strong style={{ color: 'var(--text-1)' }}>{PERSONA_LABELS[t.persona] ?? t.persona}</strong>
                    {': '}
                    {t.sequence.map(l => LEAN_LABELS[l] ?? l).join(' → ')}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 4. Verdict history — compact chip row, tap any chip to preview that version's verdict */}
          <div style={{ borderTop: '1px solid var(--border-dim)', paddingTop: 12 }}>
            <p style={{
              fontSize: 10, fontWeight: 700, letterSpacing: '0.10em', textTransform: 'uppercase',
              color: 'var(--text-4)', margin: '0 0 8px',
            }}>
              Verdict history
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {versions.map((v, i) => (
                <button
                  key={v.version}
                  onClick={() => setSelectedChip(prev => (prev === i ? null : i))}
                  style={{
                    fontSize:     11,
                    fontFamily:   'var(--font-mono)',
                    padding:      '4px 9px',
                    borderRadius: 12,
                    border:       `1px solid ${selectedChip === i ? 'var(--verdict-accent)' : 'var(--border-dim)'}`,
                    background:   selectedChip === i ? 'var(--verdict-bg)' : 'transparent',
                    color:        selectedChip === i ? 'var(--verdict-accent)' : 'var(--text-3)',
                    cursor:       'pointer',
                  }}
                >
                  V{i + 1}
                </button>
              ))}
            </div>
            {chipVerdict && (
              <p style={{ fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.5, margin: '8px 0 0' }}>
                {chipVerdict.verdictText || '(no verdict text captured for this version)'}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

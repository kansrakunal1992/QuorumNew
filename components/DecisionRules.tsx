'use client'

// components/DecisionRules.tsx
// ── Mirror Module: Decision Rules Display (Sprint 7d) ─────────────────────────
//
// Shows top 5 rules by default; remaining rules expandable.

import { useState, useEffect } from 'react'

interface RulesData {
  rules:            string[] | null
  sessionCount:     number
  basedOnDecisions: number
  threshold:        number
  reason?:          string
}

interface Props {
  authToken:    string
  sessionCount: number
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function RulesSkeleton() {
  return (
    <>
      <style>{`@keyframes dr-pulse { 0%,100%{opacity:0.2} 50%{opacity:0.5} }`}</style>
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-dim)', borderRadius: 12, padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {[0, 1, 2].map(i => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 3, height: 32, borderRadius: 2, background: 'var(--gold-dim)', flexShrink: 0, animation: `dr-pulse 1.8s ease-in-out infinite ${i * 0.2}s` }} />
            <div style={{ height: 10, width: `${75 - i * 12}%`, background: 'var(--border-dim)', borderRadius: 4, animation: `dr-pulse 1.8s ease-in-out infinite ${i * 0.2}s` }} />
          </div>
        ))}
      </div>
    </>
  )
}

// ── Threshold gate ────────────────────────────────────────────────────────────

function ThresholdGate({ sessionCount, threshold }: { sessionCount: number; threshold: number }) {
  const remaining = threshold - sessionCount
  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-dim)', borderRadius: 12, padding: '18px 20px' }}>
      <p style={{ fontSize: 12.5, color: 'var(--text-4)', margin: '0 0 10px', lineHeight: 1.6 }}>
        Decision Rules extracts the implicit principles you follow across decisions —
        the rules you&apos;ve never written down but consistently apply.
        {' '}{remaining === 1 ? 'One more decision to unlock.' : `${remaining} more decisions to unlock.`}
      </p>
      <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
        {Array.from({ length: threshold }).map((_, i) => (
          <div key={i} style={{ width: 16, height: 3, borderRadius: 2, background: i < sessionCount ? 'var(--gold)' : 'var(--border-mid)', opacity: i < sessionCount ? 1 : 0.3, transition: 'background 0.3s' }} />
        ))}
        <span style={{ fontSize: 10, color: 'var(--text-4)', marginLeft: 6, fontVariantNumeric: 'tabular-nums' }}>
          {sessionCount}/{threshold}
        </span>
      </div>
    </div>
  )
}

// ── Rules display with expand/collapse ───────────────────────────────────────

const RULES_INITIAL = 5

function RulesDisplay({ rules, basedOnDecisions }: { rules: string[]; basedOnDecisions: number }) {
  const [expanded, setExpanded] = useState(false)
  const visibleRules = expanded ? rules : rules.slice(0, RULES_INITIAL)
  const hiddenCount  = Math.max(0, rules.length - RULES_INITIAL)

  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-mid)', borderRadius: 12, padding: '22px 22px 18px', position: 'relative', overflow: 'hidden' }}>
      {/* Top accent */}
      <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: 2, background: 'linear-gradient(90deg, var(--gold-dim) 0%, transparent 60%)' }} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
        {visibleRules.map((rule, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 14, padding: '11px 0', borderBottom: i < visibleRules.length - 1 ? '1px solid var(--border-dim)' : 'none' }}>
            <div style={{ width: 3, minHeight: 20, borderRadius: 2, background: 'var(--gold-dim)', flexShrink: 0, alignSelf: 'stretch', marginTop: 2 }} />
            <p style={{ fontSize: 13.5, color: 'var(--text-1)', lineHeight: 1.55, margin: 0 }}>{rule}</p>
          </div>
        ))}
      </div>

      {/* Expand / collapse */}
      {hiddenCount > 0 && (
        <button
          onClick={() => setExpanded(e => !e)}
          style={{
            display: 'flex', alignItems: 'center', gap: 7, marginTop: 12,
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
          {expanded ? 'Show fewer rules' : `Show ${hiddenCount} more rule${hiddenCount !== 1 ? 's' : ''}`}
        </button>
      )}

      <p style={{ fontSize: 10, color: 'var(--text-4)', margin: '14px 0 0', lineHeight: 1.5 }}>
        Extracted from {basedOnDecisions} decision{basedOnDecisions !== 1 ? 's' : ''} · based on your Examiner responses and challenges to the Council
      </p>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

const RULES_SESSION_THRESHOLD = 8

export default function DecisionRules({ authToken, sessionCount }: Props) {
  const [data,    setData]    = useState<RulesData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(false)

  const belowThreshold = sessionCount < RULES_SESSION_THRESHOLD

  useEffect(() => {
    if (belowThreshold) { setLoading(false); return }
    let cancelled = false
    const fetch_ = async () => {
      try {
        const res = await fetch('/api/mirror/rules', { headers: { Authorization: `Bearer ${authToken}` } })
        if (!res.ok) { if (!cancelled) setError(true); return }
        const json = await res.json() as RulesData
        if (!cancelled) setData(json)
      } catch {
        if (!cancelled) setError(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    fetch_()
    return () => { cancelled = true }
  }, [authToken, belowThreshold])

  if (belowThreshold) return <ThresholdGate sessionCount={sessionCount} threshold={RULES_SESSION_THRESHOLD} />
  if (loading) return <RulesSkeleton />

  if (error) {
    return (
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-dim)', borderRadius: 12, padding: '18px 20px' }}>
        <p style={{ fontSize: 12.5, color: 'var(--text-4)', margin: 0, lineHeight: 1.6 }}>
          Decision Rules temporarily unavailable. Your data is intact — try refreshing in a moment.
        </p>
      </div>
    )
  }

  if (data?.rules === null) {
    if (data.reason === 'insufficient_examiner_data') {
      return (
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-dim)', borderRadius: 12, padding: '18px 20px' }}>
          <p style={{ fontSize: 12.5, color: 'var(--text-4)', margin: 0, lineHeight: 1.6 }}>
            Not enough Examiner data yet to extract rules. When you answer the Examiner questions
            in depth — rather than skipping — this section populates with the patterns in your reasoning.
          </p>
        </div>
      )
    }
    return <ThresholdGate sessionCount={data.sessionCount} threshold={data.threshold ?? RULES_SESSION_THRESHOLD} />
  }

  if (data?.rules && data.rules.length > 0) {
    return <RulesDisplay rules={data.rules} basedOnDecisions={data.basedOnDecisions ?? sessionCount} />
  }

  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-dim)', borderRadius: 12, padding: '18px 20px' }}>
      <p style={{ fontSize: 12.5, color: 'var(--text-4)', margin: 0, lineHeight: 1.6 }}>
        Rules are still forming. Continue engaging with the Examiner phase in depth — your patterns will emerge over the next few decisions.
      </p>
    </div>
  )
}

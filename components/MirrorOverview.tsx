'use client'

// components/MirrorOverview.tsx
// ── v16 Phase 4: the Mirror, answered as three questions ─────────────────────
//
//   What has Quorum learned about how I decide?   (learned)
//   What should I watch for?                      (watch)
//   What could I do differently next time?        (next)
//
// Two forms of one thing:
//   full      on /mirror, above the existing sections. Every insight shows how much evidence it rests on and, for the
//             signed-in owner, the decisions behind it. This is the free, evidence-backed preview: it is not behind the paywall.
//   compact   on the Desk. The single strongest "learned" or "watch" insight and nothing else, so it reads as a quiet note,
//             not a dashboard. Never shows the decisions behind it (it can be loaded by an anonymous session id).
//
// Rules this component keeps (tests/v16-mirror-intake.test.ts):
//   - It shows only what /api/mirror/overview returns. It adds no claims of its own.
//   - Empty is honest: it says nothing solid yet and what would change that. It never fills the space.
//   - Early evidence is labelled early. Nothing here says Quorum knows or understands the person.

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { emptyOverviewLine } from '@/lib/mirror-insights'
import type { Confidence, Insight, MirrorOverviewData } from '@/lib/mirror-insights'
import { track } from '@/lib/track'

type Mode = 'owner' | 'session'
interface Loaded extends MirrorOverviewData { mode: Mode }

interface Props {
  /** Signed-in owner: gets the decisions behind each insight. */
  authToken?:  string | null
  /** Anonymous (or Desk): identified by a session id on this device. */
  sessionId?:  string | null
  /** The device id, so a signed-in owner also sees decisions that only share this device. */
  deviceId?:   string | null
  surface:     'mirror' | 'desk'
  compact?:    boolean
  /** Desk only: whether this person can open the Mirror (decides the wording of the link under the insight). */
  signedIn?:   boolean
  /** Mirror only: the deeper sections follow, so say so. */
  hasDetail?:  boolean
}

const card: React.CSSProperties = {
  background: 'var(--bg-card)', border: '1px solid var(--border-dim)', borderRadius: 12, padding: '14px 16px', textAlign: 'left',
}
const groupLabel: React.CSSProperties = { fontSize: 12.5, color: 'var(--text-3)', margin: '0 0 8px', letterSpacing: '0.01em' }

const CONF_LABEL: Record<Confidence, string> = { early: 'Early', emerging: 'Emerging', established: 'Established', fact: 'On your record' }

function ConfidenceChip({ c }: { c: Confidence }) {
  return (
    <span style={{
      display: 'inline-block', fontSize: 10.5, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '2px 8px',
      borderRadius: 999, border: '1px solid var(--border-mid)', color: c === 'established' ? 'var(--gold)' : 'var(--text-3)',
    }}>
      {CONF_LABEL[c]}
    </span>
  )
}

function InsightCard({ insight, mode, surface }: { insight: Insight; mode: Mode; surface: Props['surface'] }) {
  const [open, setOpen] = useState(false)
  const canList = mode === 'owner' && insight.evidence.length > 0
  return (
    <div style={card}>
      <div style={{ marginBottom: 8 }}><ConfidenceChip c={insight.confidence} /></div>
      <p style={{ fontSize: 15, lineHeight: 1.5, color: 'var(--text-1)', margin: '0 0 6px' }}>{insight.claim}</p>
      <p style={{ fontSize: 12.5, lineHeight: 1.5, color: 'var(--text-3)', margin: 0 }}>{insight.confidenceNote}</p>

      {canList ? (
        <>
          <button
            type="button"
            aria-expanded={open}
            onClick={() => {
              if (!open) track('mirror_insight_expanded', { kind: insight.kind, confidence: insight.confidence, surface })
              setOpen(o => !o)
            }}
            style={{ marginTop: 10, minHeight: 44, padding: 0, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, color: 'var(--gold)', fontWeight: 600 }}
          >
            {open ? 'Hide the decisions' : `Based on ${insight.evidenceCount} ${insight.evidenceCount === 1 ? 'decision' : 'decisions'}`}
          </button>
          {open && (
            <ul style={{ listStyle: 'none', margin: '4px 0 0', padding: 0 }}>
              {insight.evidence.map(e => (
                <li key={e.id} style={{ borderTop: '1px solid var(--border-dim)' }}>
                  <Link href={`/record/${e.id}`} style={{ display: 'block', padding: '10px 0', textDecoration: 'none', color: 'var(--text-2)', fontSize: 13.5, lineHeight: 1.4, minHeight: 44, boxSizing: 'border-box' }}>
                    {e.label}
                    <span style={{ display: 'block', fontSize: 11.5, color: 'var(--text-4)', marginTop: 2 }}>
                      {new Date(e.created_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <p style={{ fontSize: 12, color: 'var(--text-4)', margin: '10px 0 0' }}>
          Based on {insight.evidenceCount} {insight.evidenceCount === 1 ? 'decision' : 'decisions'}.
          {mode === 'session' ? ' Sign in to see which ones.' : ''}
        </p>
      )}

      {insight.nextTime && (
        <p style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--text-2)', margin: '12px 0 0', paddingLeft: 10, borderLeft: '2px solid var(--gold-dim)' }}>
          <span style={{ color: 'var(--text-4)' }}>Try next time: </span>{insight.nextTime}
        </p>
      )}
    </div>
  )
}

export default function MirrorOverview({ authToken, sessionId, deviceId, surface, compact = false, signedIn = false, hasDetail = false }: Props) {
  const [data, setData] = useState<Loaded | null>(null)
  const [failed, setFailed] = useState(false)
  const viewed = useRef(false)

  useEffect(() => {
    if (!authToken && !sessionId) return
    let cancelled = false
    const url = authToken
      ? `/api/mirror/overview${deviceId ? `?did=${encodeURIComponent(deviceId)}` : ''}`
      : `/api/mirror/overview?sid=${encodeURIComponent(sessionId as string)}`
    fetch(url, authToken ? { headers: { Authorization: `Bearer ${authToken}` } } : undefined)
      .then(r => r.json())
      .then((d: Loaded) => { if (!cancelled) setData(d) })
      .catch(() => { if (!cancelled) setFailed(true) })
    return () => { cancelled = true }
  }, [authToken, sessionId, deviceId])

  useEffect(() => {
    if (!data || viewed.current) return
    viewed.current = true
    track('mirror_overview_viewed', { surface, total_count: data.decisionCount, learned_count: data.learned.length, watch_count: data.watch.length, mode: data.mode })
  }, [data, surface])

  if (failed || !data) return null

  // ── Desk: one quiet note ────────────────────────────────────────────────────
  if (compact) {
    // The Desk already lists check-ins that are due, so skip that insight here rather than say it twice.
    const pool = [...data.learned, ...data.watch.filter(i => i.kind !== 'checkins_due')].sort((a, b) => b.strength - a.strength)
    const top = pool[0]
    if (!top) return null
    return (
      <div style={{ ...card, borderColor: 'var(--gold-dim)' }}>
        <p style={{ fontSize: 11, letterSpacing: '0.06em', color: 'var(--text-4)', margin: '0 0 6px' }}>Quorum noticed</p>
        <p style={{ fontSize: 14.5, lineHeight: 1.5, color: 'var(--text-1)', margin: '0 0 6px' }}>{top.claim}</p>
        <p style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--text-3)', margin: 0 }}>{top.confidenceNote}</p>
        <Link
          href="/mirror"
          onClick={() => track('nav_clicked', { to: 'mirror', surface: 'desk_insight' })}
          style={{ display: 'inline-block', marginTop: 8, minHeight: 32, lineHeight: '32px', fontSize: 13, color: 'var(--gold)', textDecoration: 'none', fontWeight: 600 }}
        >
          {signedIn ? 'See the decisions behind it' : 'Sign in to see the decisions behind it'}
        </Link>
      </div>
    )
  }

  // ── Mirror: the three questions ────────────────────────────────────────────
  const empty = data.learned.length === 0 && data.watch.length === 0
  return (
    <section aria-label="What Quorum has learned" style={{ maxWidth: 680, margin: '0 auto 28px', display: 'flex', flexDirection: 'column', gap: 20 }}>
      {empty && (
        <div style={card}>
          <p style={{ fontSize: 14.5, lineHeight: 1.55, color: 'var(--text-2)', margin: 0 }}>{emptyOverviewLine(data.decisionCount)}</p>
        </div>
      )}

      {data.learned.length > 0 && (
        <div>
          <p style={groupLabel}>What Quorum has learned about how you decide</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {data.learned.map(i => <InsightCard key={i.id} insight={i} mode={data.mode} surface={surface} />)}
          </div>
        </div>
      )}

      {data.watch.length > 0 && (
        <div>
          <p style={groupLabel}>What to watch for</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {data.watch.map(i => <InsightCard key={i.id} insight={i} mode={data.mode} surface={surface} />)}
          </div>
        </div>
      )}

      {data.next.length > 0 && (
        <div>
          <p style={groupLabel}>What to try next time</p>
          <ol style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {data.next.map(n => (
              <li key={n.fromInsightId} style={{ fontSize: 14, lineHeight: 1.55, color: 'var(--text-1)' }}>{n.text}</li>
            ))}
          </ol>
        </div>
      )}

      {hasDetail && (
        <p style={{ fontSize: 12.5, color: 'var(--text-4)', margin: 0 }}>
          The full detail behind your Mirror follows below.
        </p>
      )}
    </section>
  )
}

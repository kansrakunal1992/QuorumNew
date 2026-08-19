'use client'
// QuorumReadCard — "Quorum's Read" — PR7.
//
// Shown once, right after Examiner completes, only when readiness allows
// the Council to actually run (NOT_READY is handled separately by
// SynthesisCard's "Not ready to call" banner — this screen would be
// redundant with it, so it never renders in that case; see SessionView.tsx's
// gating). Gate: totalSessionCount <= 3, same window as OntologyRevealCard
// and OpeningCeremonyCard — this is deliberately a first-few-sessions
// orientation aid, not a permanent step. Returning users already know how
// Council works; showing it every session would turn a legibility aid into
// friction, which is exactly the failure mode the audit's risk-check
// flagged for over-explaining.
//
// Sequencing on sessions 1–3: Decision X-Ray (quick dimension chips, auto,
// ~5s) → Quorum's Read (this — substantive, manual continue) → Opening
// Ceremony (brief ritual "convening" beat, auto, ~6s) → advisors stream.
// Unlike the two auto-dismissing cards around it, this one waits for the
// user to actually click through — it's real content someone should read
// once, not a decorative transition.
//
// Unlike telling the user "Quorum reads decision structure before
// answering" in prose (tried once already, with Nancy — didn't land), this
// screen demonstrates it: a specific, checkable read of THIS decision,
// including a prediction (tensionPrediction) the user can watch resolve or
// not once the advisors actually speak.

import { useState, useEffect, useRef } from 'react'
import { PERSONAS } from '@/lib/personas'
import { readinessLabel } from '@/lib/quorum-read'
import type { TensionPrediction } from '@/lib/quorum-read'

interface QuorumReadData {
  available: boolean
  readiness?: 'NOT_READY' | 'READY_WITH_CAVEATS' | 'READY'
  unresolvedImportantCount?: number
  tensionPrediction?: TensionPrediction | null
  summary?: {
    yourDecision:   string
    whatMatters:    string
    keyConstraints: string
    tension:        string
  } | null
}

interface Props {
  sessionId: string
  onContinue: () => void
}

const READINESS_COLOR: Record<string, string> = {
  READY:              'var(--text-3)',
  READY_WITH_CAVEATS: 'var(--gold)',
}

export default function QuorumReadCard({ sessionId, onContinue }: Props) {
  const [data,    setData]    = useState<QuorumReadData | null>(null)
  const [loading, setLoading] = useState(true)
  const onContinueRef = useRef(onContinue)
  useEffect(() => { onContinueRef.current = onContinue }, [onContinue])

  useEffect(() => {
    let cancelled = false
    fetch(`/api/session/${sessionId}/quorum-read`)
      .then(res => res.json())
      .then((json: QuorumReadData) => {
        if (cancelled) return
        setData(json)
        setLoading(false)
        // If ontology data wasn't available at all (e.g. an old session, or
        // the tagger hasn't finished), don't block the flow on an empty
        // screen — skip straight through.
        if (!json.available) onContinueRef.current()
      })
      .catch(() => {
        if (cancelled) return
        setLoading(false)
        onContinueRef.current()   // fail open — never block the Council on this screen
      })
    return () => { cancelled = true }
  }, [sessionId])

  if (loading) {
    return (
      <div className="sv-fade sv-fade-2" style={{
        background: 'var(--bg-card)', border: '1px solid var(--border-mid)',
        borderRadius: 13, padding: '20px', marginBottom: 12,
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <span style={{
          width: 14, height: 14, borderRadius: '50%',
          border: '2px solid var(--border-mid)', borderTopColor: 'var(--gold)',
          animation: 'spin 0.8s linear infinite',
        }} />
        <span style={{ fontSize: 13, color: 'var(--text-3)' }}>Reading the structure of your decision…</span>
      </div>
    )
  }

  if (!data?.available) return null   // already advanced via onContinueRef above

  const { summary, tensionPrediction, readiness, unresolvedImportantCount = 0 } = data
  const readinessInfo = readiness ? { ...readinessLabel(readiness), color: READINESS_COLOR[readiness] ?? 'var(--text-3)' } : undefined

  return (
    <div className="sv-fade sv-fade-2" style={{
      background: 'var(--bg-card)', border: '1px solid var(--border-mid)',
      borderRadius: 14, marginBottom: 12, overflow: 'hidden',
    }}>
      <div style={{
        padding: '14px 20px 12px', borderBottom: '1px solid var(--border-dim)',
        background: 'var(--gold-glow)', borderRadius: '13px 13px 0 0',
      }}>
        <p style={{
          fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700,
          letterSpacing: '0.12em', textTransform: 'uppercase',
          color: 'var(--text-4)', margin: 0,
        }}>
          Quorum's Read
        </p>
      </div>

      <div style={{ padding: '20px 24px 22px' }}>
        {summary ? (
          <>
            <p style={{ fontSize: 15, fontWeight: 500, color: 'var(--text-1)', lineHeight: 1.65, margin: '0 0 16px' }}>
              {summary.yourDecision}
            </p>

            <div style={{ display: 'grid', gap: 12, marginBottom: 16 }}>
              <div>
                <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-4)', margin: '0 0 4px' }}>
                  What seems to matter
                </p>
                <p style={{ fontSize: 13.5, color: 'var(--text-2)', margin: 0, lineHeight: 1.6 }}>{summary.whatMatters}</p>
              </div>
              <div>
                <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-4)', margin: '0 0 4px' }}>
                  Key constraints
                </p>
                <p style={{ fontSize: 13.5, color: 'var(--text-2)', margin: 0, lineHeight: 1.6 }}>{summary.keyConstraints}</p>
              </div>
              <div>
                <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-4)', margin: '0 0 4px' }}>
                  Decision tension
                </p>
                <p style={{ fontSize: 13.5, color: 'var(--text-2)', margin: 0, lineHeight: 1.6 }}>{summary.tension}</p>
              </div>
            </div>
          </>
        ) : (
          // Fallback if the AI summary call failed — still honest, still useful,
          // just without the plain-English prose layer.
          <p style={{ fontSize: 14, color: 'var(--text-2)', lineHeight: 1.7, margin: '0 0 16px' }}>
            The Council has read the structure of this decision and is ready to weigh in.
          </p>
        )}

        {tensionPrediction && (
          <p style={{ fontSize: 12.5, color: 'var(--text-3)', fontStyle: 'italic', lineHeight: 1.6, margin: '0 0 16px', paddingTop: 14, borderTop: '1px solid var(--border-dim)' }}>
            Watch for real disagreement between <strong style={{ color: 'var(--text-2)', fontStyle: 'normal' }}>{PERSONAS[tensionPrediction.advisorA].label}</strong> and <strong style={{ color: 'var(--text-2)', fontStyle: 'normal' }}>{PERSONAS[tensionPrediction.advisorB].label}</strong> — on {tensionPrediction.axis}. If they end up agreeing, that itself is worth noticing.
          </p>
        )}

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          {readinessInfo ? (
            <p style={{ fontSize: 12, color: readinessInfo.color, margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span>{readinessInfo.emoji}</span>
              <span>
                {readinessInfo.text}
                {readiness === 'READY_WITH_CAVEATS' && unresolvedImportantCount > 0 && (
                  <span style={{ color: 'var(--text-4)' }}> — carried forward, not dropped</span>
                )}
              </span>
            </p>
          ) : <span />}

          <button
            onClick={onContinue}
            style={{
              padding: '9px 20px', borderRadius: 8,
              border: '1px solid var(--border-mid)',
              background: 'var(--gold)', color: 'var(--bg-page)',
              fontSize: 13, fontWeight: 600, cursor: 'pointer',
              fontFamily: 'inherit', letterSpacing: '0.01em',
            }}
          >
            Pressure-test it →
          </button>
        </div>
      </div>
    </div>
  )
}

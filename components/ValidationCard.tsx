'use client'
// components/ValidationCard.tsx
// SB-1 → Enrichment Sprint
// Surfaces Quorum's session read + cross-session context lines that scale with
// the user's decision count. Tier 0 (1-2 sessions) = single-session read only.
// Tier 3 (25+ sessions) = full fingerprint with confirmed patterns.
//
// Signal + contextLines + tier + sessionCount all come from the API;
// nothing is derived client-side. totalSessionCount prop kept as a load-time
// fallback for the accumulation teaser before the API resolves.

import { useState, useEffect } from 'react'
import { getOrCreateDeviceId } from '@/lib/storage'

interface Props {
  sessionId:          string
  authToken:          string | null
  userEmail?:         string | null
  totalSessionCount?: number          // server-provided estimate; API value takes precedence
}

type Stage = 'loading' | 'hidden' | 'idle' | 'correcting' | 'done_confirmed' | 'done_corrected'
type Tier  = 0 | 1 | 2 | 3

// ── Copy helpers ─────────────────────────────────────────────────────────────

function getAccumulationMessage(
  sessionCount: number,
  tier:         Tier,
  stage:        'confirmed' | 'corrected',
): string {
  if (stage === 'corrected') {
    return "That correction is more useful than agreement. Quorum builds its read from what you tell it — your next session opens knowing something this one didn't."
  }
  if (tier === 0) {
    return "Patterns only form with data. After 3 decisions, the Council starts connecting them. After 10, it builds from your specific history — not population averages."
  }
  if (tier === 1) {
    const toNext = 10 - sessionCount
    return toNext > 0
      ? `${sessionCount} decisions logged. ${toNext} more to activate calibration tracking and decision-type pattern analysis.`
      : `${sessionCount} decisions logged. Your bias patterns are active — the Council is building a picture that's specific to you.`
  }
  if (tier === 2) {
    const toNext = 25 - sessionCount
    return `${sessionCount} decisions in your Quorum record.${toNext > 0 ? ` ${toNext} more to your full fingerprint.` : ''} Bias patterns and calibration direction are both active inputs into how the Council reads you.`
  }
  // Tier 3: 25+
  return `Decision ${sessionCount} logged. Your Quorum fingerprint is fully active — the Council draws on your specific history, not just today's session.`
}

function getIdleTeaserLine(sessionCount: number, tier: Tier): string {
  if (tier === 0) {
    const toTier1 = 3 - sessionCount
    return toTier1 > 0
      ? `${sessionCount <= 1 ? 'First session read.' : `${sessionCount} decisions in.`} ${toTier1} more before cross-session patterns begin forming.`
      : "Your Council is building a picture from your history — patterns are starting to emerge."
  }
  if (tier === 1) {
    return `${sessionCount} decisions logged. Bias patterns are forming — ${10 - sessionCount} more to activate calibration tracking.`
  }
  if (tier === 2) {
    return `${sessionCount} decisions in your record. Bias fingerprint and calibration direction are both active.`
  }
  return `Decision ${sessionCount}. Your full Quorum fingerprint is active.`
}

// ── Component ────────────────────────────────────────────────────────────────

export default function ValidationCard({
  sessionId,
  authToken,
  userEmail,
  totalSessionCount,
}: Props) {
  const [stage,        setStage]        = useState<Stage>('loading')
  const [signalLine,   setSignalLine]   = useState<string | null>(null)
  const [archetype,    setArchetype]    = useState<string | null>(null)
  const [contextLines, setContextLines] = useState<string[]>([])
  const [tier,         setTier]         = useState<Tier>(0)
  const [sessionCount, setSessionCount] = useState(totalSessionCount ?? 1)
  const [correction,   setCorrection]   = useState('')
  const [submitting,   setSubmitting]   = useState(false)

  useEffect(() => {
    const headers: Record<string, string> = {}
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`

    fetch(`/api/session/${sessionId}/validation-signal`, { headers })
      .then(r => r.ok ? r.json() : null)
      .then((data: {
        signal: {
          line:         string
          archetype:    string | null
          contextLines: string[]
          tier:         Tier
          sessionCount: number
        } | null
        already_validated?: boolean
      } | null) => {
        if (!data?.signal || data.already_validated) { setStage('hidden'); return }
        setSignalLine(data.signal.line)
        setArchetype(data.signal.archetype)
        setContextLines(data.signal.contextLines ?? [])
        setTier(data.signal.tier ?? 0)
        setSessionCount(data.signal.sessionCount ?? totalSessionCount ?? 1)
        setStage('idle')
      })
      .catch(() => setStage('hidden'))
  }, [sessionId, authToken, totalSessionCount])

  const callValidate = async (
    validation_state: 'confirmed' | 'corrected',
    correction_text?: string,
  ) => {
    setSubmitting(true)
    try {
      await fetch('/api/session/validate', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id:                   sessionId,
          validation_state,
          validation_emotion_confirmed: validation_state === 'confirmed',
          validation_correction:        correction_text ?? null,
          device_id:                    getOrCreateDeviceId(),
          user_email:                   userEmail ?? null,
        }),
      })
    } catch { /* best-effort */ }
    finally { setSubmitting(false) }
  }

  const handleConfirm = async () => {
    await callValidate('confirmed')
    setStage('done_confirmed')
  }

  const handleCorrectionSubmit = async () => {
    if (!correction.trim()) return
    await callValidate('corrected', correction.trim())
    setStage('done_corrected')
  }

  if (stage === 'loading' || stage === 'hidden') return null

  const archetypeLabel = archetype
    ? archetype.charAt(0).toUpperCase() + archetype.slice(1)
    : null

  // ── Done states ───────────────────────────────────────────────────────────
  if (stage === 'done_confirmed' || stage === 'done_corrected') {
    const confirmed    = stage === 'done_confirmed'
    const accumulation = getAccumulationMessage(sessionCount, tier, confirmed ? 'confirmed' : 'corrected')
    return (
      <div style={{
        borderRadius: 14, padding: '18px 20px',
        background: 'var(--bg-card)', border: '1px solid var(--border-dim)',
        borderLeft: '3px solid var(--gold)', marginTop: 20,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <span style={{ fontSize: 13, color: 'var(--gold)' }}>✓</span>
          <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-2)', margin: 0 }}>
            {confirmed ? 'Noted.' : 'Correction saved.'}
            {archetypeLabel ? ` Added to your ${archetypeLabel} pattern.` : ' Added to your Quorum fingerprint.'}
          </p>
        </div>
        <p style={{ fontSize: 12.5, color: 'var(--text-3)', lineHeight: 1.6, margin: 0 }}>
          {accumulation}
        </p>
      </div>
    )
  }

  // ── Correcting state ──────────────────────────────────────────────────────
  if (stage === 'correcting') {
    return (
      <div style={{
        borderRadius: 14, padding: '18px 20px',
        background: 'var(--bg-card)', border: '1px solid var(--border-dim)',
        borderLeft: '3px solid #8840c4', marginTop: 20,
      }}>
        <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-2)', margin: '0 0 10px' }}>
          What did we miss?
        </p>
        <p style={{ fontSize: 12, color: 'var(--text-4)', lineHeight: 1.5, margin: '0 0 12px' }}>
          A correction here directly shapes how the Council reads your next decision.
        </p>
        <textarea
          value={correction}
          onChange={e => setCorrection(e.target.value)}
          placeholder="What was actually driving this decision…"
          rows={3}
          style={{
            width: '100%', background: 'var(--bg-inset)',
            border: '1px solid var(--border-dim)', borderRadius: 8,
            padding: '10px 12px', fontSize: 13, color: 'var(--text-1)',
            fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box',
            outline: 'none', lineHeight: 1.55, marginBottom: 12,
          }}
          autoFocus
        />
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={handleCorrectionSubmit}
            disabled={!correction.trim() || submitting}
            style={{
              padding: '9px 18px', borderRadius: 8,
              background: correction.trim() ? '#8840c4' : 'var(--bg-inset)',
              border: `1px solid ${correction.trim() ? '#8840c4' : 'var(--border-dim)'}`,
              color: correction.trim() ? '#fff' : 'var(--text-4)',
              fontSize: 13, fontWeight: 600, cursor: correction.trim() ? 'pointer' : 'default',
              fontFamily: 'inherit', transition: 'all 0.15s',
            }}
          >
            {submitting ? 'Saving…' : 'Save correction'}
          </button>
          <button
            type="button"
            onClick={() => setStage('idle')}
            style={{
              padding: '9px 14px', borderRadius: 8, background: 'none',
              border: '1px solid var(--border-dim)', color: 'var(--text-4)',
              fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            Back
          </button>
        </div>
      </div>
    )
  }

  // ── Idle state ────────────────────────────────────────────────────────────
  return (
    <div style={{
      borderRadius: 14, padding: '18px 20px',
      background: 'var(--bg-card)', border: '1px solid var(--border-dim)',
      borderLeft: '3px solid var(--gold-dim)', marginTop: 20,
      animation: 'fadeIn 0.3s ease',
    }}>

      {/* Label */}
      <p style={{
        fontSize: 10, fontWeight: 700, color: 'var(--text-4)',
        letterSpacing: '0.1em', textTransform: 'uppercase', margin: '0 0 10px',
      }}>
        Quorum&apos;s read
      </p>

      {/* Main signal line */}
      <p style={{
        fontSize: 15, fontWeight: 600, color: 'var(--text-1)',
        lineHeight: 1.45, margin: '0 0 6px',
      }}>
        {signalLine}
      </p>

      <p style={{ fontSize: 12, color: 'var(--text-4)', lineHeight: 1.5, margin: '0 0 14px' }}>
        Does that land? Your response helps the Council read you more precisely next time.
      </p>

      {/* ── Cross-session context lines (tier 1+) ─────────────────────────── */}
      {/* Each line is a cross-session pattern observation — bias history,      */}
      {/* calibration direction, or decision-type frequency. Absent at tier 0. */}
      {contextLines.length > 0 && (
        <div style={{
          background: 'var(--bg-inset)',
          borderRadius: 8,
          padding: '10px 14px',
          marginBottom: 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 7,
        }}>
          <p style={{
            fontSize: 10, fontWeight: 700, color: 'var(--text-4)',
            letterSpacing: '0.08em', textTransform: 'uppercase', margin: '0 0 2px',
          }}>
            Across your sessions
          </p>
          {contextLines.map((line, i) => (
            <p key={i} style={{
              fontSize: 12, color: 'var(--text-3)', lineHeight: 1.6, margin: 0,
            }}>
              — {line}
            </p>
          ))}
        </div>
      )}

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={submitting}
          style={{
            padding: '9px 18px', borderRadius: 8,
            background: 'color-mix(in srgb, var(--gold) 12%, transparent)',
            border: '1px solid var(--gold-dim)',
            color: 'var(--gold)', fontSize: 13, fontWeight: 600,
            cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s',
          }}
        >
          Yes, that&apos;s accurate
        </button>
        <button
          type="button"
          onClick={() => setStage('correcting')}
          style={{
            padding: '9px 16px', borderRadius: 8, background: 'transparent',
            border: '1px solid var(--border-dim)', color: 'var(--text-3)',
            fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s',
          }}
        >
          Not quite — correct it
        </button>
      </div>

      {/* Accumulation teaser — scales with tier */}
      <p style={{
        fontSize: 11, color: 'var(--text-4)', lineHeight: 1.55,
        margin: '14px 0 0', borderTop: '1px solid var(--border-dim)', paddingTop: 12,
      }}>
        {getIdleTeaserLine(sessionCount, tier)}
      </p>
    </div>
  )
}

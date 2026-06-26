'use client'
// components/ValidationCard.tsx
// SB-1: Post-synthesis validation hook.
// Appears after all personas complete in SessionView.
// Surfaces Quorum's emotional/archetype inference and asks the user to confirm or correct it.
// On interaction: shows forward hook with strong accumulation message to drive session 2.

import { useState, useEffect } from 'react'
import { getOrCreateDeviceId, getStoredSessionIds } from '@/lib/storage'

interface Props {
  sessionId:         string
  authToken:         string | null
  userEmail?:        string | null
  totalSessionCount?: number
}

type Stage = 'loading' | 'hidden' | 'idle' | 'correcting' | 'done_confirmed' | 'done_corrected'

function getAccumulationMessage(sessionCount: number, stage: 'confirmed' | 'corrected'): string {
  if (stage === 'corrected') {
    return "That correction is more useful than agreement. Quorum builds its read from what you tell it — your next session opens knowing something this one didn't."
  }
  // Confirmed — message scales with session count
  if (sessionCount <= 1) {
    return "Patterns only form with data. After 3 decisions, the Council starts connecting them. After 5, it builds from your specific history — not population averages."
  }
  if (sessionCount <= 2) {
    return `${sessionCount} decisions in. After 3, the Council begins surfacing what carries forward — the patterns beneath how you decide, not just what you decided.`
  }
  if (sessionCount <= 4) {
    const remaining = 5 - sessionCount
    return `${remaining} more decision${remaining === 1 ? '' : 's'} to activate structural pattern memory. The Council is building a picture specific to you.`
  }
  return "Added to your Quorum fingerprint. The Council now draws on your specific decision history, not just this session."
}

export default function ValidationCard({ sessionId, authToken, userEmail, totalSessionCount }: Props) {
  const [stage,       setStage]      = useState<Stage>('loading')
  const [signalLine,  setSignalLine]  = useState<string | null>(null)
  const [archetype,   setArchetype]   = useState<string | null>(null)
  const [correction,  setCorrection]  = useState('')
  const [submitting,  setSubmitting]  = useState(false)
  const [sessionCount, setSessionCount] = useState(totalSessionCount ?? 1)

  // Fetch the validation signal from the API
  useEffect(() => {
    const headers: Record<string, string> = {}
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`

    fetch(`/api/session/${sessionId}/validation-signal`, { headers })
      .then(r => r.ok ? r.json() : null)
      .then((data: { signal: { line: string; archetype: string | null } | null; already_validated?: boolean } | null) => {
        if (!data?.signal || data.already_validated) {
          setStage('hidden')
          return
        }
        setSignalLine(data.signal.line)
        setArchetype(data.signal.archetype)
        // Derive session count from localStorage if not passed from server
        if (!totalSessionCount) {
          try {
            const ids = getStoredSessionIds()
            setSessionCount(Math.max(ids.length, 1))
          } catch {}
        }
        setStage('idle')
      })
      .catch(() => setStage('hidden'))
  }, [sessionId, authToken, totalSessionCount])

  const callValidate = async (
    validation_state: 'confirmed' | 'corrected',
    correction_text?: string
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
    ? `${archetype.charAt(0).toUpperCase() + archetype.slice(1)}`
    : null

  // ── Done states ────────────────────────────────────────────────────────────
  if (stage === 'done_confirmed' || stage === 'done_corrected') {
    const isDone = stage === 'done_confirmed'
    const accumulation = getAccumulationMessage(sessionCount, isDone ? 'confirmed' : 'corrected')
    return (
      <div style={{
        borderRadius: 14,
        padding: '18px 20px',
        background: 'var(--bg-raised)',
        border: '1px solid var(--border-dim)',
        borderLeft: '3px solid var(--gold)',
        marginTop: 20,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <span style={{ fontSize: 13, color: 'var(--gold)' }}>✓</span>
          <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-2)', margin: 0 }}>
            {isDone ? 'Noted.' : 'Correction saved.'}
            {archetypeLabel ? ` Added to your ${archetypeLabel} pattern.` : ' Added to your Quorum fingerprint.'}
          </p>
        </div>
        <p style={{ fontSize: 12.5, color: 'var(--text-3)', lineHeight: 1.6, margin: 0 }}>
          {accumulation}
        </p>
      </div>
    )
  }

  // ── Correcting state ───────────────────────────────────────────────────────
  if (stage === 'correcting') {
    return (
      <div style={{
        borderRadius: 14,
        padding: '18px 20px',
        background: 'var(--bg-raised)',
        border: '1px solid var(--border-dim)',
        borderLeft: '3px solid #8840c4',
        marginTop: 20,
      }}>
        <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-2)', marginBottom: 10, margin: '0 0 10px' }}>
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
            width: '100%',
            background: 'var(--bg)',
            border: '1px solid var(--border-dim)',
            borderRadius: 8,
            padding: '10px 12px',
            fontSize: 13,
            color: 'var(--text-1)',
            fontFamily: 'inherit',
            resize: 'vertical',
            boxSizing: 'border-box',
            outline: 'none',
            lineHeight: 1.55,
            marginBottom: 12,
          }}
          autoFocus
        />
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={handleCorrectionSubmit}
            disabled={!correction.trim() || submitting}
            style={{
              padding: '9px 18px',
              borderRadius: 8,
              background: correction.trim() ? '#8840c4' : 'var(--bg)',
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

  // ── Idle state (main card) ─────────────────────────────────────────────────
  return (
    <div style={{
      borderRadius: 14,
      padding: '18px 20px',
      background: 'var(--bg-raised)',
      border: '1px solid var(--border-dim)',
      borderLeft: '3px solid var(--gold-dim)',
      marginTop: 20,
      animation: 'fadeIn 0.3s ease',
    }}>
      {/* Label */}
      <p style={{
        fontSize: 10, fontWeight: 700, color: 'var(--text-4)',
        letterSpacing: '0.1em', textTransform: 'uppercase', margin: '0 0 10px',
      }}>
        Quorum&apos;s read
      </p>

      {/* The one-liner */}
      <p style={{
        fontSize: 15, fontWeight: 600, color: 'var(--text-1)',
        lineHeight: 1.45, margin: '0 0 6px',
      }}>
        {signalLine}
      </p>
      <p style={{
        fontSize: 12, color: 'var(--text-4)', lineHeight: 1.5, margin: '0 0 16px',
      }}>
        Does that land? Your response helps the Council read you more precisely next time.
      </p>

      {/* Response buttons */}
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
            padding: '9px 16px', borderRadius: 8,
            background: 'transparent',
            border: '1px solid var(--border-dim)',
            color: 'var(--text-3)', fontSize: 13,
            cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s',
          }}
        >
          Not quite — correct it
        </button>
      </div>

      {/* Accumulation teaser — shown passively below buttons */}
      <p style={{
        fontSize: 11, color: 'var(--text-4)', lineHeight: 1.55,
        margin: '14px 0 0', borderTop: '1px solid var(--border-dim)', paddingTop: 12,
      }}>
        {sessionCount <= 1
          ? "This is your first session. Every decision you log after this makes the Council's read of you more specific — patterns in how you decide, not just what you decided."
          : sessionCount <= 4
            ? `${sessionCount} decisions in. After ${5 - sessionCount} more, the Council begins drawing directly from your decision history — not just what you've described today.`
            : "Your decision history is active. The Council is already drawing patterns from your record."}
      </p>
    </div>
  )
}

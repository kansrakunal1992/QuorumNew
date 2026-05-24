// components/VoiceInput.tsx
// Sprint 22a — voice input widget with real-time partial text preview
// ─────────────────────────────────────────────────────────────────────────────
// States rendered:
//   idle        → "Or speak your decision" + mic button
//   requesting  → spinner + "Requesting microphone access…"
//   ready       → particle sphere (static) + "Connected · start speaking"
//   recording   → particle sphere (animated) + live partial text (grey) + Stop
//   finalizing  → spinner + "Finalising…"
//   done        → ✓ Transcribed + Clean up + reset × 
//   error       → muted mic + concise message + Try again / dismiss
//
// Light + dark mode: 100% CSS variables — no hardcoded colors.
// ─────────────────────────────────────────────────────────────────────────────

'use client'

import { useEffect, useRef, useCallback, useState } from 'react'
import { useSoniox, VoiceErrorCode } from '@/hooks/useSoniox'

interface VoiceInputProps {
  onTranscript: (text: string) => void
}

function errorMessage(code: VoiceErrorCode | null): string {
  switch (code) {
    case 'PERMISSION_DENIED':   return 'Mic access denied · check browser settings'
    case 'NO_MICROPHONE':       return 'No microphone found on this device'
    case 'BROWSER_UNSUPPORTED': return 'Voice input not supported in this browser'
    case 'STT_QUOTA_EXCEEDED':  return 'Voice unavailable right now · try again later'
    case 'STT_PROVIDER_DOWN':   return 'Voice service temporarily down · try again later'
    case 'STT_NOT_CONFIGURED':  return 'Voice input not configured'
    case 'SESSION_NOT_FOUND':   return 'Voice unavailable · try again shortly'
    case 'EMPTY_TRANSCRIPT':    return 'Nothing detected · please try again'
    default:                    return 'Voice unavailable · try again shortly'
  }
}

// ── Particle sphere ───────────────────────────────────────────────────────────
function ParticleSphere({
  amplitudeRef,
  active,
}: {
  amplitudeRef: React.MutableRefObject<number>
  active: boolean
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const frameRef  = useRef<number>(0)
  const angleRef  = useRef<number>(0)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    const SIZE = 80
    canvas.width  = SIZE * dpr
    canvas.height = SIZE * dpr
    canvas.style.width  = `${SIZE}px`
    canvas.style.height = `${SIZE}px`
    const ctx = canvas.getContext('2d')!
    ctx.scale(dpr, dpr)

    const N = 90, PHI = Math.PI * (3 - Math.sqrt(5))
    const pts: [number, number, number][] = Array.from({ length: N }, (_, i) => {
      const y = 1 - (i / (N - 1)) * 2
      const r = Math.sqrt(1 - y * y)
      const t = PHI * i
      return [Math.cos(t) * r, y, Math.sin(t) * r]
    })

    const getGoldRgb = (): [number, number, number] => {
      const hex = getComputedStyle(document.documentElement)
        .getPropertyValue('--gold').trim().replace('#', '')
      if (hex.length === 6) return [
        parseInt(hex.slice(0, 2), 16),
        parseInt(hex.slice(2, 4), 16),
        parseInt(hex.slice(4, 6), 16),
      ]
      return [201, 168, 76]
    }

    const draw = () => {
      const amp = amplitudeRef.current
      const [r, g, b] = getGoldRgb()
      ctx.clearRect(0, 0, SIZE, SIZE)
      angleRef.current += active ? 0.006 + amp * 0.012 : 0.003

      const cos = Math.cos(angleRef.current)
      const sin = Math.sin(angleRef.current)
      const cx = SIZE / 2, cy = SIZE / 2, radius = 30

      pts
        .map(([px, py, pz]) => {
          const x3 = px * cos - pz * sin
          const z3 = px * sin + pz * cos
          const sc = 1 + z3 * 0.15
          return { sx: cx + x3 * radius * sc, sy: cy + py * radius * sc, depth: (z3 + 1) / 2 }
        })
        .sort((a, b) => a.depth - b.depth)
        .forEach(({ sx, sy, depth }) => {
          const baseR  = 0.8 + depth * 0.9
          const dotR   = active ? baseR * (1 + amp * 1.2) : baseR
          const baseA  = 0.15 + depth * 0.65
          const alpha  = active ? Math.min(1, baseA + amp * 0.35) : baseA
          ctx.beginPath()
          ctx.arc(sx, sy, dotR, 0, Math.PI * 2)
          ctx.fillStyle = `rgba(${r},${g},${b},${alpha.toFixed(2)})`
          ctx.fill()
        })

      frameRef.current = requestAnimationFrame(draw)
    }

    draw()
    return () => cancelAnimationFrame(frameRef.current)
  }, [active, amplitudeRef])

  return <canvas ref={canvasRef} style={{ display: 'block', borderRadius: '50%' }} aria-hidden />
}

// ── Icons ─────────────────────────────────────────────────────────────────────
const IconMic = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="2" width="6" height="12" rx="3"/>
    <path d="M5 10a7 7 0 0 0 14 0"/>
    <line x1="12" y1="19" x2="12" y2="22"/>
    <line x1="8" y1="22" x2="16" y2="22"/>
  </svg>
)
const IconStop = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
    <rect x="4" y="4" width="16" height="16" rx="2"/>
  </svg>
)
const IconSparkle = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z"/>
  </svg>
)
const IconX = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
)
const IconMicOff = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <line x1="2" y1="2" x2="22" y2="22"/>
    <path d="M18.89 13.23A7 7 0 0 0 19 12"/>
    <path d="M5 10a7 7 0 0 0 11.9 5.2"/>
    <path d="M15 9.34V5a3 3 0 0 0-5.68-1.33"/>
    <path d="M9 9v3a3 3 0 0 0 5.12 2.12"/>
    <line x1="12" y1="19" x2="12" y2="22"/>
    <line x1="8" y1="22" x2="16" y2="22"/>
  </svg>
)
const IconCheck = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12"/>
  </svg>
)
const Spinner = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2.5" strokeLinecap="round"
    style={{ animation: 'spin 0.8s linear infinite' }}>
    <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
  </svg>
)

// ── Shared style tokens ───────────────────────────────────────────────────────
const base: React.CSSProperties = {
  borderRadius: 10,
  border: '1px solid var(--border-dim)',
  background: 'var(--bg-inset)',
  transition: 'border-color 0.2s, background 0.2s',
  overflow: 'hidden',
}
const rowBase: React.CSSProperties = {
  ...base,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '8px 12px',
  minHeight: 44,
}
const centeredRow: React.CSSProperties = {
  ...base,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '10px 16px',
  gap: 10,
  minHeight: 44,
}
const stopBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 7,
  padding: '7px 18px', borderRadius: 7,
  border: '1px solid var(--border-mid)',
  background: 'transparent', color: 'var(--text-2)',
  cursor: 'pointer', fontSize: 12, fontFamily: 'inherit', transition: 'all 0.18s',
}
const dismissBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  width: 28, height: 28, borderRadius: 6,
  border: '1px solid var(--border-dim)',
  background: 'transparent', color: 'var(--text-4)',
  cursor: 'pointer', transition: 'all 0.18s',
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function VoiceInput({ onTranscript }: VoiceInputProps) {
  const { state, finalText, partialText, errorCode, amplitudeRef, start, stop, reset } = useSoniox()
  const [cleanupLoading, setCleanupLoading] = useState(false)
  const rawRef = useRef('')
  const onTranscriptRef = useRef(onTranscript)
  useEffect(() => { onTranscriptRef.current = onTranscript }, [onTranscript])

  // Push final tokens to textarea incrementally as they arrive
  useEffect(() => {
    if (finalText && (state === 'recording' || state === 'finalizing' || state === 'done')) {
      rawRef.current = finalText
      onTranscriptRef.current(finalText)
    }
  }, [finalText, state])

  const handleCleanup = useCallback(async () => {
    if (!rawRef.current || cleanupLoading) return
    setCleanupLoading(true)
    try {
      const res = await fetch('/api/voice/cleanup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw_transcript: rawRef.current }),
      })
      if (res.ok) {
        const { cleaned } = await res.json()
        if (cleaned) onTranscript(cleaned)
      }
    } catch { /* non-fatal — raw transcript stays in textarea */ }
    finally { setCleanupLoading(false) }
  }, [cleanupLoading, onTranscript])

  // ── IDLE ──────────────────────────────────────────────────────────────────
  if (state === 'idle') return (
    <div style={rowBase}>
      <span style={{ fontSize: 12, color: 'var(--text-4)', letterSpacing: '0.03em' }}>
        Or speak your decision
      </span>
      <button onClick={start} style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '6px 12px', borderRadius: 7,
        border: '1px solid var(--border-mid)',
        background: 'transparent', color: 'var(--text-3)',
        cursor: 'pointer', fontSize: 12, fontFamily: 'inherit', transition: 'all 0.18s',
      }}
        onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--gold-dim)'; e.currentTarget.style.color = 'var(--gold)' }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-mid)'; e.currentTarget.style.color = 'var(--text-3)' }}
      >
        <IconMic /> Voice input
      </button>
    </div>
  )

  // ── REQUESTING ────────────────────────────────────────────────────────────
  if (state === 'requesting') return (
    <div style={centeredRow}>
      <Spinner size={13} />
      <span style={{ fontSize: 12, color: 'var(--text-3)' }}>Requesting microphone access…</span>
    </div>
  )

  // ── READY (connected, not yet speaking) ───────────────────────────────────
  if (state === 'ready') return (
    <div style={{ ...base, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 16, gap: 10, borderColor: 'var(--border-mid)' }}>
      <ParticleSphere amplitudeRef={amplitudeRef} active={false} />
      <span style={{ fontSize: 12, color: 'var(--text-4)', letterSpacing: '0.04em' }}>
        Connected · start speaking
      </span>
      <button onClick={stop} style={stopBtn}><IconStop /> Stop</button>
    </div>
  )

  // ── RECORDING ─────────────────────────────────────────────────────────────
  if (state === 'recording') return (
    <div style={{ ...base, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 16, gap: 10, borderColor: 'var(--gold-dim)' }}>
      <ParticleSphere amplitudeRef={amplitudeRef} active={true} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--gold)', display: 'inline-block', animation: 'pulseGold 1.1s ease-in-out infinite' }} />
        <span style={{ fontSize: 12, color: 'var(--text-3)', letterSpacing: '0.04em' }}>Listening…</span>
      </div>

      {/* Live partial text — grey, replaced every Soniox response batch */}
      {partialText && (
        <div style={{
          width: '100%', fontSize: 12,
          color: 'var(--text-4)', fontStyle: 'italic',
          lineHeight: 1.5, textAlign: 'center',
          padding: '0 8px', minHeight: 18,
        }}>
          {partialText}
        </div>
      )}

      <button onClick={stop} style={stopBtn}><IconStop /> Stop recording</button>
    </div>
  )

  // ── FINALIZING ────────────────────────────────────────────────────────────
  if (state === 'finalizing') return (
    <div style={centeredRow}>
      <Spinner size={13} />
      <span style={{ fontSize: 12, color: 'var(--text-3)' }}>Finalising…</span>
    </div>
  )

  // ── DONE ──────────────────────────────────────────────────────────────────
  if (state === 'done') return (
    <div style={rowBase}>
      <span style={{ fontSize: 12, color: 'var(--text-4)', display: 'flex', alignItems: 'center', gap: 6 }}>
        <IconCheck /> Transcribed
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button onClick={handleCleanup} disabled={cleanupLoading} style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '5px 12px', borderRadius: 7,
          border: '1px solid var(--gold-dim)',
          background: 'rgba(201,168,76,0.07)',
          color: 'var(--gold)',
          cursor: cleanupLoading ? 'not-allowed' : 'pointer',
          fontSize: 12, fontFamily: 'inherit',
          opacity: cleanupLoading ? 0.6 : 1, transition: 'all 0.18s',
        }}>
          {cleanupLoading ? <Spinner size={12} /> : <IconSparkle />}
          {cleanupLoading ? 'Cleaning…' : 'Clean up'}
        </button>
        <button onClick={reset} style={dismissBtn}
          onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-2)'; e.currentTarget.style.borderColor = 'var(--border-mid)' }}
          onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-4)'; e.currentTarget.style.borderColor = 'var(--border-dim)' }}
        ><IconX /></button>
      </div>
    </div>
  )

  // ── ERROR — always graceful, no raw error codes ───────────────────────────
  const isHardError = errorCode === 'BROWSER_UNSUPPORTED' || errorCode === 'NO_MICROPHONE'
  return (
    <div style={rowBase}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ color: 'var(--text-4)', display: 'flex' }}><IconMicOff /></span>
        <span style={{ fontSize: 12, color: 'var(--text-4)', lineHeight: 1.4 }}>
          {errorMessage(errorCode)}
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {!isHardError && (
          <button onClick={reset} style={{
            display: 'flex', alignItems: 'center', gap: 5,
            padding: '5px 11px', borderRadius: 6,
            border: '1px solid var(--border-dim)',
            background: 'transparent', color: 'var(--text-3)',
            cursor: 'pointer', fontSize: 11, fontFamily: 'inherit', transition: 'all 0.18s',
          }}>Try again</button>
        )}
        <button onClick={reset} style={dismissBtn}><IconX /></button>
      </div>
    </div>
  )
}

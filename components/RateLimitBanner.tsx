'use client'
// components/RateLimitBanner.tsx
// ── Sprint 5 (S5-01) — Rate Limit Banner ─────────────────────────────────────
//
// Shown when any API call returns 429. Displays the server's human-readable
// message and a live countdown to the exact reset time.
//
// When the countdown hits zero, the banner clears and onExpired() fires
// so the parent component can re-enable inputs.
//
// Props:
//   message     — human-readable string from the 429 JSON body
//   resetAt     — Unix ms timestamp when the window resets (from 429 body)
//   onExpired   — called when countdown reaches zero
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useCallback } from 'react'

interface Props {
  message:   string
  resetAt:   number
  onExpired?: () => void
}

export default function RateLimitBanner({ message, resetAt, onExpired }: Props) {
  const getSecondsLeft = useCallback(
    () => Math.max(0, Math.ceil((resetAt - Date.now()) / 1000)),
    [resetAt]
  )

  const [secondsLeft, setSecondsLeft] = useState(getSecondsLeft)

  useEffect(() => {
    // Already expired by the time we mount
    if (secondsLeft <= 0) {
      onExpired?.()
      return
    }

    const interval = setInterval(() => {
      const remaining = getSecondsLeft()
      setSecondsLeft(remaining)
      if (remaining <= 0) {
        clearInterval(interval)
        onExpired?.()
      }
    }, 1000)

    return () => clearInterval(interval)
  }, [resetAt, getSecondsLeft, onExpired, secondsLeft])

  const mins = Math.floor(secondsLeft / 60)
  const secs = secondsLeft % 60
  const countdownStr =
    secondsLeft <= 0
      ? 'Ready — try again now'
      : mins > 0
        ? `${mins}m ${String(secs).padStart(2, '0')}s`
        : `${secs}s`

  const expired = secondsLeft <= 0

  return (
    <div style={{
      background:   'var(--bg-card)',
      border:       `1px solid ${expired ? 'rgba(74,222,128,0.3)' : 'var(--border-mid)'}`,
      borderLeft:   `3px solid ${expired ? 'rgba(74,222,128,0.8)' : 'var(--gold)'}`,
      borderRadius: 10,
      padding:      '12px 16px',
      display:      'flex',
      flexDirection: 'column',
      gap:          6,
      transition:   'border-color 0.3s',
    }}>
      {/* Main message */}
      <p style={{
        fontSize:   13,
        color:      'var(--text-2)',
        margin:     0,
        lineHeight: 1.65,
        fontFamily: 'var(--font-body)',
      }}>
        {expired ? '✓ You\'re good to go. Try again.' : `⏱ ${message}`}
      </p>

      {/* Countdown */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{
          fontSize:        11,
          color:           expired ? 'var(--green-text, #4ade80)' : 'var(--text-4)',
          fontFamily:      'var(--font-mono)',
          letterSpacing:   '0.06em',
        }}>
          {expired ? 'Reset' : 'Resets in'}
        </span>
        {!expired && (
          <span style={{
            fontSize:      12,
            fontWeight:    600,
            color:         'var(--gold)',
            fontFamily:    'var(--font-mono)',
            letterSpacing: '0.08em',
          }}>
            {countdownStr}
          </span>
        )}
      </div>
    </div>
  )
}

// ── Utility: parse a 429 response body ───────────────────────────────────────
// Use this in components to extract the rate limit info from a 429 fetch response.
//
// Usage:
//   const rl = await parseRateLimit(res)
//   if (rl) { setRateLimit(rl); return; }

export interface RateLimitInfo {
  message:        string
  resetAt:        number
  retryAfterSecs: number
}

export async function parseRateLimit(res: Response): Promise<RateLimitInfo | null> {
  if (res.status !== 429) return null
  try {
    // Clone before reading — the caller may want to read the body too
    const data = await res.clone().json() as Partial<RateLimitInfo>
    return {
      message:        data.message        ?? 'Too many requests. Please wait a moment.',
      resetAt:        data.resetAt        ?? Date.now() + 60_000,
      retryAfterSecs: data.retryAfterSecs ?? 60,
    }
  } catch {
    return {
      message:        'Too many requests. Please wait a moment.',
      resetAt:        Date.now() + 60_000,
      retryAfterSecs: 60,
    }
  }
}

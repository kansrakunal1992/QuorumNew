'use client'

// components/OnboardingTour.tsx
// Sprint TOUR-1 — First-decision guided tour
// Renders a dim overlay + floating spotlight tooltip for each step.
// Spotlight is applied via injected .tour-spotlight CSS class (position:relative +
// z-index:10001 + box-shadow ring) so the element punches above the z-10000 overlay.
// On mobile (<540px) the tooltip anchors to the bottom of the screen.

import { useState, useEffect, useRef, useCallback } from 'react'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TourStep {
  id: string
  /** CSS selector for the element to spotlight. null = center-screen tooltip. */
  targetSelector: string | null
  heading: string
  body: string
  /** Preferred side for the tooltip relative to the spotlit element. */
  preferredSide: 'top' | 'bottom'
}

interface Props {
  steps:      TourStep[]
  onComplete: () => void
  onSkip:     () => void
  active:     boolean
  page:       'home' | 'council' | 'record'
}

interface TooltipPos {
  top?:    number
  bottom?: number
  left:    number
  notch:   'top' | 'bottom'
  mobile:  boolean
}

// ── Constants ─────────────────────────────────────────────────────────────────

const TOOLTIP_W  = 300   // px — fixed width of the tooltip card
const GAP        = 14    // px — gap between element edge and tooltip card
const SIDE_PAD   = 16    // px — min distance from viewport edge
const MOBILE_BP  = 540   // px — viewport width below which tooltip anchors to bottom
const SCROLL_MS  = 350   // ms — wait after scrollIntoView before reading rect

// ── Helper: compute tooltip position ─────────────────────────────────────────

function computePos(rect: DOMRect, preferredSide: 'top' | 'bottom'): TooltipPos {
  const vw = window.innerWidth
  const vh = window.innerHeight

  if (vw < MOBILE_BP) {
    return { bottom: 24, left: 0, notch: 'bottom', mobile: true }
  }

  // Horizontal: centre tooltip on the element, clamped inside viewport
  const centerX = rect.left + rect.width / 2
  const left = Math.max(SIDE_PAD, Math.min(Math.round(centerX - TOOLTIP_W / 2), vw - TOOLTIP_W - SIDE_PAD))

  // Vertical: try preferred side, auto-flip if not enough room (assume ~220px tall)
  const EST_H      = 220
  const spaceBelow = vh - rect.bottom
  const spaceAbove = rect.top

  let side = preferredSide
  if (side === 'bottom' && spaceBelow < EST_H + GAP + SIDE_PAD) side = 'top'
  if (side === 'top'    && spaceAbove < EST_H + GAP + SIDE_PAD) side = 'bottom'

  if (side === 'bottom') {
    // Tooltip below element → notch points up (at top of card)
    return { top: Math.round(rect.bottom + GAP), left, notch: 'top', mobile: false }
  } else {
    // Tooltip above element → notch points down (at bottom of card)
    // Use bottom CSS property so card grows upward from a fixed point
    return { bottom: Math.round(vh - rect.top + GAP), left, notch: 'bottom', mobile: false }
  }
}

// ── Main component ────────────────────────────────────────────────────────────

export default function OnboardingTour({ steps, onComplete, onSkip, active, page }: Props) {
  const [stepIndex,  setStepIndex]  = useState(0)
  const [tooltipPos, setTooltipPos] = useState<TooltipPos | null>(null)

  const styleTagRef  = useRef<HTMLStyleElement | null>(null)
  const currentElRef = useRef<Element | null>(null)
  const timerRef     = useRef<ReturnType<typeof setTimeout> | null>(null)

  const step   = steps[stepIndex]
  const isLast = stepIndex === steps.length - 1

  // ── Inject spotlight CSS once when tour becomes active ───────────────────

  useEffect(() => {
    if (!active) return
    const style = document.createElement('style')
    style.setAttribute('data-tour', '1')
    style.textContent = `
      .tour-spotlight {
        position: relative !important;
        z-index: 10001 !important;
        box-shadow:
          0 0 0 3px var(--gold-dim),
          0 0 0 8px rgba(201, 168, 76, 0.13) !important;
        border-radius: var(--radius-sm) !important;
        animation: tourPulse 2s ease-in-out infinite !important;
      }
      @keyframes tourPulse {
        0%, 100% {
          box-shadow:
            0 0 0 3px var(--gold-dim),
            0 0 0 8px rgba(201, 168, 76, 0.13);
        }
        50% {
          box-shadow:
            0 0 0 4px var(--gold),
            0 0 0 13px rgba(201, 168, 76, 0.24);
        }
      }
    `
    document.head.appendChild(style)
    styleTagRef.current = style
    return () => {
      style.remove()
      styleTagRef.current = null
    }
  }, [active])

  // ── Clear spotlight from the previously spotlit element ──────────────────

  const clearSpotlight = useCallback(() => {
    if (currentElRef.current) {
      currentElRef.current.classList.remove('tour-spotlight')
      currentElRef.current = null
    }
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  // ── Apply spotlight when step changes ───────────────────────────────────

  useEffect(() => {
    if (!active || !step) return
    clearSpotlight()

    if (!step.targetSelector) {
      setTooltipPos(null)
      return
    }

    const el = document.querySelector(step.targetSelector)
    if (!el) {
      setTooltipPos(null)
      return
    }

    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el.classList.add('tour-spotlight')
    currentElRef.current = el

    // Wait for scroll to settle before measuring the element's position
    timerRef.current = setTimeout(() => {
      const rect = el.getBoundingClientRect()
      setTooltipPos(computePos(rect, step.preferredSide))
    }, SCROLL_MS)

    return clearSpotlight
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, stepIndex])

  // ── Cleanup on unmount ───────────────────────────────────────────────────

  useEffect(() => () => clearSpotlight(), [clearSpotlight])

  // ── Handlers ────────────────────────────────────────────────────────────

  const handleNext = () => {
    if (isLast) {
      clearSpotlight()
      onComplete()
    } else {
      setStepIndex(i => i + 1)
    }
  }

  const handleSkip = () => {
    clearSpotlight()
    onSkip()
  }

  if (!active || !step) return null

  // ── Tooltip position style ───────────────────────────────────────────────

  const tooltipStyle: React.CSSProperties = tooltipPos
    ? tooltipPos.mobile
      ? { position: 'fixed', bottom: 24, left: 12, right: 12, zIndex: 10002 }
      : {
          position: 'fixed',
          width:    TOOLTIP_W,
          left:     tooltipPos.left,
          zIndex:   10002,
          ...(tooltipPos.top    !== undefined ? { top:    tooltipPos.top    } : {}),
          ...(tooltipPos.bottom !== undefined ? { bottom: tooltipPos.bottom } : {}),
        }
    // Fallback: centre of screen
    : {
        position:  'fixed',
        top:       '50%',
        left:      '50%',
        transform: 'translate(-50%, -50%)',
        width:     TOOLTIP_W,
        zIndex:    10002,
      }

  // ── Notch (triangular pointer toward the spotlit element) ────────────────

  const notchVisible = tooltipPos && !tooltipPos.mobile

  // When notch === 'top': tooltip is below element; notch points UP
  //   → top two sides of rotated square get gold border
  // When notch === 'bottom': tooltip is above element; notch points DOWN
  //   → bottom two sides of rotated square get gold border
  const notchStyle: React.CSSProperties = tooltipPos?.notch === 'top'
    ? {
        position:    'absolute',
        top:         -6,
        left:        '50%',
        transform:   'translateX(-50%) rotate(45deg)',
        width:       10,
        height:      10,
        background:  'var(--bg-card)',
        borderTop:   '1px solid var(--gold-dim)',
        borderLeft:  '1px solid var(--gold-dim)',
      }
    : {
        position:    'absolute',
        bottom:      -6,
        left:        '50%',
        transform:   'translateX(-50%) rotate(45deg)',
        width:       10,
        height:      10,
        background:  'var(--bg-card)',
        borderBottom:'1px solid var(--gold-dim)',
        borderRight: '1px solid var(--gold-dim)',
      }

  const pageLabel = page === 'home' ? 'Council' : page === 'council' ? 'Council' : 'Record'

  return (
    <>
      {/* ── Dim overlay — blocks background interaction ────────────────── */}
      <div
        style={{
          position:      'fixed',
          inset:         0,
          zIndex:        10000,
          background:    'rgba(8, 15, 28, 0.60)',
          pointerEvents: 'auto',
        }}
        onClick={e => e.stopPropagation()}
      />

      {/* ── Tooltip card ──────────────────────────────────────────────── */}
      <div style={{
        ...tooltipStyle,
        background:   'var(--bg-card)',
        border:       '1px solid var(--gold-dim)',
        borderRadius: 'var(--radius)',
        boxShadow:    '0 24px 72px rgba(0,0,0,0.55), 0 0 0 1px var(--gold-dim)',
        overflow:     'hidden',
      }}>

        {/* Notch pointer toward the element */}
        {notchVisible && <div style={notchStyle} />}

        {/* ── Top strip: step counter + skip ── */}
        <div style={{
          display:        'flex',
          alignItems:     'center',
          justifyContent: 'space-between',
          padding:        '12px 16px 0',
        }}>
          <span style={{
            fontFamily:    'var(--font-mono)',
            fontSize:      9,
            letterSpacing: '0.2em',
            textTransform: 'uppercase',
            color:         'var(--gold)',
            opacity:       0.65,
          }}>
            {pageLabel} · {stepIndex + 1} of {steps.length}
          </span>

          <button
            onClick={handleSkip}
            style={{
              background:    'none',
              border:        'none',
              fontFamily:    'var(--font-mono)',
              fontSize:      9.5,
              letterSpacing: '0.12em',
              color:         'var(--text-4)',
              cursor:        'pointer',
              padding:       '4px 0',
              transition:    'color 0.2s',
            }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-3)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-4)')}
          >
            Skip tour →
          </button>
        </div>

        {/* ── Content ── */}
        <div style={{ padding: '12px 16px 0' }}>
          <p style={{
            fontFamily:   'var(--font-display)',
            fontSize:     18,
            fontWeight:   400,
            color:        'var(--text-1)',
            lineHeight:   1.3,
            marginBottom: 8,
          }}>
            {step.heading}
          </p>
          <p style={{
            fontFamily: 'var(--font-body)',
            fontSize:   13,
            color:      'var(--text-3)',
            lineHeight: 1.65,
            margin:     0,
          }}>
            {step.body}
          </p>
        </div>

        {/* ── Bottom strip: progress dots + next button ── */}
        <div style={{
          display:        'flex',
          alignItems:     'center',
          justifyContent: 'space-between',
          padding:        '14px 16px 16px',
        }}>

          {/* Progress dots */}
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {steps.map((_, i) => (
              <div key={i} style={{
                width:      i === stepIndex ? 16 : 6,
                height:     6,
                borderRadius: 3,
                background: i <= stepIndex ? 'var(--gold)' : 'var(--border-mid)',
                opacity:    i === stepIndex ? 1 : i < stepIndex ? 0.6 : 0.4,
                transition: 'width 0.25s ease, background 0.25s ease',
              }} />
            ))}
          </div>

          {/* Next / Finish */}
          <button
            className="btn-primary"
            style={{ fontSize: 12, padding: '7px 16px', minHeight: 0 }}
            onClick={handleNext}
          >
            {isLast ? 'Finish ✓' : 'Next →'}
          </button>
        </div>
      </div>
    </>
  )
}

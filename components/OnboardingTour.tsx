'use client'

// components/OnboardingTour.tsx — Sprint TOUR-1
// Fixes in this version:
// 1. Portal rendering (no stacking context issues)
// 2. Force repaint on spotlight removal (fixes blank GPU-composited persona cards)
// 3. Drag support so card is never unreachable
// 4. Resize handler clamps card back on screen if viewport shrinks
// 5. Clicking the dim overlay shows inline skip confirmation instead of doing nothing

import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TourStep {
  id:              string
  targetSelector:  string | null
  heading:         string
  body:            string
  preferredSide:   'top' | 'bottom'
}

// ── Shared PWA-install step builder ──────────────────────────────────────────
// Returns the "Add to Home Screen" step only when:
//   • user is on a mobile browser (not already in standalone / installed)
//   • user has linked their email (quorum_user_email in localStorage)
// Returns null when either condition is not met.
// Called client-side only — safe to call in useEffect.

export function buildPWAInstallStep(): TourStep | null {
  try {
    if (typeof window === 'undefined') return null
    const hasEmail     = !!localStorage.getItem('quorum_user_email')
    const isMobile     = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (navigator as any).standalone === true
    if (hasEmail && isMobile && !isStandalone) {
      return {
        id:             'install-pwa',
        targetSelector: null,
        heading:        'One tap to always have Quorum ready',
        body:           'Tap Share → "Add to Home Screen" in your browser. Quorum installs as a native-feeling app — full-screen, faster, and able to send you check-ins on open decisions.',
        preferredSide:  'bottom',
      }
    }
  } catch { /* localStorage unavailable */ }
  return null
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

const TOOLTIP_W  = 300
const GAP        = 14
const SIDE_PAD   = 16
const MOBILE_BP  = 540
const SCROLL_MS  = 350

// ── Position helper ───────────────────────────────────────────────────────────

function computePos(rect: DOMRect, preferredSide: 'top' | 'bottom'): TooltipPos {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const EST_H = 260   // conservative height estimate for clamping

  if (vw < MOBILE_BP) {
    return { bottom: 80, left: 0, notch: 'bottom', mobile: true }
  }

  // Centre the tooltip horizontally on the element, clamped within viewport
  const centerX = rect.left + rect.width / 2
  const left    = Math.max(SIDE_PAD, Math.min(Math.round(centerX - TOOLTIP_W / 2), vw - TOOLTIP_W - SIDE_PAD))

  // When element is taller than 55% of the viewport (e.g. synthesis card,
  // persona grid) neither above nor below has enough room — anchor to bottom
  // of screen instead of trying to flank the element.
  if (rect.height > vh * 0.55) {
    return { bottom: 100, left, notch: 'bottom', mobile: false }
  }

  const spaceBelow = vh - rect.bottom
  const spaceAbove = rect.top

  let side = preferredSide
  if (side === 'bottom' && spaceBelow < EST_H + GAP + SIDE_PAD) side = 'top'
  if (side === 'top'    && spaceAbove < EST_H + GAP + SIDE_PAD) side = 'bottom'

  let pos: TooltipPos
  if (side === 'bottom') {
    pos = { top: Math.round(rect.bottom + GAP), left, notch: 'top', mobile: false }
  } else {
    pos = { bottom: Math.round(vh - rect.top + GAP), left, notch: 'bottom', mobile: false }
  }

  // Hard clamp: if final position would push card off-screen, anchor to bottom
  const topWouldOverflow    = pos.top    !== undefined && pos.top    + EST_H > vh - SIDE_PAD
  const bottomWouldOverflow = pos.bottom !== undefined && pos.bottom + EST_H > vh - SIDE_PAD
  if (topWouldOverflow || bottomWouldOverflow) {
    return { bottom: 100, left, notch: 'bottom', mobile: false }
  }

  return pos
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function OnboardingTour({ steps, onComplete, onSkip, active, page }: Props) {
  const [stepIndex,      setStepIndex]      = useState(0)
  const [tooltipPos,     setTooltipPos]     = useState<TooltipPos | null>(null)
  const [showSkipConfirm, setShowSkipConfirm] = useState(false)
  const [portalMounted,  setPortalMounted]  = useState(false)

  // Drag state
  const [isDragging, setIsDragging] = useState(false)
  const [dragged,    setDragged]    = useState<{ x: number; y: number } | null>(null)

  const styleTagRef  = useRef<HTMLStyleElement | null>(null)
  const currentElRef = useRef<Element | null>(null)
  const timerRef     = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tooltipRef   = useRef<HTMLDivElement | null>(null)
  const dragStartRef = useRef<{ mx: number; my: number; tx: number; ty: number } | null>(null)
  // Bug fix (TOUR-2): elements inside a fixed-position ancestor with its own
  // z-index (e.g. SessionView's .sv-navbar, z-index: 8500) never visually
  // clear the dim overlay (z-index: 10000) even though .tour-spotlight sets
  // z-index: 10001 on the target itself — a child's z-index is only compared
  // *within* the stacking context of its nearest positioned ancestor. If that
  // ancestor's own z-index is below the overlay's, the whole subtree —
  // spotlighted child included — renders underneath it. We temporarily lift
  // any such ancestor's z-index above the overlay while its descendant is
  // spotlit, and restore the original value when the spotlight clears.
  const elevatedAncestorsRef = useRef<{ el: HTMLElement; prevZIndex: string }[]>([])

  const step   = steps[stepIndex]
  const isLast = stepIndex === steps.length - 1

  // ── Portal gate ───────────────────────────────────────────────────────────

  useEffect(() => { setPortalMounted(true) }, [])

  // ── Inject spotlight CSS while tour is active ─────────────────────────────
  // Bug fix (TOUR-3): the ring previously used var(--gold-dim) as its resting
  // color (0%/100% keyframes, which — because the animation is ease-in-out —
  // is where it sits for most of each 2s cycle). --gold-dim was designed as a
  // subtle divider/hover-border accent elsewhere in the app, not an attention
  // color: measured contrast was only ~2:1 against dark-theme backgrounds and
  // ~2–2.5:1 against light-theme/white cards (WCAG's floor for a graphical UI
  // element to read as distinct is 3:1). Net effect: the "spotlight" was real
  // but effectively invisible outside a brief flash at the 50% keyframe.
  // Fix: dark theme reuses --gold-bright (measured ~12:1 against --bg-void —
  // already an existing token, no new color introduced). Light theme's own
  // gold tokens all cap out under 3:1 against white/cream backgrounds, so it
  // gets a dedicated deeper amber (#a8720a, ~4.1:1) plus a thin dark hairline
  // for edge definition — a technique for keeping a warm color legible on
  // light backgrounds without going murky/brown.

  useEffect(() => {
    if (!active) return
    const style = document.createElement('style')
    style.setAttribute('data-tour', '1')
    style.textContent = `
      .tour-spotlight {
        position: relative !important;
        z-index: 10001 !important;
        box-shadow:
          0 0 0 3px var(--gold-bright),
          0 0 0 9px rgba(234, 202, 120, 0.20) !important;
        border-radius: var(--radius-sm) !important;
        animation: tourPulse 2s ease-in-out infinite !important;
      }
      @keyframes tourPulse {
        0%, 100% {
          box-shadow: 0 0 0 3px var(--gold-bright), 0 0 0 9px rgba(234,202,120,0.20);
        }
        50% {
          box-shadow: 0 0 0 4px var(--gold-bright), 0 0 0 14px rgba(234,202,120,0.32);
        }
      }

      /* Light theme: none of the app's existing gold tokens clear 3:1 against
         white/cream cards, so this uses a dedicated deeper amber + hairline
         instead of reusing --gold/--gold-bright/--gold-dim. */
      [data-theme="light"] .tour-spotlight {
        box-shadow:
          0 0 0 1px rgba(0, 0, 0, 0.18),
          0 0 0 4px #a8720a,
          0 0 0 10px rgba(168, 114, 10, 0.18) !important;
        animation: tourPulseLight 2s ease-in-out infinite !important;
      }
      @keyframes tourPulseLight {
        0%, 100% {
          box-shadow: 0 0 0 1px rgba(0,0,0,0.18), 0 0 0 4px #a8720a, 0 0 0 10px rgba(168,114,10,0.18);
        }
        50% {
          box-shadow: 0 0 0 1px rgba(0,0,0,0.24), 0 0 0 5px #8a5c00, 0 0 0 15px rgba(168,114,10,0.28);
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

  // ── Clear spotlight — with force-repaint to fix GPU compositing artifacts ──
  // Chrome sometimes leaves text invisible after removing position:relative +
  // z-index from an element that was composited. The display:none toggle forces
  // a full repaint and clears the artifact.

  const clearSpotlight = useCallback(() => {
    if (currentElRef.current) {
      const el = currentElRef.current as HTMLElement
      el.classList.remove('tour-spotlight')
      // Force repaint
      el.style.display = 'none'
      void el.offsetHeight          // triggers synchronous layout
      el.style.display = ''
      currentElRef.current = null
    }
    // Restore any ancestor z-indexes we temporarily lifted (see ref comment above)
    if (elevatedAncestorsRef.current.length) {
      elevatedAncestorsRef.current.forEach(({ el, prevZIndex }) => {
        if (prevZIndex) el.style.zIndex = prevZIndex
        else el.style.removeProperty('z-index')
      })
      elevatedAncestorsRef.current = []
    }
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  // ── Apply spotlight + compute tooltip position on each step ──────────────

  useEffect(() => {
    if (!active || !step) return
    clearSpotlight()
    setShowSkipConfirm(false)
    setDragged(null)               // reset drag position on step advance

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

    // Walk up from the target and lift the z-index of any positioned ancestor
    // (position: fixed/sticky/absolute/relative with an explicit z-index) that
    // would otherwise cap the spotlight below the dim overlay. See ref comment
    // above for why this is needed — .tour-spotlight's own z-index: 10001 only
    // wins locally within that ancestor's stacking context.
    let ancestor = (el as HTMLElement).parentElement
    while (ancestor && ancestor !== document.body) {
      const cs = window.getComputedStyle(ancestor)
      const zi = parseInt(cs.zIndex, 10)
      if (cs.position !== 'static' && !Number.isNaN(zi) && zi < 10001) {
        elevatedAncestorsRef.current.push({ el: ancestor, prevZIndex: ancestor.style.zIndex })
        ancestor.style.zIndex = '10001'
      }
      ancestor = ancestor.parentElement
    }

    timerRef.current = setTimeout(() => {
      const rect = el.getBoundingClientRect()
      setTooltipPos(computePos(rect, step.preferredSide))
    }, SCROLL_MS)

    return clearSpotlight
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, stepIndex])

  // ── Cleanup on unmount ────────────────────────────────────────────────────

  useEffect(() => () => clearSpotlight(), [clearSpotlight])

  // ── Resize: clamp card back on screen, recompute position ─────────────────
  // This prevents the card from going off-screen if the browser window shrinks.

  useEffect(() => {
    if (!active) return
    const onResize = () => {
      // If user had dragged, clamp to new viewport
      setDragged(prev => {
        if (!prev) return null
        const w = tooltipRef.current?.offsetWidth  ?? TOOLTIP_W
        const h = tooltipRef.current?.offsetHeight ?? 240
        return {
          x: Math.max(8, Math.min(prev.x, window.innerWidth  - w - 8)),
          y: Math.max(8, Math.min(prev.y, window.innerHeight - h - 8)),
        }
      })
      // Recompute anchor position from current element
      if (currentElRef.current && step) {
        const rect = currentElRef.current.getBoundingClientRect()
        setTooltipPos(computePos(rect, step.preferredSide))
      }
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [active, step])

  // ── Desktop skip: any click outside the tooltip triggers skip confirm ──────
  // Uses capture phase so it fires even when the spotlit element (z-index 10001)
  // is above the overlay (z-index 10000) and would otherwise absorb the click.
  // Interactive elements inside the spotlit area (buttons, links) are allowed
  // through so Challenge / Read aloud / etc. still work normally.

  useEffect(() => {
    if (!active) return
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      // Never intercept clicks inside the tour tooltip itself
      if (tooltipRef.current?.contains(target)) return
      // Allow interactive elements within the spotlit element to work normally
      const insideSpotlit = currentElRef.current?.contains(target)
      if (insideSpotlit && target.closest('button, a, input, [role="button"]')) return
      // Everything else shows the skip confirmation
      setShowSkipConfirm(true)
    }
    document.addEventListener('mousedown', onMouseDown, true) // capture phase
    return () => document.removeEventListener('mousedown', onMouseDown, true)
  }, [active])

  // ── Drag: pointer tracking ─────────────────────────────────────────────────

  useEffect(() => {
    if (!isDragging) return

    const onMove = (e: MouseEvent | TouchEvent) => {
      if (!dragStartRef.current) return
      const clientX = 'touches' in e ? (e as TouchEvent).touches[0].clientX : (e as MouseEvent).clientX
      const clientY = 'touches' in e ? (e as TouchEvent).touches[0].clientY : (e as MouseEvent).clientY
      const x = dragStartRef.current.tx + (clientX - dragStartRef.current.mx)
      const y = dragStartRef.current.ty + (clientY - dragStartRef.current.my)
      const w = tooltipRef.current?.offsetWidth  ?? TOOLTIP_W
      const h = tooltipRef.current?.offsetHeight ?? 240
      setDragged({
        x: Math.max(8, Math.min(x, window.innerWidth  - w - 8)),
        y: Math.max(8, Math.min(y, window.innerHeight - h - 8)),
      })
    }

    const onUp = () => {
      setIsDragging(false)
      dragStartRef.current = null
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup',   onUp)
    window.addEventListener('touchmove', onMove, { passive: false })
    window.addEventListener('touchend',  onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup',   onUp)
      window.removeEventListener('touchmove', onMove)
      window.removeEventListener('touchend',  onUp)
    }
  }, [isDragging])

  const handleDragStart = (e: React.MouseEvent | React.TouchEvent) => {
    if ((e.target as HTMLElement).closest('button')) return
    if (!tooltipRef.current) return
    e.preventDefault()
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY
    const rect    = tooltipRef.current.getBoundingClientRect()
    dragStartRef.current = { mx: clientX, my: clientY, tx: rect.left, ty: rect.top }
    setIsDragging(true)
  }

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleNext = () => {
    if (isLast) { clearSpotlight(); onComplete() }
    else setStepIndex(i => i + 1)
  }

  const handleBack = () => setStepIndex(i => Math.max(0, i - 1))

  const handleSkip = () => { clearSpotlight(); onSkip() }

  if (!active || !step || !portalMounted) return null

  // ── Tooltip style: drag position wins over computed position ──────────────

  const tooltipStyle: React.CSSProperties = (() => {
    if (dragged) return { position: 'fixed', top: dragged.y, left: dragged.x, width: TOOLTIP_W, zIndex: 10002 }
    if (!tooltipPos) return { position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: TOOLTIP_W, zIndex: 10002 }
    if (tooltipPos.mobile) return { position: 'fixed', bottom: 80, left: 12, right: 12, zIndex: 10002 }
    return {
      position: 'fixed',
      width:    TOOLTIP_W,
      left:     tooltipPos.left,
      zIndex:   10002,
      ...(tooltipPos.top    !== undefined ? { top:    tooltipPos.top    } : {}),
      ...(tooltipPos.bottom !== undefined ? { bottom: tooltipPos.bottom } : {}),
    }
  })()

  // ── Notch ─────────────────────────────────────────────────────────────────

  const notchVisible = tooltipPos && !tooltipPos.mobile && !dragged
  const notchStyle: React.CSSProperties = tooltipPos?.notch === 'top'
    ? { position: 'absolute', top: -6, left: '50%', transform: 'translateX(-50%) rotate(45deg)', width: 10, height: 10, background: 'var(--bg-card)', borderTop: '1px solid var(--gold-dim)', borderLeft: '1px solid var(--gold-dim)' }
    : { position: 'absolute', bottom: -6, left: '50%', transform: 'translateX(-50%) rotate(45deg)', width: 10, height: 10, background: 'var(--bg-card)', borderBottom: '1px solid var(--gold-dim)', borderRight: '1px solid var(--gold-dim)' }

  const pageLabel = page === 'record' ? 'Record' : 'Council'

  return createPortal(
    <>
      {/* ── Dim overlay ── clicking prompts skip confirmation ────────── */}
      <div
        style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(8,15,28,0.60)', pointerEvents: 'auto' }}
      />

      {/* ── Tooltip card ─────────────────────────────────────────────── */}
      <div
        ref={tooltipRef}
        style={{
          ...tooltipStyle,
          background:   'var(--bg-card)',
          border:       '1px solid var(--gold-dim)',
          borderRadius: 'var(--radius)',
          boxShadow:    '0 24px 72px rgba(0,0,0,0.55), 0 0 0 1px var(--gold-dim)',
          overflow:     'hidden',
          cursor:       isDragging ? 'grabbing' : 'grab',
          userSelect:   'none',
        }}
        onMouseDown={handleDragStart}
        onTouchStart={handleDragStart}
      >
        {notchVisible && <div style={notchStyle} />}

        {showSkipConfirm ? (
          /* ── Skip confirmation ── */
          <div style={{ padding: '18px 16px 16px' }}>
            <p style={{ fontFamily: 'var(--font-display)', fontSize: 16, color: 'var(--text-1)', marginBottom: 6 }}>
              Skip the tour?
            </p>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--text-4)', lineHeight: 1.55, marginBottom: 16 }}>
              You can always explore the product on your own. This will skip all remaining steps.
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                className="btn-primary"
                style={{ fontSize: 12, padding: '7px 14px', minHeight: 0 }}
                onClick={handleSkip}
              >
                Yes, skip
              </button>
              <button
                className="btn-ghost"
                style={{ fontSize: 12, padding: '7px 14px', minHeight: 0 }}
                onClick={() => setShowSkipConfirm(false)}
              >
                Continue tour
              </button>
            </div>
          </div>
        ) : (
          /* ── Normal step content ── */
          <>
            {/* Top strip */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px 0' }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'var(--gold)', opacity: 0.65, display: 'flex', alignItems: 'center', gap: 5 }}>
                <svg width="8" height="10" viewBox="0 0 8 10" fill="var(--gold)" opacity={0.5}>
                  <circle cx="2" cy="2" r="1.2"/><circle cx="6" cy="2" r="1.2"/>
                  <circle cx="2" cy="5" r="1.2"/><circle cx="6" cy="5" r="1.2"/>
                  <circle cx="2" cy="8" r="1.2"/><circle cx="6" cy="8" r="1.2"/>
                </svg>
                {pageLabel} · {stepIndex + 1} of {steps.length}
              </span>
              <button
                onClick={() => setShowSkipConfirm(true)}
                style={{ background: 'none', border: 'none', fontFamily: 'var(--font-mono)', fontSize: 9.5, letterSpacing: '0.12em', color: 'var(--text-4)', cursor: 'pointer', padding: '4px 0', transition: 'color 0.2s' }}
                onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-3)')}
                onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-4)')}
              >
                Skip tour →
              </button>
            </div>

            {/* Body */}
            <div style={{ padding: '12px 16px 0' }}>
              <p style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 400, color: 'var(--text-1)', lineHeight: 1.3, marginBottom: 8 }}>
                {step.heading}
              </p>
              <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--text-3)', lineHeight: 1.65, margin: 0 }}>
                {step.body}
              </p>
            </div>

            {/* Bottom strip */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px 16px' }}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                {steps.map((_, i) => (
                  <div key={i} style={{ width: i === stepIndex ? 16 : 6, height: 6, borderRadius: 3, background: i <= stepIndex ? 'var(--gold)' : 'var(--border-mid)', opacity: i === stepIndex ? 1 : i < stepIndex ? 0.6 : 0.4, transition: 'width 0.25s ease, background 0.25s ease' }} />
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {stepIndex > 0 && (
                  <button
                    className="btn-ghost"
                    style={{ fontSize: 12, padding: '7px 14px', minHeight: 0 }}
                    onClick={handleBack}
                  >
                    ← Back
                  </button>
                )}
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
        )}
      </div>
    </>,
    document.body
  )
}

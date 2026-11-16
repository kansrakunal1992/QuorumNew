'use client'

// components/IntakeVideoLink.tsx
// -- Landing screen: one quiet "Watch the intro" line --------------------------------------------------------
// Round 4 (Nov 2026). Sits in the same one-line row as "More examples". It is a text link, never a player on the page:
// the box and the button stay the first thing on the screen. A tap opens the intro video in a modal, with sound on and
// the controls showing (the person asked for it, so it plays at once; nothing is ever fetched or played before that).
//
// Why it exists: campaign links (?scenario=...) land straight in the app, so those visitors never see the website's hero
// video. Someone who came through the website has already seen it and can ignore this line.
//
// Rules this follows (same pattern as ResearchVideoCard / MethodologyExplainerVideo):
//   - The file is served from this app (/videos/quorum-intro.mp4). A HEAD request checks that it exists; if it does not
//     (not uploaded yet, or removed) the component renders nothing, so the row looks exactly as it did without it.
//     It also keeps the content-security policy as it is (media-src 'self'), and the HEAD check needs no CORS.
//   - Hidden for someone with INTRO_VIDEO_HIDE_AT_DECISIONS or more decisions on this device: they do not need an intro.
//   - No autoplay on page load, no preload. Esc, the Close button or a tap outside closes it. Closing stops the video.
//   - Copy claims nothing about price, sign-up or length (tests/first-screen-conversion.test.ts keeps it that way).
//   - One event, intro_video_opened { placement: 'landing' }, when the link is tapped. Compare decision_started among
//     openers and non-openers in the dashboard.
//
// Renders a fragment: the link, then the "·" that separates it from the next item in the row (so the separator only
// exists when the link does), and the modal (portalled to <body>, above the cookie banner, which is at z-index 9000-9100).

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { track } from '@/lib/track'

export const INTRO_VIDEO_SRC = '/videos/quorum-intro.mp4'
export const INTRO_VIDEO_HIDE_AT_DECISIONS = 3
const LABEL = '\u25B6 Watch the intro'

interface Props {
  /** How many decisions this device already has. At INTRO_VIDEO_HIDE_AT_DECISIONS or more the link is not shown. */
  decisionCount?: number
}

export default function IntakeVideoLink({ decisionCount = 0 }: Props) {
  const hidden = decisionCount >= INTRO_VIDEO_HIDE_AT_DECISIONS
  const [available, setAvailable] = useState(false)
  const [open, setOpen] = useState(false)
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (hidden) return
    let cancelled = false
    fetch(INTRO_VIDEO_SRC, { method: 'HEAD' })
      .then(res => { if (!cancelled) setAvailable(res.ok) })
      .catch(()  => { if (!cancelled) setAvailable(false) })
    return () => { cancelled = true }
  }, [hidden])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', onKey)
    closeRef.current?.focus()
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  if (hidden || !available) return null

  return (
    <>
      <button
        type="button"
        onClick={() => { track('intro_video_opened', { placement: 'landing' }); setOpen(true) }}
        aria-haspopup="dialog"
        style={{ background: 'none', border: 'none', padding: 0, fontSize: 12.5, color: 'var(--text-3)', cursor: 'pointer', textDecoration: 'underline' }}
      >
        {LABEL}
      </button>
      <span aria-hidden="true">·</span>

      {open && typeof document !== 'undefined' && createPortal(
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Quorum intro video"
          onClick={() => setOpen(false)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 9200,
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
          }}
        >
          <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 720, textAlign: 'center' }}>
            <video
              autoPlay
              controls
              playsInline
              preload="metadata"
              src={INTRO_VIDEO_SRC}
              style={{ width: '100%', maxHeight: '75vh', display: 'block', borderRadius: 12, background: '#000' }}
            />
            <button
              ref={closeRef}
              type="button"
              onClick={() => setOpen(false)}
              style={{ marginTop: 12, background: 'none', border: 'none', color: '#fff', opacity: 0.85, fontSize: 13, cursor: 'pointer', padding: '6px 10px' }}
            >
              Close {'\u2715'}
            </button>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}

'use client'
// components/ResearchVideoCard.tsx
// Video 2 (research explainer), per video strategy doc. Always rendered on the
// verdict screen — right after CouncilWeightingStrip — regardless of whether
// this decision got gated/held, so it reaches every completed session, not
// just a subset. Locked-in behavior:
//
//   - Sessions 1–2 (or until opened, whichever first): full inline video card.
//   - Session 3 onward, once never opened: dials DOWN — permanently — to a
//     single line in the same position: "▶ Why Quorum weighs it this way".
//     Clicking it opens the video in a lightweight modal.
//   - Opening the video at any point (card or line) marks it "seen" and locks
//     in the dialed-down line state from then on, even if session count is
//     still < 3.
//   - If /videos/quorum-research.mp4 hasn't been uploaded yet (404), this
//     component renders nothing at all — same "defaults to current
//     experience" behavior as the website's hero video.

import { useEffect, useState } from 'react'
import { getStoredSessionIds, hasFunctionalConsent } from '@/lib/storage'

const SEEN_KEY             = 'quorum_research_video_seen'
const DIAL_DOWN_AT_SESSION = 3
const VIDEO_SRC            = '/videos/quorum-research.mp4'

function readSeen(): boolean {
  if (typeof window === 'undefined') return false
  try { return localStorage.getItem(SEEN_KEY) === 'true' } catch { return false }
}

function writeSeen(): void {
  if (typeof window === 'undefined') return
  // Same consent convention as the rest of lib/storage.ts — a functional
  // write, gated behind cookie consent. If consent hasn't been given yet,
  // the card will simply show again next session, which is an acceptable
  // (privacy-respecting) fallback rather than writing without consent.
  if (!hasFunctionalConsent()) return
  try { localStorage.setItem(SEEN_KEY, 'true') } catch {}
}

export default function ResearchVideoCard() {
  const [videoStatus, setVideoStatus] = useState<'checking' | 'available' | 'unavailable'>('checking')
  const [seen, setSeen]               = useState(false)
  const [sessionCount, setSessionCount] = useState(0)
  const [modalOpen, setModalOpen]     = useState(false)

  // Read localStorage-derived state client-side only, after mount, to avoid
  // any SSR/CSR hydration mismatch.
  useEffect(() => {
    setSeen(readSeen())
    setSessionCount(getStoredSessionIds().length)
  }, [])

  // Existence check via a HEAD request rather than mounting a real <video>
  // element to probe it. A <video preload="metadata"> still pulls a small
  // chunk of the file itself (enough to parse duration/codec); a HEAD
  // request only reads response headers — meaningfully lighter on a slow
  // connection, and it's the only network activity this component causes
  // until someone actually presses play.
  useEffect(() => {
    let cancelled = false
    fetch(VIDEO_SRC, { method: 'HEAD' })
      .then(res => { if (!cancelled) setVideoStatus(res.ok ? 'available' : 'unavailable') })
      .catch(()  => { if (!cancelled) setVideoStatus('unavailable') })
    return () => { cancelled = true }
  }, [])

  const markSeen = () => {
    if (!seen) { writeSeen(); setSeen(true) }
  }

  if (videoStatus !== 'available') return null

  const dialedDown = seen || sessionCount >= DIAL_DOWN_AT_SESSION

  return (
    <>
      {dialedDown ? (
        /* ── Dialed-down state: persistent line, same position as the card ── */
        <div
          onClick={() => { setModalOpen(true); markSeen() }}
          role="button"
          tabIndex={0}
          style={{
            marginTop:    16,
            paddingTop:   14,
            borderTop:    '1px solid var(--border-dim)',
            display:      'flex',
            alignItems:   'center',
            gap:          8,
            cursor:       'pointer',
          }}
        >
          <span style={{ fontSize: 11, color: 'var(--gold)', flexShrink: 0 }}>▶</span>
          <span style={{
            fontSize:      11.5,
            fontWeight:    600,
            letterSpacing: '0.02em',
            color:         'var(--text-3)',
          }}>
            Why Quorum weighs it this way
          </span>
        </div>
      ) : (
        /* ── Full card state ── */
        <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border-dim)' }}>
          <p style={{
            fontSize:      10,
            fontWeight:    700,
            letterSpacing: '0.10em',
            textTransform: 'uppercase',
            color:         'var(--text-4)',
            margin:        '0 0 10px',
          }}>
            Why Quorum weighs it this way
          </p>
          <video
            controls
            playsInline
            preload="none"
            poster="/videos/quorum-research-poster.jpg"
            onPlay={markSeen}
            style={{
              width:        '100%',
              display:      'block',
              borderRadius: 10,
              border:       '1px solid var(--border-dim)',
              background:   '#000',
            }}
          >
            <source src="/videos/quorum-research.mp4" type="video/mp4" />
            <track kind="captions" src="/videos/quorum-research.vtt" srcLang="en" label="English" default />
          </video>
        </div>
      )}

      {modalOpen && (
        <div
          onClick={() => setModalOpen(false)}
          style={{
            position:       'fixed',
            inset:          0,
            background:     'rgba(0,0,0,0.75)',
            display:        'flex',
            alignItems:     'center',
            justifyContent: 'center',
            zIndex:         1000,
            padding:        24,
          }}
        >
          <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 720 }}>
            <video
              autoPlay
              controls
              playsInline
              poster="/videos/quorum-research-poster.jpg"
              style={{ width: '100%', display: 'block', borderRadius: 12, background: '#000' }}
            >
              <source src="/videos/quorum-research.mp4" type="video/mp4" />
              <track kind="captions" src="/videos/quorum-research.vtt" srcLang="en" label="English" default />
            </video>
            <button
              onClick={() => setModalOpen(false)}
              style={{
                marginTop:  12,
                background: 'none',
                border:     'none',
                color:      'var(--text-3)',
                fontSize:   12,
                cursor:     'pointer',
              }}
            >
              Close ✕
            </button>
          </div>
        </div>
      )}
    </>
  )
}

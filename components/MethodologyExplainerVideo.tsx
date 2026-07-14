'use client'
// components/MethodologyExplainerVideo.tsx
// Video 3 (explainer) — 2-min extended cut, embedded on /methodology
// ("How Quorum Works"), right below the intro quote and above the
// step-by-step written breakdown. This page is already linked from
// AppFooter ("How Quorum Works"), so no extra discoverability work
// needed here — just the video itself.
//
// Distinct file from the website's 45-sec cut: this is the longer,
// extended version (per the video strategy doc's "two cuts" plan), so
// it gets its own filename rather than reusing quorum-explainer.mp4.
//
// Existence is checked via a HEAD request (cheap — headers only, no
// video bytes) before rendering anything. If the file 404s, this
// component renders null and the page looks exactly as it does today.
// preload="none" means even once shown, nothing downloads until the
// person presses play — this page is a deliberate destination, not a
// passive interruption, so there's no reason to autoplay or prefetch.

import { useEffect, useState } from 'react'

const VIDEO_SRC = '/videos/quorum-explainer-extended.mp4'

export default function MethodologyExplainerVideo() {
  const [available, setAvailable] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch(VIDEO_SRC, { method: 'HEAD' })
      .then(res => { if (!cancelled) setAvailable(res.ok) })
      .catch(()  => { if (!cancelled) setAvailable(false) })
    return () => { cancelled = true }
  }, [])

  if (!available) return null

  return (
    <div style={{ marginBottom: 44 }}>
      <p style={{
        fontFamily:    'var(--font-mono)',
        fontSize:      10,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        color:         'var(--text-4)',
        margin:        '0 0 12px',
      }}>
        Watch: how a session actually works
      </p>
      <video
        controls
        playsInline
        preload="none"
        poster="/videos/quorum-explainer-extended-poster.jpg"
        style={{
          width:        '100%',
          display:      'block',
          borderRadius: 10,
          border:       '1px solid var(--border-dim)',
          background:   '#000',
        }}
      >
        <source src={VIDEO_SRC} type="video/mp4" />
        <track kind="captions" src="/videos/quorum-explainer-extended.vtt" srcLang="en" label="English" default />
      </video>
    </div>
  )
}

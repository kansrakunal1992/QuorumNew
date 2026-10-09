'use client'

// components/AddToHomeScreenPrompt.tsx
// -- Phase 3 (retention work): put Quorum one tap away ------------------------
// A decision happens in the middle of a day, not at a laptop. Once someone has
// two decisions, offer the home-screen icon -- the cheapest "prompt" there is.
//
//   Android / desktop Chrome : captures `beforeinstallprompt` and shows an
//                              "Add to home screen" button that triggers it.
//   iOS Safari               : there is no API, so show the two-step hint --
//                              but ONLY for people PushEnablePrompt will not
//                              already show its own iOS tip to (it covers
//                              signed-in iOS users), so nobody sees both.
//   Already installed / dismissed in the last 21 days / <2 decisions: nothing.
//
// public/manifest.json (display: standalone) and public/sw.js already exist,
// so installability needs no other change. Outline-style only.

import { useEffect, useState } from 'react'
import { track } from '@/lib/track'

const DISMISS_KEY = 'quorum_a2hs_dismissed_at'
const DISMISS_TTL = 21 * 24 * 60 * 60 * 1000

interface Props {
  decisionCount: number
  /** Signed-in people on iOS already get PushEnablePrompt's tip. */
  signedIn: boolean
}

type DeferredPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }

export default function AddToHomeScreenPrompt({ decisionCount, signedIn }: Props) {
  const [mode, setMode] = useState<'hidden' | 'android' | 'ios'>('hidden')
  const [deferred, setDeferred] = useState<DeferredPrompt | null>(null)

  useEffect(() => {
    if (decisionCount < 2) return
    try {
      const standalone =
        window.matchMedia('(display-mode: standalone)').matches ||
        (navigator as unknown as { standalone?: boolean }).standalone === true
      if (standalone) return
      const at = Number(localStorage.getItem(DISMISS_KEY) ?? '0')
      if (at && Date.now() - at < DISMISS_TTL) return
    } catch { return }

    const ua = navigator.userAgent
    const isIOS = /iPad|iPhone|iPod/.test(ua) && !(window as unknown as { MSStream?: unknown }).MSStream
    if (isIOS) {
      if (!signedIn) { setMode('ios'); track('install_prompt_seen', { platform: 'ios' }) }
      return
    }

    const onPrompt = (e: Event) => {
      e.preventDefault()
      setDeferred(e as DeferredPrompt)
      setMode('android')
      track('install_prompt_seen', { platform: 'android' })
    }
    window.addEventListener('beforeinstallprompt', onPrompt)
    return () => window.removeEventListener('beforeinstallprompt', onPrompt)
  }, [decisionCount, signedIn])

  if (mode === 'hidden') return null

  function dismiss() {
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())) } catch {}
    setMode('hidden')
  }

  async function install() {
    if (!deferred) return
    try {
      await deferred.prompt()
      const choice = await deferred.userChoice
      if (choice.outcome === 'accepted') track('install_prompt_accepted', { platform: 'android' })
    } catch {}
    dismiss()
  }

  return (
    <div style={{
      width: '100%', maxWidth: 440, boxSizing: 'border-box', textAlign: 'left',
      padding: '12px 16px', background: 'var(--bg-card)', border: '1px solid var(--border-dim)', borderRadius: 12,
    }}>
      <p style={{ fontSize: 12.5, color: 'var(--text-3)', lineHeight: 1.5, margin: '0 0 10px' }}>
        {mode === 'ios'
          ? 'Keep Quorum one tap away: in Safari, tap Share, then Add to Home Screen.'
          : 'Keep Quorum one tap away for the next time you catch yourself going back and forth.'}
      </p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        {mode === 'android' && (
          <button className="btn-ghost" style={{ fontSize: 13, padding: '9px 16px', minHeight: 40 }} onClick={install}>
            Add to home screen
          </button>
        )}
        <button
          style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, color: 'var(--text-4)', textDecoration: 'underline', textUnderlineOffset: 2 }}
          onClick={dismiss}
        >
          {mode === 'ios' ? 'Got it' : 'Not now'}
        </button>
      </div>
    </div>
  )
}

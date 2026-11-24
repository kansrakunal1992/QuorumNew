'use client'

// components/AnonymousMirrorPreview.tsx
// ── v17 Phase 6: what /mirror shows before anyone has signed in ──────────────
//
// Until now a signed-out visitor to /mirror saw one thing: a box asking for their email. Nothing about what the Mirror is, and
// nothing from their own decisions, even when they had several saved on this very browser. That contradicts the rule that the
// first evidence-backed look is not hidden behind sign-up.
//
// Two cases, both without an account:
//
//   Decisions saved on this browser   the SAME overview the signed-in Mirror opens with (components/MirrorOverview.tsx), loaded by
//                                     the newest saved session id, in its anonymous form: claims, how much each rests on, and
//                                     counts. What it leaves out on purpose: which decisions each point rests on, the model-made
//                                     contradiction reading, and the paid sections. Those need a linked email, and the preview
//                                     says that plainly instead of hiding it.
//   Nothing saved here                an honest explanation of what the Mirror answers, and what it needs before it can say
//                                     anything (at least two decisions). No example of someone else's results, no filler.
//
// The email box (AuthGate) follows underneath, framed as keeping this, not as a toll.

import Link from 'next/link'
import { useEffect, useState } from 'react'
import MirrorOverview from '@/components/MirrorOverview'
import { getStoredSessionIds } from '@/lib/storage'
import { track } from '@/lib/track'

const card: React.CSSProperties = {
  background: 'var(--bg-card)', border: '1px solid var(--border-dim)', borderRadius: 12, padding: '16px', textAlign: 'left',
}

export default function AnonymousMirrorPreview() {
  // null until we have looked at this browser (storage is not available on the server).
  const [latest, setLatest] = useState<string | null | undefined>(undefined)

  useEffect(() => {
    const ids = getStoredSessionIds()
    setLatest(ids[0] ?? null)
    track('mirror_preview_viewed', { surface: 'mirror', total_count: ids.length })
  }, [])

  if (latest === undefined) return null

  return (
    <section aria-label="What the Mirror tells you" style={{ maxWidth: 680, margin: '0 auto 8px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      {latest ? (
        <>
          <p style={{ fontSize: 14, lineHeight: 1.55, color: 'var(--text-2)', margin: 0 }}>
            A first look, built from the decisions saved on this device. Nothing here needs an account.
          </p>
          <MirrorOverview sessionId={latest} surface="mirror" />
          <p style={{ fontSize: 12.5, lineHeight: 1.5, color: 'var(--text-4)', margin: 0 }}>
            With your email linked you can also see which decisions each point rests on, and keep them if you change device.
          </p>
        </>
      ) : (
        <div style={card}>
          <p style={{ fontSize: 14.5, lineHeight: 1.55, color: 'var(--text-1)', margin: '0 0 10px' }}>The Mirror answers three questions about how you decide:</p>
          <ol style={{ margin: '0 0 12px', paddingLeft: 20, fontSize: 14, lineHeight: 1.6, color: 'var(--text-2)' }}>
            <li>What has Quorum learned about how you decide?</li>
            <li>What should you watch for?</li>
            <li>What could you do differently next time?</li>
          </ol>
          <p style={{ fontSize: 13.5, lineHeight: 1.55, color: 'var(--text-3)', margin: '0 0 12px' }}>
            It says nothing from one decision, and it only says what your own decisions support, with how much each point rests on.
            Bring a decision or two and the first answers appear here.
          </p>
          <Link href="/q" onClick={() => track('nav_clicked', { to: 'new', surface: 'mirror_preview' })}
            style={{ display: 'inline-block', minHeight: 40, lineHeight: '40px', fontSize: 13.5, color: 'var(--gold)', fontWeight: 600, textDecoration: 'none' }}>
            Bring a decision
          </Link>
        </div>
      )}
    </section>
  )
}

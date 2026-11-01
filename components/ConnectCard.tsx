'use client'

// components/ConnectCard.tsx
// -- Phase 1 (retention work): the soft "keep your record" ask ----------------
// One component for every place Quorum asks an anonymous person to link an
// email. Replaces the generic "Create an account" framing with what linking
// actually gives them:
//   - a reminder on the review date they chose,
//   - a parked decision Quorum will hold and bring back,
//   - a record that survives a cleared browser / a new device.
//
// Modes (same shell, different ask):
//   d1_soft    after the first decision. Skippable. Tied to the review date or
//              a parked item.
//   d2_earned  after the second decision, right under the cross-decision
//              observation. Skippable.
//   d3_gate    Phase 3, behind NEXT_PUBLIC_AUTH_GATE_MODE (lib/auth-gate.ts).
//              NOT skippable: replaces the chat input once the person has
//              enough decisions. Existing records stay open -- only starting
//              the next decision needs a linked email.
//   convene_gate  v14, behind NEXT_PUBLIC_CONVENE_GATE (default ON, lib/convene-gate.ts). NOT skippable. Shown by
//              components/ConveneGate.tsx on /session/<id> for a signed-out visitor whose Council has not run yet,
//              i.e. immediately before the Council would start. Returns to the same session after Google or the
//              magic link (returnTo), and links the session to the account.
//
// Collapsed by default (one line + one button) so it never competes with the
// "next decision" prompt above it; expands to Google + email link on tap, or
// opens expanded when the person has just parked something.
//
// Reuses the existing auth plumbing -- GoogleSignInButton and POST /api/auth
// with the same xd/xs/utm payload as AuthPanel -- so /auth/callback and
// /api/auth/link-sessions need no new contract beyond the optional returnTo.

import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import GoogleSignInButton from '@/components/GoogleSignInButton'
import { getOrCreateDeviceId, getStoredSessionIds, getStoredUserEmail, getStoredUtm, pushSessionIdForSignIn } from '@/lib/storage'
import { detectInApp } from '@/lib/event-context'   // v14: Google sign-in is refused inside in-app browsers (Instagram, Facebook, ...)
import { getAuthHeaders } from '@/lib/auth-headers'
import { currentPathAsReturnTo, setReturnTo } from '@/lib/return-to'
import { track } from '@/lib/track'

export type ConnectMode = 'd1_soft' | 'd2_earned' | 'd3_gate' | 'convene_gate'

interface Props {
  mode?: ConnectMode
  /** Where the card is rendered -- analytics only. */
  surface: string
  /** ISO date or YYYY-MM-DD of the review date the person chose, if any. */
  reviewDate?: string | null
  /** Text the person just parked, if any. */
  parkedText?: string | null
  /** Open straight into the Google / email options. */
  defaultExpanded?: boolean
  /** Include this session in the ids sent with the magic link. */
  sessionId?: string | null
  /** d3_gate: how many decisions the person already has. */
  decisionCount?: number
  /** d3_gate / experiments: analytics only. */
  arm?: string | null
  /** d2_earned: overrides the default sentence (e.g. to reference the cadence they chose). */
  lead?: string | null
  /** Optional onboarding-tour anchor (data-tour-id) — set on whichever state the card is rendering. */
  tourId?: string
}

type SendState = 'idle' | 'sending' | 'sent' | 'wrong_provider' | 'error'

const DISMISS_KEY = 'quorum_connect_dismissed_until'   // localStorage, epoch ms
const PENDING_KEY = 'quorum_brief_email_pending'       // sessionStorage, shared with EmailCaptureCard
const DISMISS_HOURS = 72

function formatReviewDate(raw: string): string | null {
  const d = new Date(raw.length === 10 ? `${raw}T12:00:00` : raw)
  if (isNaN(d.getTime())) return null
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

function shorten(text: string, n = 60): string {
  const t = text.trim().replace(/\s+/g, ' ')
  return t.length > n ? `${t.slice(0, n - 1)}\u2026` : t
}

export default function ConnectCard({
  mode = 'd1_soft', surface, reviewDate, parkedText, defaultExpanded = false, sessionId,
  decisionCount, arm, lead, tourId,
}: Props) {
  const tourAttr = tourId ? { 'data-tour-id': tourId } : {}
  const skippable = mode !== 'd3_gate' && mode !== 'convene_gate'
  const isGate    = mode === 'convene_gate'
  const inAppName = typeof navigator !== 'undefined' ? detectInApp(navigator.userAgent) : 'none'   // v14
  const [visible,  setVisible]  = useState(false)
  const [expanded, setExpanded] = useState(defaultExpanded || !!parkedText || mode === 'd3_gate' || mode === 'convene_gate')
  const [email,    setEmail]    = useState('')
  const [state,    setState]    = useState<SendState>('idle')
  const [error,    setError]    = useState('')

  // Hide if already linked (local marker OR a live Supabase session), recently
  // dismissed, or a link was already sent this session and is awaiting a click.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        // v14: the gate trusts only the LIVE session below. A stale stored email must not leave the gate blank.
        if (mode !== 'convene_gate' && getStoredUserEmail()) return
        const until = Number(localStorage.getItem(DISMISS_KEY) ?? '0')
        if (skippable && until && until > Date.now() && !parkedText) return
        if (sessionStorage.getItem(PENDING_KEY)) { if (!cancelled) { setVisible(true); setState('sent') } ; return }
        const auth = await getAuthHeaders()
        if (cancelled || auth.Authorization) return
        setVisible(true)
        track('auth_prompt_seen', { stage: mode, surface, has_review_date: !!reviewDate, has_parked: !!parkedText, arm: arm ?? null })
      } catch { /* storage unavailable -- do not show */ }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // A parked item arriving after mount should open the card.
  useEffect(() => { if (parkedText) { setExpanded(true); setVisible(true) } }, [parkedText])

  if (!visible) return null

  const formattedDate = reviewDate ? formatReviewDate(reviewDate) : null
  const line = isGate
    ? (lead || 'Quorum will hold this decision, bring it back to you on your review date, and ask how it turned out. Where should it reach you?')
    : mode === 'd3_gate'
    ? `Your record has ${decisionCount ?? 'several'} decision${decisionCount === 1 ? '' : 's'}. Connect to keep going. Quorum will hold your record, remind you on your review dates, and tell you when it finds something.`
    : mode === 'd2_earned'
    ? (lead || 'Keep your record connected and Quorum can tell you when it finds something. Where should it reach you?')
    : parkedText
    ? `Parked. Quorum will hold \u201C${shorten(parkedText)}\u201D and bring it back to you. Where should it reach you?`
    : formattedDate
      ? `Quorum will bring this decision back to you on ${formattedDate}. Where should it reach you?`
      : 'Quorum can remember your decisions and tell you when it finds something. Where should it reach you?'

  function dismiss() {
    track('auth_skipped', { stage: mode, surface })
    try { localStorage.setItem(DISMISS_KEY, String(Date.now() + DISMISS_HOURS * 3600_000)) } catch {}
    setVisible(false)
  }

  async function sendLink() {
    const trimmed = email.trim().toLowerCase()
    if (!trimmed || !trimmed.includes('@')) { setError('Enter a valid email address.'); return }
    setError('')
    setState('sending')
    track('magic_link_requested', { stage: mode, surface, arm: arm ?? null })
    try {
      const deviceId = getOrCreateDeviceId()
      const stored   = getStoredSessionIds()
      const sessionIds = sessionId && !stored.includes(sessionId) ? [sessionId, ...stored] : stored
      const utm = getStoredUtm()
      const returnTo = currentPathAsReturnTo()
      if (returnTo) setReturnTo(returnTo)

      const res = await fetch('/api/auth', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: trimmed, deviceId, sessionIds, returnTo,
          utmSource: utm.utm_source, utmCampaign: utm.utm_campaign, utmContent: utm.utm_content,
        }),
      })
      if (res.status === 409) {
        const body = await res.json().catch(() => ({}))
        if (body.error === 'wrong_provider') { setState('wrong_provider'); return }
      }
      if (!res.ok) throw new Error()
      try { sessionStorage.setItem(PENDING_KEY, '1') } catch {}
      setState('sent')
    } catch {
      setState('error')
      setError('Could not send the link. Try again.')
    }
  }

  const card: CSSProperties = {
    width: '100%', textAlign: 'left',
    padding: '14px 16px', background: 'var(--bg-card)',
    border: '1px solid var(--border-dim)', borderRadius: 12,
  }
  const small: CSSProperties = { fontSize: 12.5, color: 'var(--text-3)', lineHeight: 1.5, margin: 0 }
  const linkBtn: CSSProperties = {
    background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit',
    fontSize: 12, color: 'var(--text-4)', textDecoration: 'underline', textUnderlineOffset: 2,
  }

  if (state === 'sent') {
    return (
      <div style={card} {...tourAttr}>
        <p style={{ ...small, color: 'var(--gold)', fontWeight: 600, marginBottom: 4 }}>Check your inbox.</p>
        <p style={small}>
          {isGate ? 'The link brings you straight back to your Council.' : 'The link brings you back here with your decisions connected.'}
          {' '}
          <button style={linkBtn} onClick={() => { try { sessionStorage.removeItem(PENDING_KEY) } catch {} ; setState('idle'); setEmail('') }}>
            Wrong email?
          </button>
        </p>
      </div>
    )
  }

  if (state === 'wrong_provider') {
    return (
      <div style={card} {...tourAttr}>
        <p style={{ ...small, marginBottom: 10 }}>
          <strong style={{ color: 'var(--text-2)' }}>{email}</strong> signed up with Google. Use that to get back in.
        </p>
        <GoogleSignInButton variant="compact" onStart={() => { if (isGate && sessionId) pushSessionIdForSignIn(sessionId); track('auth_started', { stage: mode, surface, method: 'google', arm: arm ?? null }) }} />
      </div>
    )
  }

  if (!expanded && skippable) {
    return (
      <div style={card} {...tourAttr}>
        <p style={{ ...small, marginBottom: 10 }}>{line}</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <button
            className="btn-ghost"
            style={{ fontSize: 13, padding: '9px 16px', minHeight: 40 }}
            onClick={() => setExpanded(true)}
          >
            Keep my record
          </button>
          <button style={linkBtn} onClick={dismiss}>Not now</button>
        </div>
      </div>
    )
  }

  return (
    <div style={card} {...tourAttr}>
      <p style={{ ...small, marginBottom: 12 }}>{line}</p>

      {isGate && inAppName !== 'none' ? (
        // v14: Instagram / Facebook / WhatsApp open links in an embedded browser, and Google refuses sign-in there.
        // Offer the email link as the way in, and say how to use Google if they prefer it.
        <p style={{ ...small, fontSize: 12, marginBottom: 10 }}>
          You are viewing this inside another app&rsquo;s browser, where Google sign-in is blocked. Use your email below, or open this page in Chrome or Safari to use Google.
        </p>
      ) : (
        <>
          <GoogleSignInButton variant="primary" onStart={() => { if (isGate && sessionId) pushSessionIdForSignIn(sessionId); track('auth_started', { stage: mode, surface, method: 'google', arm: arm ?? null }) }} />

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '12px 0' }}>
        <div style={{ flex: 1, height: 1, background: 'var(--border-dim)' }} />
        <span style={{ fontSize: 10.5, color: 'var(--text-5)' }}>or</span>
        <div style={{ flex: 1, height: 1, background: 'var(--border-dim)' }} />
          </div>

        </>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <input
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="your@email.com"
          value={email}
          onChange={e => setEmail(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') sendLink() }}
          disabled={state === 'sending'}
          style={{
            flex: 1, minWidth: 0, background: 'var(--bg-inset)', border: '1px solid var(--border-mid)',
            borderRadius: 8, padding: '9px 12px', fontSize: 13, color: 'var(--text-1)',
            fontFamily: 'inherit', outline: 'none',
          }}
        />
        <button
          className="btn-ghost"
          style={{ fontSize: 12.5, padding: '9px 14px', minHeight: 40, whiteSpace: 'nowrap' }}
          onClick={sendLink}
          disabled={state === 'sending' || !email.trim()}
        >
          {state === 'sending' ? 'Sending\u2026' : 'Email me a link'}
        </button>
      </div>
      {error && <p style={{ fontSize: 11.5, color: 'var(--danger-text, #e07a7a)', margin: '8px 0 0' }}>{error}</p>}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
        <span style={{ fontSize: 11, color: 'var(--text-5)' }}>
          {isGate ? 'No password. Your decision stays private.' : mode === 'd3_gate' ? 'No password. Your existing records stay open.' : 'No password. Just a link, or Google.'}
        </span>
        {skippable && <button style={linkBtn} onClick={dismiss}>Not now</button>}
      </div>
    </div>
  )
}

'use client'

// components/AdvisoryUpsellCard.tsx
// ── Mirror Advisory upsell card (Phase 4/5, request CTA added Sprint M7) ─────
//
// Rendered in place of Advisory-only content for 'mirror' tier users.
// Reuses the visual language of the existing teaser/status cards (gold top
// rule, var(--bg-card)) — deliberately NOT a "locked" badge or blur. The point
// is to name what exists and where it lives, not to hide that something is
// missing.
//
// Bug fix (issue #6 review): this card used to be a pure dead end — named a
// benefit, gave no way to act on it. Advisory is capped-cohort and manually
// granted (see app/api/admin/grant-mirror-access), so there's no self-serve
// payment path to wire up here — but a "Request access" CTA at least gives a
// paying 'mirror' user a real next step, and gives a queue
// (advisory_access_requests) to work from instead of nothing.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect } from 'react'

interface Props {
  title:       string
  description: string
  authToken:   string
  source:      'benchmark' | 'sriNextMove' | 'contradictionDetail'
}

type ReqStatus = 'checking' | 'none' | 'pending' | 'contacted' | 'granted' | 'declined' | 'error'

export default function AdvisoryUpsellCard({ title, description, authToken, source }: Props) {
  const [status,     setStatus]     = useState<ReqStatus>('checking')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!authToken) { setStatus('none'); return }
    let cancelled = false
    fetch('/api/mirror/advisory-request', {
      headers: { Authorization: `Bearer ${authToken}` },
    })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!cancelled) setStatus(d?.request?.status ?? 'none') })
      .catch(() => { if (!cancelled) setStatus('none') })
    return () => { cancelled = true }
  }, [authToken])

  const handleRequest = async () => {
    setSubmitting(true)
    try {
      const res = await fetch('/api/mirror/advisory-request', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body:    JSON.stringify({ source }),
      })
      setStatus(res.ok ? 'pending' : 'error')
    } catch {
      setStatus('error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div style={{
      background:   'linear-gradient(180deg, rgba(255,255,255,0.015) 0%, transparent 50%), var(--bg-card)',
      border:       '1px solid var(--border-dim)',
      borderRadius: 12,
      padding:      '16px 18px',
      position:     'relative',
      overflow:     'hidden',
    }}>
      <div style={{
        position: 'absolute', top: 0, left: 0,
        width: '100%', height: 2,
        background: 'linear-gradient(90deg, var(--gold-dim) 0%, transparent 60%)',
      }} />
      <p style={{
        fontSize: 10, fontWeight: 700, color: 'var(--gold)',
        textTransform: 'uppercase', letterSpacing: '0.1em',
        margin: '0 0 6px',
      }}>
        {title}
      </p>
      <p style={{ fontSize: 12.5, color: 'var(--text-4)', margin: '0 0 12px', lineHeight: 1.6 }}>
        {description}
      </p>

      {status === 'checking' && null}

      {(status === 'pending' || status === 'contacted') && (
        <p style={{ fontSize: 12, color: 'var(--gold)', margin: 0, fontWeight: 600 }}>
          Request sent — we&apos;ll be in touch.
        </p>
      )}

      {status === 'granted' && (
        <p style={{ fontSize: 12, color: 'var(--gold)', margin: 0, fontWeight: 600 }}>
          You have Advisory access — refresh to see it.
        </p>
      )}

      {(status === 'none' || status === 'declined' || status === 'error') && (
        <>
          {status === 'error' && (
            <p style={{ fontSize: 11.5, color: 'var(--text-4)', margin: '0 0 8px' }}>
              Something went wrong — please try again.
            </p>
          )}
          <button className="btn-ghost" onClick={handleRequest} disabled={submitting} style={{ fontSize: 12, padding: '6px 14px' }}>
            {submitting ? 'Sending…' : 'Request access'}
          </button>
        </>
      )}
    </div>
  )
}

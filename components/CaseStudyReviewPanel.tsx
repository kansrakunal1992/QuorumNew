// components/CaseStudyReviewPanel.tsx
// Item #11 — self-contained review queue for the admin dashboard
// (app/admin/page.tsx). Fetches its own data using the already-authenticated
// admin code passed down as a prop, so it doesn't touch the existing R7/R8
// dashboard fetch/state logic at all.
//
// Revamp: switched from hardcoded Tailwind zinc-* classes to the site's
// theme tokens (var(--bg-card) etc.) — this panel previously ignored the
// light/dark toggle entirely. Reports its pending count up via onCountChange
// so the page-level "action items" bar can fold it into one place.

'use client'

import { useState, useEffect, useCallback } from 'react'
import Tooltip from './Tooltip'

interface Submission {
  id:               string
  session_id:       string
  user_note:        string | null
  anonymized_draft: string | null
  decision_text:    string | null
  context_text:     string | null
  consent_given_at: string
  created_at:       string
}

export default function CaseStudyReviewPanel({
  adminCode,
  onCountChange,
}: {
  adminCode: string
  onCountChange?: (count: number) => void
}) {
  const [items,  setItems]  = useState<Submission[] | null>(null)
  const [error,  setError]  = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/case-studies', {
        headers: { Authorization: `Bearer ${adminCode}` },
      })
      if (!res.ok) { setError(`Server error ${res.status}`); return }
      const json = await res.json()
      setItems(json.submissions ?? [])
    } catch {
      setError('Network error loading case-study submissions')
    }
  }, [adminCode])

  useEffect(() => { void load() }, [load])

  // Report pending count up to the parent whenever it changes (including
  // 0, so a previously-nonzero badge clears once the queue empties).
  useEffect(() => {
    if (items !== null) onCountChange?.(items.length)
  }, [items, onCountChange])

  const decide = async (id: string, decision: 'approved' | 'rejected') => {
    setBusyId(id)
    try {
      await fetch('/api/admin/case-studies', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminCode}` },
        body:    JSON.stringify({ id, decision }),
      })
      setItems(prev => (prev ?? []).filter(s => s.id !== id))
    } catch {
      setError('Failed to update — try again')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section style={cardStyle}>
      <div style={cardHeaderStyle}>
        <p style={cardHeaderTitleStyle}>Case studies pending review</p>
        {items !== null && items.length > 0 && (
          <Tooltip
            side="left"
            tone="warning"
            label="Submitted by users for the public case-study library. Each needs a human read before anything goes live — check the anonymized draft doesn't leak identifying detail."
          >
            <span style={pendingBadgeStyle}>{items.length} pending</span>
          </Tooltip>
        )}
      </div>

      <div style={{ padding: '16px 18px 18px' }}>
        {error && <p style={{ fontSize: 12, color: 'var(--error)', margin: '0 0 12px' }}>{error}</p>}

        {items === null && !error && (
          <p style={{ fontSize: 12.5, color: 'var(--text-4)' }}>Loading case studies…</p>
        )}

        {items?.length === 0 && (
          <p style={{ fontSize: 12.5, color: 'var(--text-4)' }}>Nothing waiting on review.</p>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {items?.map(item => (
            <div key={item.id} style={itemCardStyle}>
              <div>
                <p style={fieldLabelStyle}>Original decision</p>
                <p style={fieldTextStyle}>{item.decision_text || '—'}</p>
              </div>

              {item.context_text && (
                <div>
                  <p style={fieldLabelStyle}>Context</p>
                  <p style={{ ...fieldTextStyle, color: 'var(--text-3)' }}>{item.context_text}</p>
                </div>
              )}

              {item.user_note && (
                <div>
                  <p style={fieldLabelStyle}>User&rsquo;s note</p>
                  <p style={{ ...fieldTextStyle, color: 'var(--text-3)', fontStyle: 'italic' }}>{item.user_note}</p>
                </div>
              )}

              <div>
                <p style={fieldLabelStyle}>
                  AI-drafted anonymized starting point — edit before using anywhere
                </p>
                <p style={{ ...fieldTextStyle, background: 'var(--bg-inset)', borderRadius: 8, padding: '8px 10px' }}>
                  {item.anonymized_draft || 'Draft generation failed — write this one by hand.'}
                </p>
              </div>

              <div style={{ display: 'flex', gap: 8, paddingTop: 2 }}>
                <button
                  onClick={() => decide(item.id, 'approved')}
                  disabled={busyId === item.id}
                  style={approveButtonStyle}
                >
                  Approve
                </button>
                <button
                  onClick={() => decide(item.id, 'rejected')}
                  disabled={busyId === item.id}
                  style={rejectButtonStyle}
                >
                  Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

// ── Shared style tokens (match components/CreateInstitutionPanel.tsx) ──────

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-card)', border: '1px solid var(--border-dim)',
  borderRadius: 14, overflow: 'hidden',
}

const cardHeaderStyle: React.CSSProperties = {
  padding: '13px 18px 11px', borderBottom: '1px solid var(--border-dim)',
  background: 'var(--bg-card-alt)', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
}

const cardHeaderTitleStyle: React.CSSProperties = {
  fontSize: 12.5, fontWeight: 600, color: 'var(--text-2)', margin: 0,
}

const pendingBadgeStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 600, color: 'var(--gold)', background: 'var(--gold-glow)',
  border: '1px solid var(--gold-dim)', borderRadius: 20, padding: '3px 10px', cursor: 'help',
}

const itemCardStyle: React.CSSProperties = {
  border: '1px solid var(--border-dim)', borderRadius: 10, padding: 14,
  display: 'flex', flexDirection: 'column', gap: 10,
}

const fieldLabelStyle: React.CSSProperties = {
  fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.06em',
  color: 'var(--text-4)', margin: '0 0 4px', fontFamily: 'var(--font-mono)',
}

const fieldTextStyle: React.CSSProperties = {
  fontSize: 12.5, lineHeight: 1.65, color: 'var(--text-2)', margin: 0,
}

const approveButtonStyle: React.CSSProperties = {
  fontSize: 12, fontWeight: 600, padding: '7px 14px', borderRadius: 7, cursor: 'pointer',
  background: 'var(--success-bg)', color: 'var(--success-text)', border: '1px solid var(--success-border)',
}

const rejectButtonStyle: React.CSSProperties = {
  fontSize: 12, padding: '7px 14px', borderRadius: 7, cursor: 'pointer',
  background: 'transparent', color: 'var(--text-3)', border: '1px solid var(--border-mid)',
}

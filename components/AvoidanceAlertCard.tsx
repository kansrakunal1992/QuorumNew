'use client'

// components/AvoidanceAlertCard.tsx
// ── Sprint D3: Avoidance Detection — Mirror Surface ───────────────────────────
//
// Renders one card per undismissed avoidance alert returned by
// GET /api/mirror/alerts (avoidanceAlerts[] field, added Sprint D3).
//
// Props: alerts[] (already fetched by mirror/page.tsx via the alerts route),
// authToken (for dismiss calls).
//
// Each card:
//   - States how long the decision has been open ("You first brought this N days ago")
//   - Shows the decision text snippet (truncated to 120 chars)
//   - If structural_echo exists (a prior resolved session scored ≥60/100 structural
//     similarity), surfaces it: "You've navigated something structurally close before"
//   - "Bring it back →" — writes alertId to localStorage, routes to /?decision=<encoded>
//   - "Mark as resolved →" — calls POST /api/mirror/avoidance/dismiss, removes card
//
// Copy language design: recognition, not accusation. "Hasn't moved" reads as
// observation; "you avoided it" does not. The word "avoidance" never appears.
//
// Dismiss flow:
//   Sets dismissed_at + action_taken on avoidance_alerts row, then navigates
//   to the session's record page so the person can file a real outcome via
//   the normal OutcomeTracker "What did you decide?" flow. Item #33/#34
//   bugfix: this used to instead silently write a placeholder outcomes row
//   (outcome_quality='resolved_externally') with no user input at all and
//   just remove the card — the loop looked closed but nothing about what
//   actually happened was ever recorded. The alert is still dismissed
//   immediately either way (so it never lingers), but now the person is
//   actually offered the chance to record what happened.
//
// Resubmit flow:
//   localStorage.setItem('quorum_resubmit_alert', alertId) before navigating.
//   SynthesisCard reads this at synthesis call time, passes as resubmitAlertId.
//   persona/route.ts prepends RESUBMISSION CONTEXT to synthesis system prompt.
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from 'react'

// ── Types (matches alerts/route.ts avoidanceAlerts shape) ─────────────────────

export interface StructuralEcho {
  sessionId:       string
  matchScore:      number
  decisionSnippet: string
  outcomeSummary:  string
}

export interface AvoidanceAlertData {
  id:               string
  sessionId:        string
  decisionText:     string
  daysOpen:         number
  upstreamDepScore: number | null
  structuralEcho:   StructuralEcho | null
  detectedAt:       string
}

interface Props {
  alerts:    AvoidanceAlertData[]
  authToken: string
}

// ── Dismiss helper ────────────────────────────────────────────────────────────

async function dismissAlert(alertId: string, action: 'new_session' | 'resolved_externally', authToken: string): Promise<boolean> {
  try {
    const res = await fetch('/api/mirror/avoidance/dismiss', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
      body:    JSON.stringify({ alertId, action }),
    })
    return res.ok
  } catch {
    return false
  }
}

// ── Single alert card ─────────────────────────────────────────────────────────

function AlertCard({
  alert,
  authToken,
  onDismissed,
}: {
  alert:       AvoidanceAlertData
  authToken:   string
  onDismissed: (id: string) => void
}) {
  const [dismissing, setDismissing] = useState(false)

  const days = alert.daysOpen
  const timeLabel = days >= 60
    ? `over ${Math.floor(days / 30)} months ago`
    : days >= 14
      ? `${Math.floor(days / 7)} weeks ago`
      : `${days} days ago`

  const handleResubmit = () => {
    // Store alertId so SynthesisCard can pass it to persona route at synthesis time
    try { localStorage.setItem('quorum_resubmit_alert', alert.id) } catch {}
    // Route to submission form with decision pre-filled
    const encoded = encodeURIComponent(alert.decisionText)
    window.location.href = `/?decision=${encoded}`
  }

  const handleResolve = async () => {
    if (dismissing) return
    setDismissing(true)
    const ok = await dismissAlert(alert.id, 'resolved_externally', authToken)
    if (ok) {
      onDismissed(alert.id)
      // Item #33/#34 bugfix: used to stop here (card just disappeared, no
      // outcome ever recorded). Now sends the person to the record page's
      // "What did you decide?" flow — the alert is already dismissed above,
      // so this is a real opportunity, not a requirement to leave the loop
      // closed correctly.
      window.location.href = `/record/${alert.sessionId}`
    } else {
      setDismissing(false)
    }
  }

  return (
    <div style={{
      background:   'rgba(201,168,76,0.04)',
      border:       '1px solid rgba(201,168,76,0.18)',
      borderLeft:   '3px solid var(--gold)',
      borderRadius: 10,
      padding:      '14px 16px',
      marginBottom: 12,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10 }}>
        <span style={{ fontSize: 11, color: 'var(--gold)', opacity: 0.75 }}>◷</span>
        <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--gold)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          Still open
        </span>
      </div>

      {/* Decision text */}
      {alert.decisionText && (
        <p style={{ fontSize: 13, color: 'var(--text-1)', fontWeight: 500, lineHeight: 1.5, margin: '0 0 8px', fontStyle: 'italic' }}>
          &ldquo;{alert.decisionText}{alert.decisionText.length >= 120 ? '…' : ''}&rdquo;
        </p>
      )}

      {/* Core observation */}
      <p style={{ fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.65, margin: '0 0 10px' }}>
        You first brought this {timeLabel}. It hasn&apos;t moved. That&apos;s usually a signal worth
        paying attention to — either the conditions haven&apos;t been right, or the question itself
        has shifted since you first looked at it.
      </p>

      {/* Structural echo — only when present */}
      {alert.structuralEcho && (
        <div style={{
          background:   'rgba(201,168,76,0.06)',
          border:       '1px solid rgba(201,168,76,0.12)',
          borderRadius: 6,
          padding:      '9px 12px',
          marginBottom: 12,
        }}>
          <p style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.6, margin: 0 }}>
            <span style={{ fontWeight: 600, color: 'var(--text-2)' }}>A prior decision was structurally close to this one</span>
            {' '}({alert.structuralEcho.matchScore}/100 match).
            {' '}&ldquo;{alert.structuralEcho.decisionSnippet}{alert.structuralEcho.decisionSnippet.length >= 120 ? '…' : ''}&rdquo;
            {alert.structuralEcho.outcomeSummary && (
              <>{' '}What happened then: &ldquo;{alert.structuralEcho.outcomeSummary}{alert.structuralEcho.outcomeSummary.length >= 120 ? '…' : ''}&rdquo;</>
            )}
            {' '}Worth considering what&apos;s different this time.
          </p>
        </div>
      )}

      {/* CTAs */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <button
          onClick={handleResubmit}
          style={{
            background:   'var(--gold)',
            color:        '#101318',
            border:       'none',
            borderRadius: 6,
            padding:      '7px 14px',
            fontSize:     12,
            fontWeight:   700,
            cursor:       'pointer',
            letterSpacing: '0.02em',
            transition:   'opacity 0.15s',
          }}
          onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.opacity = '0.85')}
          onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.opacity = '1')}
        >
          Bring it back →
        </button>

        <button
          onClick={handleResolve}
          disabled={dismissing}
          style={{
            background:   'transparent',
            color:        'var(--text-3)',
            border:       '1px solid var(--border-dim)',
            borderRadius: 6,
            padding:      '6px 13px',
            fontSize:     12,
            cursor:       dismissing ? 'default' : 'pointer',
            opacity:      dismissing ? 0.5 : 1,
            transition:   'opacity 0.15s',
          }}
        >
          {dismissing ? 'Marking…' : 'Mark as resolved →'}
        </button>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function AvoidanceAlertCard({ alerts, authToken }: Props) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())

  const visible = alerts.filter(a => !dismissed.has(a.id))
  if (visible.length === 0) return null

  const handleDismissed = (id: string) => {
    setDismissed(prev => new Set([...prev, id]))
  }

  return (
    <div style={{ marginBottom: 28 }}>
      <h3 style={{
        fontSize: 13, fontWeight: 700, color: 'var(--text-3)',
        letterSpacing: '0.1em', textTransform: 'uppercase', margin: '0 0 6px',
      }}>
        Decisions Still Open
      </h3>
      <p style={{ fontSize: 12, color: 'var(--text-4)', margin: '0 0 14px', lineHeight: 1.55 }}>
        Decisions you brought to Quorum that haven&apos;t had an outcome recorded — and that your prior analysis flagged as high-stakes.
      </p>
      {visible.map(alert => (
        <AlertCard
          key={alert.id}
          alert={alert}
          authToken={authToken}
          onDismissed={handleDismissed}
        />
      ))}
    </div>
  )
}

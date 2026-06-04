'use client'
// components/RuleRecallBanner.tsx
// ── Sprint Chunk 1 — Rule Recall at session time ───────────────────────────────
//
// Fires between examiner submission and synthesis. Shows the user a rule they've
// previously established (from Mirror → Decision Rules) and asks what they want
// to do with it for this decision.
//
// Requires:
//   — authToken:   valid Bearer token (user must be authenticated)
//   — sessionId:   current session
//   — visible:     parent controls when to mount (after examinerSubmitted)
//
// Behaviour:
//   — Fetches GET /api/mirror/rules with auth token
//   — Silently returns null if: not authenticated, < 8 sessions, no mirror access,
//     no rules returned, or any fetch error.
//   — Shows first rule from the list (most recently derived)
//   — 3 action buttons: Apply this rule | Note as exception | Dismiss
//   — On choice: PATCH /api/session/commitment to save choice + rule text
//   — Dismisses after any action
//
// This component is intentionally lightweight — it does one fetch and either
// shows or hides. No loading state shown to user (silent null on any failure).
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState } from 'react'

interface Props {
  sessionId:  string
  authToken:  string | null
  visible:    boolean           // controls mount timing (set by examinerSubmitted)
}

type BannerState = 'loading' | 'ready' | 'dismissed' | 'hidden'

export default function RuleRecallBanner({ sessionId, authToken, visible }: Props) {
  const [state,       setState]       = useState<BannerState>('loading')
  const [rule,        setRule]        = useState<string | null>(null)
  const [actioning,   setActioning]   = useState(false)

  useEffect(() => {
    if (!visible || !authToken) {
      setState('hidden')
      return
    }

    let cancelled = false

    fetch('/api/mirror/rules', {
      headers: { Authorization: `Bearer ${authToken}` },
    })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (cancelled) return
        const rules: string[] | null = data?.rules
        if (!rules || rules.length === 0) {
          setState('hidden')
          return
        }
        // Show the first rule — they are ordered by derivation, most general first
        setRule(rules[0])
        setState('ready')
      })
      .catch(() => {
        if (!cancelled) setState('hidden')
      })

    return () => { cancelled = true }
  // authToken and visible are stable per session — run once on mount
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, authToken])

  const handleAction = async (choice: 'applied' | 'exception' | 'ignored') => {
    if (actioning || !rule) return
    setActioning(true)

    try {
      await fetch('/api/session/commitment', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          rule_recall_choice:     choice,
          rule_recall_rule_text:  rule,
        }),
      })
    } catch {
      // Non-critical — dismiss regardless
    } finally {
      setState('dismissed')
    }
  }

  if (state === 'loading' || state === 'hidden' || state === 'dismissed') {
    return null
  }

  if (state !== 'ready' || !rule) return null

  const actions: Array<{
    choice:  'applied' | 'exception' | 'ignored'
    label:   string
    primary: boolean
  }> = [
    { choice: 'applied',   label: 'Apply this rule',    primary: true  },
    { choice: 'exception', label: 'Note as exception',  primary: false },
    { choice: 'ignored',   label: 'Dismiss',            primary: false },
  ]

  return (
    <div style={{
      borderRadius: 12,
      border:       '1px solid var(--gold-dim)',
      background:   'var(--gold-glow)',
      padding:      '16px 20px',
      margin:       '16px 0',
    }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{
          fontFamily:    'var(--font-mono)',
          fontSize:      10,
          letterSpacing: '0.13em',
          textTransform: 'uppercase',
          color:         'var(--gold)',
        }}>
          Rule recall
        </span>
        <span style={{
          fontSize:  10,
          color:     'var(--text-4)',
          fontStyle: 'italic',
        }}>
          — from your prior decisions
        </span>
      </div>

      {/* Rule text */}
      <p style={{
        fontSize:     13.5,
        color:        'var(--text-1)',
        fontStyle:    'italic',
        lineHeight:   1.55,
        marginBottom: 14,
      }}>
        &ldquo;{rule}&rdquo;
      </p>

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {actions.map(({ choice, label, primary }) => (
          <button
            key={choice}
            onClick={() => handleAction(choice)}
            disabled={actioning}
            className={primary ? 'btn-primary' : 'btn-ghost'}
            style={{ fontSize: 12, padding: '7px 16px' }}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  )
}

'use client'
// components/RuleRecallBanner.tsx
// ── Sprint Chunk 1 (fix) — Rule Recall BEFORE examiner submission ─────────────
//
// Fires when ontologyReady = true, BEFORE the user submits examiner answers.
// This gives the user time to factor the recalled rule into their responses,
// and ensures the "Apply" choice is captured before handleExaminerComplete
// fires — so the rule text is available for injection into synthesis context.
//
// Requires:
//   — authToken:      valid Bearer token
//   — sessionId:      current session
//   — visible:        ontologyReady && !examinerSubmitted (parent-controlled)
//   — onRuleApplied:  callback fired when user clicks "Apply" — passes rule
//                     text to SessionView for injection into Council context
//
// Behaviour:
//   — Fetches /api/mirror/rules on mount (silent null on any failure)
//   — Shows first rule from the list
//   — 3 actions: Apply this rule | Note as exception | Dismiss
//   — "Apply": calls onRuleApplied(rule) THEN saves to DB THEN dismisses
//   — Window auto-closes when visible becomes false (examiner submitted without
//     a choice) — banner dismissed, no DB write, no injection
//   — All non-apply choices: DB write only, no injection
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState } from 'react'

interface Props {
  sessionId:     string
  authToken:     string | null
  visible:       boolean            // ontologyReady && !examinerSubmitted
  onRuleApplied?: (rule: string) => void  // Sprint Chunk 1 fix — inject into synthesis
}

type BannerState = 'loading' | 'ready' | 'dismissed' | 'hidden'

export default function RuleRecallBanner({ sessionId, authToken, visible, onRuleApplied }: Props) {
  const [state,       setState]       = useState<BannerState>('loading')
  const [rule,        setRule]        = useState<string | null>(null)
  const [actioning,   setActioning]   = useState(false)

  // Auto-dismiss when the examiner is submitted before a choice is made.
  // visible flips false → the window has closed, no injection, no DB write.
  useEffect(() => {
    if (!visible && state === 'ready') setState('dismissed')
  }, [visible, state])

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

    // Fire injection callback FIRST — before any async work — so SessionView's
    // appliedRuleRef is set before handleExaminerComplete has a chance to fire.
    if (choice === 'applied' && onRuleApplied) {
      onRuleApplied(rule)
    }

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

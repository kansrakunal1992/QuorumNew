// components/StyleCalibration.tsx
// Sprint 21: Style calibration onboarding — 3-question flow.
//
// Renders at the top of Mirror UnlockedView when:
//   sessionCount >= 5  AND  style_cue IS NULL
//
// Once the user completes all 3 questions, their style_cue is derived,
// saved via POST /api/mirror/preferences, and the component disappears
// permanently (controlled by parent via onComplete callback).
//
// Design rules:
//   - One question at a time, inline — no modal
//   - Each question has 2 answer buttons; clicking one advances immediately
//   - Final answer triggers the save and calls onComplete
//   - No loading spinner — save is fire-and-forget; UI dismisses optimistically
//   - Dismissable mid-flow: user can skip (X button) — style_cue remains null
// ─────────────────────────────────────────────────────────────────────────────

'use client'

import { useState } from 'react'

// ── Persistence key ──────────────────────────────────────────────────────────
// Written on both complete AND dismiss so the banner never re-surfaces in
// the same browser, regardless of DB save outcome.
const DISMISSED_KEY = 'quorum_style_calibration_dismissed'

// ── Style derivation ──────────────────────────────────────────────────────────
// 3 questions, each with 2 options mapped to a style tag.
// Final style_cue = the most-selected tag (ties broken by Q1 answer).
const QUESTIONS = [
  {
    id: 'q1',
    text: 'When you bring a decision here, what do you most want the council to do first?',
    options: [
      { label: 'Challenge what I might be missing',    style: 'challenge'    },
      { label: 'Map out how this could go wrong',      style: 'risk'         },
    ],
  },
  {
    id: 'q2',
    text: 'Which advisor do you find yourself re-reading most?',
    options: [
      { label: 'The one that names a pattern from history',  style: 'pattern'     },
      { label: 'The one that surfaces who else is affected', style: 'stakeholder' },
    ],
  },
  {
    id: 'q3',
    text: 'What do you most want the council to slow you down on?',
    options: [
      { label: 'Acting before I\'ve examined the long-term implications', style: 'long'    },
      { label: 'Acting before I\'ve had someone argue the opposite case', style: 'direct'  },
    ],
  },
] as const

type StyleTag = 'challenge' | 'risk' | 'pattern' | 'stakeholder' | 'long' | 'direct'

function deriveStyleCue(answers: StyleTag[]): StyleTag {
  const counts: Record<string, number> = {}
  for (const tag of answers) counts[tag] = (counts[tag] ?? 0) + 1
  // Highest count wins; ties broken by Q1 answer (answers[0])
  const max = Math.max(...Object.values(counts))
  const winners = (Object.keys(counts) as StyleTag[]).filter(k => counts[k] === max)
  return winners.length === 1 ? winners[0] : answers[0]
}

// ── Props ─────────────────────────────────────────────────────────────────────
interface Props {
  authToken: string
  onComplete: (styleCue: StyleTag) => void
  onDismiss:  () => void
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function StyleCalibration({ authToken, onComplete, onDismiss }: Props) {
  const [step,    setStep]    = useState(0)
  const [answers, setAnswers] = useState<StyleTag[]>([])

  const question = QUESTIONS[step]
  const progress = step / QUESTIONS.length  // 0 → 1

  async function handleAnswer(style: StyleTag) {
    const next = [...answers, style]
    setAnswers(next)

    if (next.length < QUESTIONS.length) {
      setStep(s => s + 1)
      return
    }

    // Final answer — derive + save
    const cue = deriveStyleCue(next)
    // Persist locally first so banner never re-surfaces even if POST fails
    try { localStorage.setItem(DISMISSED_KEY, 'true') } catch { /* private browsing */ }
    try {
      await fetch('/api/mirror/preferences', {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({ style_cue: cue }),
      })
    } catch {
      // Non-critical — ordering will just use rule/dim signals only
    }
    onComplete(cue)
  }

  return (
    <div style={{
      border:       '1px solid var(--border)',
      borderRadius: 6,
      padding:      '22px 24px 20px',
      marginBottom: 32,
      position:     'relative',
      background:   'var(--surface)',
    }}>

      {/* Dismiss */}
      <button
        onClick={() => {
          try { localStorage.setItem(DISMISSED_KEY, 'true') } catch { /* private browsing */ }
          onDismiss()
        }}
        title="Skip calibration"
        style={{
          position:   'absolute',
          top:        12,
          right:      14,
          background: 'none',
          border:     'none',
          cursor:     'pointer',
          color:      'var(--text-4)',
          fontSize:   16,
          lineHeight: 1,
          padding:    2,
        }}
      >
        ×
      </button>

      {/* Header */}
      <div style={{ marginBottom: 14 }}>
        <span style={{
          fontSize:      10,
          fontWeight:    700,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color:         'var(--gold)',
        }}>
          Calibrate your council · {step + 1} of {QUESTIONS.length}
        </span>

        {/* Progress bar */}
        <div style={{
          height:       2,
          background:   'var(--border)',
          borderRadius: 1,
          marginTop:    8,
          overflow:     'hidden',
        }}>
          <div style={{
            height:           '100%',
            width:            `${((step) / QUESTIONS.length) * 100}%`,
            background:       'var(--gold)',
            borderRadius:     1,
            transition:       'width 300ms ease',
          }} />
        </div>
      </div>

      {/* Question */}
      <p style={{
        fontSize:   13,
        color:      'var(--text-1)',
        lineHeight: 1.55,
        margin:     '0 0 18px',
        paddingRight: 20,
      }}>
        {question.text}
      </p>

      {/* Answer buttons */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {question.options.map(opt => (
          <button
            key={opt.style}
            onClick={() => handleAnswer(opt.style)}
            style={{
              textAlign:    'left',
              padding:      '10px 14px',
              border:       '1px solid var(--border)',
              borderRadius: 4,
              background:   'none',
              cursor:       'pointer',
              fontSize:     13,
              color:        'var(--text-2)',
              lineHeight:   1.45,
              transition:   'border-color 150ms, color 150ms',
            }}
            onMouseEnter={e => {
              ;(e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--gold)'
              ;(e.currentTarget as HTMLButtonElement).style.color = 'var(--text-1)'
            }}
            onMouseLeave={e => {
              ;(e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border)'
              ;(e.currentTarget as HTMLButtonElement).style.color = 'var(--text-2)'
            }}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Footer note */}
      <p style={{
        fontSize:   11,
        color:      'var(--text-4)',
        margin:     '14px 0 0',
        lineHeight: 1.5,
      }}>
        This adjusts which advisor leads your council — not what they say.
      </p>
    </div>
  )
}

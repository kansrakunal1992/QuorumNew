'use client'

// components/BehaviorAlerts.tsx
// ── Mirror Module: Behavioral Alerts (Sprint 7d — fixed) ─────────────────────
//
// Changes from initial implementation:
//   1. dismissed → Set<string>  (was string|null — caused cycling bug)
//   2. Removed KEYWORD_EXPANSIONS — route now extracts grounded keywords;
//      client-side broad expansion was the low-precision culprit
//   3. Specificity-weighted matching — prefer longest keyword match, not
//      highest detection_count. Avoids Exit Optionality overriding more
//      specific matches because it has accumulated generic keywords.
//   4. Per-bias alert copy — conversational, named consider prompt + action
//   5. Alert text no longer hardcodes "deadline" for every bias
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useRef } from 'react'

// ── Types ─────────────────────────────────────────────────────────────────────

interface AlertBias {
  biasKey:            string
  biasLabel:          string
  detectionCount:     number
  activationKeywords: string[]
}

interface ActiveAlert {
  bias:        AlertBias
  matchedWord: string   // the specific keyword that triggered, shown in action
}

interface Props {
  decision:  string
  authToken: string | null
}

// ── Per-bias alert copy ───────────────────────────────────────────────────────
//
// Each entry has:
//   consider  → the core question to surface (conversational, not accusatory)
//   action    → a 1-line concrete thing to do before submitting
//
// Tone: "a sharp friend who's seen this pattern before" — not a warning label.

const BIAS_COPY: Record<string, { consider: string; action: string }> = {
  exit_optionality_mispricing: {
    consider: "You haven't fully mapped what reversing this would actually require.",
    action:   "Before submitting: add one sentence on what walking away from this looks like in practice.",
  },
  relationship_alignment_assumption: {
    consider: "You may be assuming alignment with a key person rather than having confirmed it.",
    action:   "Name the one person whose support you've assumed — have you actually tested it?",
  },
  complexity_opacity: {
    consider: "There are likely dependencies here you haven't modeled yet.",
    action:   "List one hidden variable that could change the outcome if it moved against you.",
  },
  fomo_urgency: {
    consider: "The urgency in this may not be as real as it feels.",
    action:   "Test it: what would you lose if you waited 2 weeks? Write that in your decision.",
  },
  overconfidence: {
    consider: "Your confidence in the upside may be running ahead of what the evidence supports.",
    action:   "Add your honest worst-case to the framing before the Council sees it.",
  },
  recency_bias: {
    consider: "Recent events are likely shaping this more than the underlying pattern warrants.",
    action:   "What does the 3-year view say, not the last 3 months?",
  },
  control_illusion: {
    consider: "Some of what you're planning to manage may not actually be in your control.",
    action:   "Identify one outcome here that depends entirely on someone else's decision.",
  },
  social_proof: {
    consider: "The fact that others are doing this is doing too much work in your reasoning.",
    action:   "Frame the decision as if you were the only person considering it.",
  },
  loss_aversion_reversal: {
    consider: "You may be protecting against downside in a way that's limiting the actual upside.",
    action:   "State explicitly: what are you willing to risk, and what are you protecting?",
  },
  attribution_asymmetry: {
    consider: "You may be crediting yourself for past wins here in a way that doesn't transfer.",
    action:   "What was different about the last time this worked — and is that true here?",
  },
  speed_bias: {
    consider: "Moving fast on this may feel safer than pausing, but the speed may not be warranted.",
    action:   "Name the cost of slowing this down by 2 weeks. If you can't — that's the signal.",
  },
  uniqueness_fallacy: {
    consider: "You may be treating this situation as more novel than it actually is.",
    action:   "Who else has faced a version of this — and what happened?",
  },
  deference_distortion: {
    consider: "Someone else's view may have anchored you before you've thought it through independently.",
    action:   "What would your position be if you hadn't heard their take first?",
  },
  success_compression: {
    consider: "You may be anchoring on the best-case outcome and building the decision around it.",
    action:   "What does this look like if the most optimistic assumption doesn't hold?",
  },
  network_circularity: {
    consider: "The people you're consulting on this may all share the same blind spots as you.",
    action:   "Who in your network would actively disagree with this — and have you talked to them?",
  },
}

// Fallback for any bias key not in the map
const DEFAULT_COPY = {
  consider: "This pattern has shown up in your past decisions in similar contexts.",
  action:   "Before submitting: is there an assumption in this decision you haven't tested?",
}

function getBiasCopy(biasKey: string) {
  return BIAS_COPY[biasKey] ?? DEFAULT_COPY
}

// ── Matching ──────────────────────────────────────────────────────────────────
//
// Key design decisions (see sprint notes):
//
// 1. No broad expansion map. The route's extractReasoningKeywords now
//    derives terms directly from the AI reasoning text for each session.
//    Adding a client-side expansion map on top of that caused Exit Optionality
//    to match almost any financial decision.
//
// 2. Specificity wins. When multiple biases match, prefer the one matched
//    by the LONGEST keyword (longer = more specific = more signal).
//    This prevents a bias that accumulated many generic short keywords
//    (like 'loss', 'partner') from always winning over one matched by
//    something precise like 'exit plan' or 're-entry'.
//
// 3. Minimum decision length = 20 chars to avoid noise on half-typed text.

interface MatchResult {
  bias:        AlertBias
  matchedWord: string
  specificity: number  // keyword length — used to rank candidates
}

function findBestMatch(
  decisionText: string,
  biases: AlertBias[],
  dismissed: Set<string>,
): ActiveAlert | null {
  if (!decisionText || decisionText.trim().length < 20) return null

  const lower = decisionText.toLowerCase()
  const candidates: MatchResult[] = []

  for (const bias of biases) {
    if (dismissed.has(bias.biasKey)) continue

    for (const kw of bias.activationKeywords) {
      // Skip trivially short or noisy keywords
      if (kw.length < 5) continue

      if (lower.includes(kw)) {
        candidates.push({
          bias,
          matchedWord: kw,
          specificity: kw.length,
        })
        break  // one match per bias is enough
      }
    }
  }

  if (candidates.length === 0) return null

  // Pick most specific match (longest keyword)
  candidates.sort((a, b) => b.specificity - a.specificity)

  const best = candidates[0]
  return { bias: best.bias, matchedWord: best.matchedWord }
}

// ── Alert card UI ─────────────────────────────────────────────────────────────

function AlertCard({
  alert,
  onDismiss,
}: {
  alert:     ActiveAlert
  onDismiss: () => void
}) {
  const copy = getBiasCopy(alert.bias.biasKey)

  return (
    <div
      role="alert"
      style={{
        background:   'rgba(201,168,76,0.06)',
        border:       '1px solid rgba(201,168,76,0.25)',
        borderLeft:   '3px solid var(--gold)',
        borderRadius: 10,
        padding:      '12px 14px',
        marginTop:    12,
        animation:    'alert-fade-in 0.3s ease-out',
      }}
    >
      <style>{`
        @keyframes alert-fade-in {
          from { opacity: 0; transform: translateY(-4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 7 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span style={{ fontSize: 11, color: 'var(--gold)', opacity: 0.7 }}>⚠</span>
          <span style={{
            fontSize:      10.5,
            fontWeight:    700,
            color:         'var(--gold)',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
          }}>
            Pattern recognised
          </span>
        </div>
        <button
          onClick={onDismiss}
          aria-label="Dismiss alert"
          style={{
            background: 'none',
            border:     'none',
            color:      'var(--text-4)',
            cursor:     'pointer',
            fontSize:   16,
            lineHeight: 1,
            padding:    '0 2px',
            flexShrink: 0,
            opacity:    0.5,
            transition: 'opacity 0.15s',
          }}
          onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.opacity = '1')}
          onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.opacity = '0.5')}
        >
          ×
        </button>
      </div>

      {/* Bias name + count */}
      <p style={{ fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.6, margin: '0 0 6px' }}>
        <span style={{ fontWeight: 600, color: 'var(--text-1)' }}>
          {alert.bias.biasLabel}
        </span>
        {' '}has shown up in {alert.bias.detectionCount} of your past decisions.{' '}
        {copy.consider}
      </p>

      {/* Action */}
      <p style={{
        fontSize:    12,
        color:       'var(--text-3)',
        lineHeight:  1.55,
        margin:      '0 0 10px',
        fontStyle:   'italic',
        paddingLeft: 10,
        borderLeft:  '2px solid rgba(201,168,76,0.3)',
      }}>
        {copy.action}
      </p>

      {/* Mirror CTA */}
      <a
        href="/mirror"
        style={{
          fontSize:       11,
          color:          'var(--gold)',
          textDecoration: 'none',
          fontWeight:     600,
          opacity:        0.75,
          transition:     'opacity 0.15s',
          display:        'inline-block',
        }}
        onMouseEnter={e => ((e.currentTarget as HTMLAnchorElement).style.opacity = '1')}
        onMouseLeave={e => ((e.currentTarget as HTMLAnchorElement).style.opacity = '0.75')}
      >
        See your full pattern profile in Mirror →
      </a>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function BehaviorAlerts({ decision, authToken }: Props) {
  const [biases,      setBiases]      = useState<AlertBias[]>([])
  const [activeAlert, setActiveAlert] = useState<ActiveAlert | null>(null)
  // FIX: was `string | null` — could only track one dismissed bias, causing
  // the cycling bug where dismissing B re-exposed A.
  const [dismissed,   setDismissed]   = useState<Set<string>>(new Set())
  const debounceRef                    = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Load confirmed biases on mount ────────────────────────────────────────
  useEffect(() => {
    if (!authToken) return

    const load = async () => {
      try {
        const res  = await fetch('/api/mirror/alerts', {
          headers: { Authorization: `Bearer ${authToken}` },
        })
        if (!res.ok) return
        const data = await res.json() as { alerts: AlertBias[] }
        setBiases(data.alerts ?? [])
      } catch {
        // silent fail — never block the user's flow
      }
    }

    load()
  }, [authToken])

  // ── Debounced keyword matching ────────────────────────────────────────────
  useEffect(() => {
    if (biases.length === 0) return

    if (debounceRef.current) clearTimeout(debounceRef.current)

    debounceRef.current = setTimeout(() => {
      setActiveAlert(findBestMatch(decision, biases, dismissed))
    }, 800)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [decision, biases, dismissed])

  if (!authToken || !activeAlert) return null

  return (
    <AlertCard
      alert={activeAlert}
      onDismiss={() => {
        // FIX: add to Set, not replace — preserves all previously dismissed biases
        setDismissed(prev => new Set([...prev, activeAlert.bias.biasKey]))
        setActiveAlert(null)
      }}
    />
  )
}

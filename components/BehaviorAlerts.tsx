'use client'

// components/BehaviorAlerts.tsx
// ── Mirror Module: Behavioral Alerts (Sprint 7d) ──────────────────────────────
//
// Shown on the home page below the decision input. Fires a lightweight
// client-side keyword check against the user's confirmed bias patterns
// as they type their decision.
//
// Props:
//   decision   → the current decision textarea value (from parent)
//   authToken  → Supabase Bearer token (null = not authenticated, show nothing)
//
// Behaviour:
//   - On mount: fetch /api/mirror/alerts → load confirmed bias patterns
//   - 800ms debounce on `decision` change → run client-side keyword match
//   - Show at most 1 alert (the strongest match by detection_count)
//   - Dismissible per-session (dismissed state lives in component state only)
//   - No AI call; no added latency to submission
//   - Silently shows nothing on any error
//
// Only rendered for authenticated users with ≥1 confirmed bias.
// Parent (page.tsx) passes authToken — if null, this component renders null.
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
  matchedWord: string
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  decision:  string
  authToken: string | null
}

// ── Keyword matching ──────────────────────────────────────────────────────────
//
// Tokenise the decision text to words (lowercase), then check if any
// activation keyword is contained in the text or matches a word.
// "time pressure" → also matches "deadline", "urgent", "expires"
//
// Supplementary keyword expansion for common activation signals:
const KEYWORD_EXPANSIONS: Record<string, string[]> = {
  'time pressure':          ['deadline', 'urgent', 'expires', 'expiry', 'limited time', 'by monday', 'by friday', 'end of month', 'eod', 'asap', 'quickly', 'fast', 'rush'],
  'financial':              ['money', 'capital', 'investment', 'fund', 'funds', 'revenue', 'profit', 'loss', 'equity', 'stake', 'shares', 'valuation', 'returns', 'salary', 'crore', 'lakh'],
  'career':                 ['job', 'role', 'promotion', 'resign', 'leave', 'joining', 'offer', 'position', 'leadership', 'founder', 'cxo', 'ceo', 'cfo'],
  'trusted contact':        ['friend', 'mentor', 'colleague', 'partner', 'peer', 'investor', 'advisor', 'board', 'recommends', 'suggested', 'told me'],
  'high commitment':        ['irreversible', 'long term', 'permanent', 'lock in', 'commit', 'binding', 'contract', 'sign'],
  'family':                 ['family', 'spouse', 'wife', 'husband', 'parent', 'father', 'mother', 'brother', 'sister', 'children', 'kids'],
  'social proof':           ['everyone', 'everyone is', 'others are', 'friends are', 'competitors are', 'market is moving', 'trend', 'fomo'],
  'anxiety':                ['worried', 'scared', 'nervous', 'anxious', 'stress', 'fear', 'uncertain', 'unsure', 'doubt', 'panic'],
}

function expandKeywords(keywords: string[]): string[] {
  const expanded = new Set(keywords)
  for (const kw of keywords) {
    const extras = KEYWORD_EXPANSIONS[kw]
    if (extras) extras.forEach(e => expanded.add(e))
  }
  return Array.from(expanded)
}

function matchesBias(decisionText: string, bias: AlertBias): string | null {
  if (!decisionText || decisionText.trim().length < 15) return null
  const lower    = decisionText.toLowerCase()
  const expanded = expandKeywords(bias.activationKeywords)

  for (const kw of expanded) {
    if (kw.length >= 4 && lower.includes(kw)) {
      return kw
    }
  }
  return null
}

// ── Alert card UI ─────────────────────────────────────────────────────────────

function AlertCard({
  alert,
  onDismiss,
}: {
  alert:     ActiveAlert
  onDismiss: () => void
}) {
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
        position:     'relative',
        animation:    'alert-fade-in 0.3s ease-out',
      }}
    >
      <style>{`
        @keyframes alert-fade-in {
          from { opacity: 0; transform: translateY(-4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span style={{ fontSize: 11, color: 'var(--gold)', opacity: 0.7 }}>⚠</span>
          <span style={{
            fontSize:      10.5,
            fontWeight:    700,
            color:         'var(--gold)',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
          }}>
            Pattern detected
          </span>
        </div>
        <button
          onClick={onDismiss}
          aria-label="Dismiss alert"
          style={{
            background:    'none',
            border:        'none',
            color:         'var(--text-4)',
            cursor:        'pointer',
            fontSize:      14,
            lineHeight:    1,
            padding:       '0 2px',
            flexShrink:    0,
            opacity:       0.6,
            transition:    'opacity 0.15s',
          }}
          onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.opacity = '1')}
          onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.opacity = '0.6')}
        >
          ×
        </button>
      </div>

      {/* Body */}
      <p style={{ fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.6, margin: '0 0 8px' }}>
        <span style={{ fontWeight: 600, color: 'var(--text-1)' }}>
          {alert.bias.biasLabel}
        </span>
        {' '}has been active in {alert.bias.detectionCount} of your past decisions
        {' '}when this kind of context appears.
      </p>

      {/* Prompt */}
      <p style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.55, margin: '0 0 10px', fontStyle: 'italic' }}>
        Consider: Is there a constraint or deadline in this decision you haven't questioned yet?
      </p>

      {/* Mirror CTA */}
      <a
        href="/mirror"
        style={{
          fontSize:       11,
          color:          'var(--gold)',
          textDecoration: 'none',
          fontWeight:     600,
          opacity:        0.8,
          transition:     'opacity 0.15s',
          display:        'inline-block',
        }}
        onMouseEnter={e => ((e.currentTarget as HTMLAnchorElement).style.opacity = '1')}
        onMouseLeave={e => ((e.currentTarget as HTMLAnchorElement).style.opacity = '0.8')}
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
  const [dismissed,   setDismissed]   = useState<string | null>(null) // dismissed biasKey
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

  // ── Debounced keyword matching on decision text change ────────────────────
  useEffect(() => {
    if (biases.length === 0) return

    if (debounceRef.current) clearTimeout(debounceRef.current)

    debounceRef.current = setTimeout(() => {
      // Find best match (highest detection_count first; already sorted by API)
      let found: ActiveAlert | null = null

      for (const bias of biases) {
        if (bias.biasKey === dismissed) continue
        const matchedWord = matchesBias(decision, bias)
        if (matchedWord) {
          found = { bias, matchedWord }
          break
        }
      }

      setActiveAlert(found)
    }, 800)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [decision, biases, dismissed])

  // ── Nothing to show ───────────────────────────────────────────────────────
  if (!authToken || !activeAlert) return null

  return (
    <AlertCard
      alert={activeAlert}
      onDismiss={() => {
        setDismissed(activeAlert.bias.biasKey)
        setActiveAlert(null)
      }}
    />
  )
}

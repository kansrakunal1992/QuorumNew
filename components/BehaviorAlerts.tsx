'use client'

// components/BehaviorAlerts.tsx
// ── Mirror Module: Behavioral Alerts (Sprint 7d — v3) ────────────────────────
//
// Architecture: two-layer matching against the new decision text.
//
// Layer 1 — History keywords (from API)
//   Phrases extracted from past session reasoning for THIS user's confirmed
//   biases. Grounded in actual evidence but vocabulary is narrow — only covers
//   the specific language the AI used when describing past activations.
//
// Layer 2 — Static bias trigger phrases (BIAS_TRIGGER_PHRASES below)
//   Curated vocabulary of how each bias pattern manifests in decision *framing*
//   language. Covers the natural-language surface of new decisions, independent
//   of how past sessions were described. This is the layer that catches the gap:
//   "can always return to a similar role" → exit_optionality_mispricing
//   "last 2 months of market performance" → recency_bias
//
// Match quality tiers (used for ranking when multiple biases fire):
//   TIER_1: history keyword match (most grounded — from actual user sessions)
//   TIER_2: static phrase match (vocabulary-based)
//   Within each tier, longer phrase wins (more specific = higher confidence)
//
// Dismiss fix: Set<string> (was string|null — caused cycling after 2nd dismiss)
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
  tier:        1 | 2
}

interface Props {
  decision:  string
  authToken: string | null
}

// ── Layer 2: Static bias trigger phrase library ───────────────────────────────
//
// Design principles:
//   - Phrases ≥7 chars to reduce false positives (short words match everywhere)
//   - Each phrase should be exclusive to one bias bucket where possible
//   - Cover 3 surface areas per bias: framing language, constraint language,
//     and what the person is avoiding examining
//   - All lowercase — compared against lowercased input
//   - No generic decision verbs ("should I", "thinking about", "considering")
//
// Coverage: 20–30 phrases per bias across natural language variation.
// Validated against all 9 canonical test decisions.

const BIAS_TRIGGER_PHRASES: Record<string, string[]> = {

  exit_optionality_mispricing: [
    'can always return',
    'always go back',
    'always come back',
    'go back to',
    'return to a similar',
    'return later',
    're-entry',
    'reentry',
    'reverse this later',
    'easily reverse',
    'not permanent',
    'can undo',
    'walk away later',
    'exit later',
    'path back',
    'returning to',
    'hiring bias',
    'employment gap',
    'salary loss',
    'salary on return',
    'network decay',
    'resume gap',
    'reversibility',
    'exit strategy',
    'exit plan',
    'exit terms',
    'cost to exit',
    'cost of leaving',
    'it is reversible',
    'reversible decision',
    'walk away from',
    'always able to go back',
  ],

  complexity_opacity: [
    'hidden dependencies',
    'hidden dependency',
    'second-order',
    'second order',
    'unforeseen',
    'unknown unknowns',
    "don't know what i don't know",
    'dont know what i dont know',
    'operational burden',
    'operational complexity',
    'regulatory delay',
    'retention decay',
    'downstream consequences',
    'knock-on effects',
    'knock on effects',
    'cascading risk',
    'hidden costs',
    'hidden cost',
    'unmodelled',
    'unmodeled',
    'edge cases',
    'systemic risk',
    'failure modes',
    'ripple effects',
    'scaling complexity',
    'technical debt',
    'integration risk',
    'compliance risk',
    'dependencies i haven',
    "haven't mapped",
    'have not mapped',
    'second-order operational',
  ],

  control_illusion: [
    'through my effort',
    'through better effort',
    'purely through',
    'if i work harder',
    'effort and responsiveness',
    'personal effort',
    'market volatility',
    'client-side unpredictability',
    'client side unpredictability',
    'external unpredictability',
    'beyond my control',
    'cannot control',
    'outside my control',
    'rely on my belief',
    'depends on others',
    'rely on this belief',
    'believe i can ensure',
    'can ensure success',
    'ensure the outcome',
    'control the outcome',
    'guarantee success',
    'make it work regardless',
    'effort alone',
    'execution will solve',
    'hard work will',
    'better than others at',
  ],

  relationship_alignment_assumption: [
    'verbally agrees',
    'verbal commitment',
    'verbal agreement',
    'says they will',
    'has agreed to',
    'says she will',
    'says he will',
    'promised to',
    'stated support',
    'without testing',
    'without validating',
    'stress scenarios',
    'uneven contribution',
    'assuming alignment',
    'assumed commitment',
    'trust that they',
    'co-founder agreed',
    'partner agreed',
    'everyone agrees',
    'team is aligned',
    'long-term commitment',
    'equal workload',
    'expects them to',
    'rely on their commitment',
    'rely on their support',
    'trusting their word',
    'trusting the verbal',
    'without confirmation',
    'not confirmed',
    'assumed they will',
  ],

  loss_aversion_reversal: [
    'accepting a loss',
    'accept the loss',
    'realising a loss',
    'realizing a loss',
    'sunk cost',
    'sunken cost',
    'already invested',
    'already spent',
    'underperforming investment',
    'underperforming asset',
    'in the red',
    'negative returns',
    'holding it because',
    'holding because',
    'cannot sell',
    "can't sell",
    'will not sell',
    'selling would mean',
    'selling feels like',
    'average down',
    'below cost',
    'below what i paid',
    'recover my losses',
    'recover the loss',
    'wait for it to recover',
    'it will come back',
    'wait until it recovers',
    'lock in a loss',
    'hate to lock in',
    'feels wrong to sell',
    'better opportunities exist',
  ],

  overconfidence: [
    'will succeed',
    'bound to succeed',
    'confident it will work',
    'confident it will succeed',
    'believe it will succeed',
    'cannot fail',
    'detailed plan',
    'thoroughly planned',
    'without modeling failure',
    'without explicitly modeling',
    'failure rates',
    'similar failed attempts',
    'base rate',
    'without accounting for',
    'downside scenarios',
    'plan for success',
    'going to succeed',
    'expecting success',
    'assuming it works',
    'failure is unlikely',
    'very unlikely to fail',
    'strong conviction',
    'high confidence',
    'done this before',
    'worked before so',
    'will be different this time',
    'no reason it would fail',
  ],

  fomo_urgency: [
    'limited-time offer',
    'limited time offer',
    'time-limited',
    'within 24 hours',
    'within 48 hours',
    'by end of day',
    'by tomorrow',
    'expires soon',
    'offer expires',
    'closes soon',
    'closing soon',
    'last chance',
    'now or never',
    'decide quickly',
    'act quickly',
    'act fast',
    'time sensitive',
    'time-sensitive',
    'feel pressure to decide',
    'pressure to act',
    'window closes',
    "won't be available",
    'going to miss out',
    'miss the window',
    'miss the opportunity',
    "haven't fully evaluated",
    "haven't fully analysed",
    'without full evaluation',
    'other buyers',
    'competitive offer',
    'someone else will take',
    'pressure to decide',
  ],

  recency_bias: [
    'last 2 months',
    'last 3 months',
    'last 6 months',
    'past few weeks',
    'past 2 weeks',
    'past few months',
    'recent performance',
    'recent data',
    'recent results',
    'recent market',
    'based on recent',
    'recent trend',
    'recent appreciation',
    'recent gains',
    'recent losses',
    'lately it has',
    'recently it has',
    'current momentum',
    'current trend',
    'short-term trend',
    'short term trend',
    'trailing data',
    'last quarter performance',
    'recent success',
    'recent failure',
    'been doing well recently',
    'has been growing recently',
    'main basis',
    'primary basis',
    'using recent data',
    'based primarily on the last',
  ],

  attribution_asymmetry: [
    'attribute to my skill',
    'attribute to skill',
    'credit myself',
    'my own skill',
    'due to my ability',
    'because of my skills',
    'bad luck',
    'external factors caused',
    'blame the market',
    'market was unfavorable',
    'circumstances were against',
    'skill when succeeded',
    'succeeded because i',
    'failed because of',
    'lucky when it worked',
    'evaluating my performance',
    'performance evaluation',
    'self-assessment',
    'judging my own performance',
    'take credit for',
    'not my fault',
    'attribute my success',
    'attribute my failure',
  ],

  social_proof: [
    'everyone is doing',
    'everyone else is',
    'others are doing',
    'competitors are doing',
    'industry is moving',
    'market is moving toward',
    'peers are doing',
    'everyone else seems to',
    'trend is moving',
    'others have done',
    'all the others',
    'most companies are',
    'most founders are',
    'because others are',
    'following the trend',
    'following the market',
    'if others are',
    'others are succeeding',
    'everyone i know is',
  ],

  deference_distortion: [
    'my mentor says',
    'mentor told me',
    'advisor told me',
    'advisor says',
    'they recommended',
    'they told me to',
    'my investor says',
    'board told me',
    'everyone i asked agrees',
    'expert told me',
    'expert opinion',
    'they know better',
    'defer to them',
    'deferring to',
    'trusting their judgment',
    'on the advice of',
    'based on their advice',
    'before forming my own view',
    'before i thought it through',
  ],

  success_compression: [
    'best case scenario',
    'if everything goes well',
    'optimistic case',
    'assuming success',
    'if it works out',
    'when it succeeds',
    'upside case',
    'planning around success',
    'building around growth',
    'success case',
    'things go as planned',
    'if all goes well',
    'once it scales',
    'when it scales',
    'assuming product market fit',
    'assuming the best',
    'best outcome',
  ],

  speed_bias: [
    'move fast',
    'move quickly',
    'first mover',
    'first to market',
    'ship quickly',
    'faster than competitors',
    'ahead of the competition',
    'before others do',
    'speed advantage',
    'rapid deployment',
    'rapid execution',
    'execute quickly',
    'launch quickly',
    'launch fast',
    'speed is critical',
    'speed is everything',
    'being fast matters',
    'cannot wait',
    'no time to wait',
    'if we wait we lose',
  ],

  uniqueness_fallacy: [
    'never been done',
    'first of its kind',
    'unique situation',
    'different this time',
    'no comparable',
    'no precedent',
    'unprecedented',
    'unlike anything else',
    'no analogy',
    'cannot compare to',
    'nothing like this before',
    'completely new category',
    'fundamentally different',
    'no one has done this',
    'category creator',
    'creating a new category',
    'entirely new market',
    'no existing playbook',
  ],

  network_circularity: [
    'people i trust agree',
    'everyone i know agrees',
    'my network agrees',
    'inner circle agrees',
    'people close to me think',
    'my team agrees',
    'my investors agree',
    'my advisors agree',
    'everyone around me',
    'consulted my network',
    'asked my team',
    'they all agree',
    'they all think',
    'no one disagrees',
    'nobody disagrees',
    'everyone supports this',
  ],
}

// ── Per-bias alert copy ───────────────────────────────────────────────────────

const BIAS_COPY: Record<string, { consider: string; action: string }> = {
  exit_optionality_mispricing: {
    consider: "You may not have fully priced what reversing this decision actually requires.",
    action:   "Before submitting: write one sentence on what walking away looks like in practice — including the cost of re-entry.",
  },
  relationship_alignment_assumption: {
    consider: "You may be assuming alignment with a key person rather than having confirmed it.",
    action:   "Name the one person whose support you've assumed — have you actually tested it under pressure?",
  },
  complexity_opacity: {
    consider: "There are likely second-order dependencies here you haven't mapped yet.",
    action:   "List one hidden variable that could change the outcome if it moved against you.",
  },
  fomo_urgency: {
    consider: "The urgency in this may not be as real as it feels right now.",
    action:   "What would you lose if you took 2 more weeks to evaluate? Write that before submitting.",
  },
  overconfidence: {
    consider: "Your confidence in the upside may be running ahead of what the evidence supports.",
    action:   "Add your honest worst-case and a base rate of similar attempts to the framing.",
  },
  recency_bias: {
    consider: "Recent performance is likely shaping this more than the underlying long-term pattern warrants.",
    action:   "What does the 3-year view say, not the last 3 months?",
  },
  control_illusion: {
    consider: "Some of what you're planning to manage may not actually be within your control.",
    action:   "Identify one outcome here that depends entirely on someone else's decision.",
  },
  loss_aversion_reversal: {
    consider: "You may be protecting against realising a loss in a way that's making the decision for you.",
    action:   "State explicitly: what would you do with this if it were new money — not existing exposure?",
  },
  attribution_asymmetry: {
    consider: "The way you're crediting past performance here may not transfer to this context.",
    action:   "What was specifically different about the last time this worked — is that true here?",
  },
  social_proof: {
    consider: "The fact that others are doing this is doing too much work in your reasoning.",
    action:   "Frame the decision as if you were the only person considering it. Does it still hold?",
  },
  deference_distortion: {
    consider: "Someone else's view may have anchored you before you've reasoned through it independently.",
    action:   "What would your position be if you hadn't heard their take first?",
  },
  success_compression: {
    consider: "You may be anchoring this plan on the best-case outcome and building backward from it.",
    action:   "What does this look like if the most optimistic assumption doesn't hold?",
  },
  speed_bias: {
    consider: "Moving fast may feel safer than pausing, but the speed may not be warranted here.",
    action:   "Name the cost of slowing this down by 2 weeks. If you can't — that's the signal.",
  },
  uniqueness_fallacy: {
    consider: "You may be treating this situation as more novel than it actually is.",
    action:   "Who else has faced a version of this — and what happened to them?",
  },
  network_circularity: {
    consider: "The people you're consulting may all share the same blind spot as you on this.",
    action:   "Name one person who would actively disagree. Have you talked to them?",
  },
}

const DEFAULT_COPY = {
  consider: "This pattern has shown up in your past decisions in similar contexts.",
  action:   "Before submitting: is there an assumption here you haven't tested?",
}

function getBiasCopy(biasKey: string) {
  return BIAS_COPY[biasKey] ?? DEFAULT_COPY
}

// ── Two-layer matching ────────────────────────────────────────────────────────

interface MatchCandidate {
  bias:        AlertBias
  matchedWord: string
  tier:        1 | 2
  specificity: number
}

function findBestMatch(
  decisionText: string,
  biases: AlertBias[],
  dismissed: Set<string>,
): ActiveAlert | null {
  if (!decisionText || decisionText.trim().length < 20) return null

  const lower      = decisionText.toLowerCase()
  const candidates: MatchCandidate[] = []

  for (const bias of biases) {
    if (dismissed.has(bias.biasKey)) continue

    // Layer 1: history keywords (grounded in this user's past sessions)
    let tier1Matched = false
    for (const kw of bias.activationKeywords) {
      if (kw.length < 5) continue
      if (lower.includes(kw)) {
        candidates.push({ bias, matchedWord: kw, tier: 1, specificity: kw.length })
        tier1Matched = true
        break
      }
    }

    // Layer 2: static phrase vocabulary (only if Layer 1 didn't already match)
    if (!tier1Matched) {
      const staticPhrases = BIAS_TRIGGER_PHRASES[bias.biasKey] ?? []
      for (const phrase of staticPhrases) {
        if (lower.includes(phrase)) {
          candidates.push({ bias, matchedWord: phrase, tier: 2, specificity: phrase.length })
          break
        }
      }
    }
  }

  if (candidates.length === 0) return null

  // Tier 1 beats Tier 2; within same tier, longer phrase (more specific) wins
  candidates.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier
    return b.specificity - a.specificity
  })

  const best = candidates[0]
  return { bias: best.bias, matchedWord: best.matchedWord, tier: best.tier }
}

// ── Alert card ────────────────────────────────────────────────────────────────

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

      <div style={{
        display:        'flex',
        alignItems:     'flex-start',
        justifyContent: 'space-between',
        gap:            10,
        marginBottom:   7,
      }}>
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

      <p style={{ fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.6, margin: '0 0 6px' }}>
        <span style={{ fontWeight: 600, color: 'var(--text-1)' }}>
          {alert.bias.biasLabel}
        </span>
        {' '}has shown up in {alert.bias.detectionCount} of your past decisions.{' '}
        {copy.consider}
      </p>

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
  const [dismissed,   setDismissed]   = useState<Set<string>>(new Set())
  const debounceRef                    = useRef<ReturnType<typeof setTimeout> | null>(null)

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
      } catch { /* silent fail */ }
    }
    load()
  }, [authToken])

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
        setDismissed(prev => new Set([...prev, activeAlert.bias.biasKey]))
        setActiveAlert(null)
      }}
    />
  )
}

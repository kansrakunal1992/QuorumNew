'use client'

// components/BehaviorAlerts.tsx  (Sprint 8 — phrase library v4)
// ─────────────────────────────────────────────────────────────────────────────
// Changes vs v3:
//   Phrase library expanded after systematic analysis of 90 test cases (9 biases
//   × 10 decisions). Gap categories filled:
//     • Exit optionality  — reversal-assurance phrases ("restart it", "buy it back",
//       "rebuild it", "re-engage", "anytime if needed", "catch up later")
//     • Complexity opacity — dismissal phrases ("looks straightforward",
//       "nothing critical", "simple enough", "already factored", "visible risks")
//     • Control illusion  — "time the market", "offset unpredictable",
//       "manage all variables", "regardless of external factors"
//     • Relationship alignment — "on the same page", "won't back out",
//       "expressed interest", "intent seems clear", "seems supportive"
//     • Loss aversion     — "feel like failure", "confirm i made a mistake",
//       "avoid admitting", "taking a loss", "avoid feeling"
//     • Overconfidence    — "without needing validation", "don't need to model",
//       "clearly better than", "others may fail", "risks are minimal",
//       "judgment here is sufficient"
//     • FOMO/urgency      — "time is running out", "regret missing",
//       "delaying could mean", "shouldn't wait too long"
//     • Recency bias      — outcome-based phrases ("recent trends suggest",
//       "outweigh older", "basing this decision on recent")
//     • Attribution       — "failures weren't my fault", "losses were external",
//       "bad ones were unlucky", "losses reflect"
//
// Architecture unchanged: two-layer matching (history keywords → static phrases),
// specificity-ranked (longer phrase wins), dismiss via Set<string>.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useRef } from 'react'

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
// Rules:
//   - All lowercase; compared against lowercased input
//   - Min 7 chars per phrase — prevents single-word false positives
//   - Each phrase should be exclusive to one bias bucket where possible
//   - Two surface areas per bias: (a) explicit naming language,
//     (b) dismissal / assurance language (the harder-to-catch cases)

const BIAS_TRIGGER_PHRASES: Record<string, string[]> = {

  // ── Exit Optionality Mispricing ───────────────────────────────────────────
  // Catches both explicit reversibility talk AND the casual assurance that
  // return/restart/rebuild is trivially easy.
  exit_optionality_mispricing: [
    // Explicit reversibility
    'can always return',
    'always go back',
    'always come back',
    'always get a similar',
    'return to a similar',
    'return later',
    're-entry',
    'reentry',
    'reversibility',
    'reversible decision',
    'it is reversible',
    'not permanent',
    'can undo',
    'path back',
    'exit strategy',
    'exit plan',
    'exit terms',
    'cost to exit',
    'cost of leaving',
    // Reversal-assurance phrases (v4 additions — the key gap)
    'restart it anytime',
    'restart it if',
    'can restart it',
    'anytime if needed',
    'buy it back',
    'buy back later',
    'rebuild it later',
    'rebuild my network',
    'rebuild it easily',
    're-engage them',
    're-engage later',
    'regain a similar',
    'regain that',
    'catch up later',
    'returning won',
    'returning should',
    're-entry should',
    'minimal cost to return',
    'straightforward to return',
    'easy to return',
    // Career/professional exit signals
    'hiring bias',
    'employment gap',
    'salary loss',
    'network decay',
    'resume gap',
  ],

  // ── Complexity Opacity ────────────────────────────────────────────────────
  // The current library had only explicit problem-naming phrases. Added
  // dismissal phrases — how people signal they *aren't* worried about unknowns.
  complexity_opacity: [
    // Explicit unknowns
    'hidden dependencies',
    'hidden dependency',
    'second-order',
    'second order',
    'unknown unknowns',
    'operational burden',
    'operational complexity',
    'regulatory delay',
    'retention decay',
    'downstream consequences',
    'knock-on effects',
    'cascading risk',
    'hidden costs',
    'unmodelled',
    'unmodeled',
    'failure modes',
    'ripple effects',
    'scaling complexity',
    'technical debt',
    "haven't mapped",
    'have not mapped',
    // Dismissal phrases (v4 additions — biggest gap)
    'looks straightforward',
    'seems straightforward',
    'simple enough to',
    'straightforward enough',
    'accounted for all',
    'already accounted',
    'already factored',
    'nothing critical is missing',
    'nothing critical',
    'plan seems complete',
    'seems complete',
    'visible risks',
    'visible risk seems',
    'what i can see',
    'based on what i see',
    'unseen dependencies',
    'major issues are unlikely',
    'hidden complications are unlikely',
    'unlikely to be complications',
    'no major hidden',
    'everything important',
    'covered the key',
    "don't see major",
  ],

  // ── Control Illusion ──────────────────────────────────────────────────────
  control_illusion: [
    'through my effort',
    'through better effort',
    'purely through',
    'if i work harder',
    'personal effort',
    'can ensure success',
    'ensure the outcome',
    'control the outcome',
    'guarantee success',
    'guarantee the outcome',
    'make it work regardless',
    'effort alone',
    'execution will solve',
    'hard work will',
    // v4 additions
    'time the market',
    'offset unpredictable',
    'manage all variables',
    'avoid most risks',
    'regardless of external',
    'regardless of the market',
    'despite external',
    'despite market',
    'depends mostly on how much',
    'depends on my effort',
    'prevent customer',
    'can control outcomes',
    'success depends on me',
    'success is in my hands',
    'can manage the variables',
  ],

  // ── Relationship Alignment Assumption ─────────────────────────────────────
  // The biggest gap: "on the same page" wasn't in the library at all.
  relationship_alignment_assumption: [
    'verbally agrees',
    'verbal commitment',
    'verbal agreement',
    'says they will',
    'has agreed to',
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
    'everyone agrees',
    'long-term commitment',
    'equal workload',
    'rely on their commitment',
    'trusting their word',
    'without confirmation',
    // v4 additions — the key gap
    'on the same page',
    'won\'t back out',
    'will not back out',
    'expressed interest',
    'interest means',
    'intent seems clear',
    'their intent is clear',
    'seems supportive',
    'appear aligned',
    'appears aligned',
    'seems aligned',
    'said they\'re committed',
    'said they are committed',
    'agrees verbally',
    'contribute equally',
    'follow through',
    'no need to validate',
    'no need to test',
    'proceed without validation',
  ],

  // ── Loss Aversion Reversal ────────────────────────────────────────────────
  loss_aversion_reversal: [
    'accepting a loss',
    'accept the loss',
    'realising a loss',
    'realizing a loss',
    'sunk cost',
    'already invested',
    'already spent',
    'underperforming investment',
    'underperforming asset',
    'in the red',
    'negative returns',
    'holding it because',
    'cannot sell',
    "can't sell",
    'selling would mean',
    'selling feels like',
    'below what i paid',
    'recover my losses',
    'recover the loss',
    'wait for it to recover',
    'wait until it recovers',
    'lock in a loss',
    'hate to lock in',
    'feels wrong to sell',
    // v4 additions
    'feel like failure',
    'feels like failure',
    'would feel like',
    'avoid admitting',
    'avoid feeling the loss',
    'avoid feeling',
    'confirm i made a mistake',
    'admitting it was a mistake',
    'admitting a mistake',
    'taking a loss',
    'take a loss',
    'wait for recovery',
    'waiting for recovery',
    'already put in',
    'what i\'ve put in',
    'realize a negative',
    'do not want to realize',
  ],

  // ── Overconfidence ────────────────────────────────────────────────────────
  // Was missing dismissal-of-validation phrases ("without needing validation",
  // "don't need to model") — the overconfident person doesn't say "I'll succeed";
  // they say they don't *need* to check.
  overconfidence: [
    'will succeed',
    'bound to succeed',
    'confident it will succeed',
    'believe it will succeed',
    'detailed plan',
    'without modeling failure',
    'without explicitly modeling',
    'failure rates',
    'similar failed attempts',
    'base rate',
    'without accounting for',
    'downside scenarios',
    'going to succeed',
    'done this before so',
    'will be different this time',
    'no reason it would fail',
    // v4 additions — the key gap
    'without needing validation',
    'without validation',
    'don\'t need to model',
    'no need to model',
    'no need to validate',
    'no need to test assumptions',
    'don\'t see a need to test',
    'clearly better than',
    'is clearly better',
    'obviously better',
    'confident this will',
    'others may fail',
    'others might fail',
    'risks are minimal',
    'the risk is minimal',
    'don\'t need external input',
    'no need for external',
    'no external input needed',
    'judgment here is sufficient',
    'my judgment is sufficient',
    'my judgment is enough',
    'succeed as designed',
    'likely to succeed as',
  ],

  // ── FOMO / Manufactured Urgency ───────────────────────────────────────────
  fomo_urgency: [
    'limited-time offer',
    'limited time offer',
    'limited-time chance',
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
    'time-sensitive',
    'feel pressure to decide',
    'pressure to act',
    'window closes',
    'going to miss out',
    'miss the window',
    'miss the opportunity',
    "haven't fully evaluated",
    'without full evaluation',
    'other buyers',
    'competitive offer',
    'someone else will take',
    // v4 additions
    'time is running out',
    'running out of time',
    'regret missing this',
    'regret not acting',
    'might regret missing',
    'delaying could mean',
    'delay means losing',
    'shouldn\'t wait too long',
    'should not wait too long',
    'cannot wait too long',
    'decide today or',
    'decide now or',
    'act now before',
    'won\'t be available later',
    'will not be available',
    'opportunity will disappear',
    'before the opportunity disappears',
    'everyone else is moving',
    'pressure to decide immediately',
  ],

  // ── Recency Bias ─────────────────────────────────────────────────────────
  // Was time-period-based only; added outcome-based and trend-based patterns.
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
    'based on recent',
    'recent trend',
    'recent appreciation',
    'recent gains',
    'recent losses',
    'lately it has',
    'recently it has',
    'current momentum',
    'short-term trend',
    'trailing data',
    'last quarter performance',
    // v4 additions — outcome-based recency language
    'recent trends suggest',
    'recent trends indicate',
    'last few outcomes',
    'last few results',
    'basing this decision on recent',
    'basing my decision on recent',
    'happened lately is most relevant',
    'what happened recently',
    'recent data is the best guide',
    'recent experience is the best guide',
    'latest results outweigh',
    'outweigh older',
    'outweigh historical',
    'more than historical data',
    'recent experience more than',
    'current trends define',
    'current trends show',
    'prioritizing what\'s happened recently',
    'recent events are the main basis',
    'recent events are the basis',
    'main basis for this decision',
  ],

  // ── Attribution Asymmetry ─────────────────────────────────────────────────
  // Added the clearest gap: "failures weren't my fault", "losses reflect
  // circumstances", split self/external attribution patterns.
  attribution_asymmetry: [
    'attribute to my skill',
    'attribute to skill',
    'credit myself',
    'my own skill',
    'due to my ability',
    'because of my skills',
    'external factors caused',
    'blame the market',
    'circumstances were against',
    'succeeded because i',
    'failed because of',
    'evaluating my performance',
    'self-assessment',
    'take credit for',
    'not my fault',
    // v4 additions
    'due to my skill',
    'is due to my skill',
    'losses were external',
    'failures were external',
    'losses reflect circumstances',
    'failures reflect circumstances',
    'failures weren\'t my fault',
    'failure wasn\'t my fault',
    'wasn\'t my fault',
    'control success but not failure',
    'control success, but not',
    'bad ones were unlucky',
    'bad results were unlucky',
    'unlucky when it failed',
    'losses due to luck',
    'credit for success not blame',
    'credit for success, not blame',
    'luck when bad',
    'luck when things went wrong',
    'positive outcomes are due to me',
    'negatives aren\'t due to me',
  ],

  // ── Social Proof ──────────────────────────────────────────────────────────
  social_proof: [
    'everyone is doing',
    'everyone else is',
    'others are doing',
    'competitors are doing',
    'industry is moving',
    'market is moving toward',
    'peers are doing',
    'trend is moving',
    'others have done',
    'most companies are',
    'because others are',
    'following the trend',
    'following the market',
    'if others are',
    'others are succeeding',
  ],

  // ── Deference Distortion ──────────────────────────────────────────────────
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
    'they know better',
    'defer to them',
    'deferring to',
    'trusting their judgment',
    'on the advice of',
    'based on their advice',
    'before forming my own view',
  ],

  // ── Success Compression ───────────────────────────────────────────────────
  success_compression: [
    'best case scenario',
    'if everything goes well',
    'optimistic case',
    'assuming success',
    'if it works out',
    'when it succeeds',
    'planning around success',
    'building around growth',
    'success case',
    'things go as planned',
    'if all goes well',
    'once it scales',
    'assuming product market fit',
    'assuming the best',
    'best outcome',
  ],

  // ── Speed Bias ────────────────────────────────────────────────────────────
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
    'rapid execution',
    'launch quickly',
    'launch fast',
    'speed is critical',
    'speed is everything',
    'cannot wait',
    'no time to wait',
    'if we wait we lose',
  ],

  // ── Uniqueness Fallacy ────────────────────────────────────────────────────
  uniqueness_fallacy: [
    'never been done',
    'first of its kind',
    'unique situation',
    'different this time',
    'no comparable',
    'no precedent',
    'unprecedented',
    'unlike anything else',
    'cannot compare to',
    'nothing like this before',
    'fundamentally different',
    'no one has done this',
    'creating a new category',
    'entirely new market',
    'no existing playbook',
  ],

  // ── Network Circularity ───────────────────────────────────────────────────
  network_circularity: [
    'people i trust agree',
    'everyone i know agrees',
    'my network agrees',
    'inner circle agrees',
    'people close to me think',
    'my team agrees',
    'my investors agree',
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
    action:   "Before submitting: write one sentence on what walking away looks like in practice — including the hidden cost of re-entry.",
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

    // Layer 1: history keywords — grounded in user's past sessions
    let tier1Matched = false
    for (const kw of bias.activationKeywords) {
      if (kw.length < 5) continue
      if (lower.includes(kw)) {
        candidates.push({ bias, matchedWord: kw, tier: 1, specificity: kw.length })
        tier1Matched = true
        break
      }
    }

    // Layer 2: static phrase vocabulary — only if Layer 1 didn't match
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

  // Tier 1 beats Tier 2; within same tier, longer phrase wins
  candidates.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier
    return b.specificity - a.specificity
  })

  const best = candidates[0]
  return { bias: best.bias, matchedWord: best.matchedWord, tier: best.tier }
}

// ── Alert card ────────────────────────────────────────────────────────────────

function AlertCard({ alert, onDismiss }: { alert: ActiveAlert; onDismiss: () => void }) {
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

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 7 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span style={{ fontSize: 11, color: 'var(--gold)', opacity: 0.7 }}>⚠</span>
          <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--gold)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            Pattern recognised
          </span>
        </div>
        <button
          onClick={onDismiss}
          aria-label="Dismiss alert"
          style={{ background: 'none', border: 'none', color: 'var(--text-4)', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: '0 2px', flexShrink: 0, opacity: 0.5, transition: 'opacity 0.15s' }}
          onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.opacity = '1')}
          onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.opacity = '0.5')}
        >×</button>
      </div>

      <p style={{ fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.6, margin: '0 0 6px' }}>
        <span style={{ fontWeight: 600, color: 'var(--text-1)' }}>{alert.bias.biasLabel}</span>
        {' '}has shown up in {alert.bias.detectionCount} of your past decisions.{' '}
        {copy.consider}
      </p>

      <p style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.55, margin: '0 0 10px', fontStyle: 'italic', paddingLeft: 10, borderLeft: '2px solid rgba(201,168,76,0.3)' }}>
        {copy.action}
      </p>

      <a
        href="/mirror"
        style={{ fontSize: 11, color: 'var(--gold)', textDecoration: 'none', fontWeight: 600, opacity: 0.75, transition: 'opacity 0.15s', display: 'inline-block' }}
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
        const res  = await fetch('/api/mirror/alerts', { headers: { Authorization: `Bearer ${authToken}` } })
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
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
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

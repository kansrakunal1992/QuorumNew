'use client'

// app/mirror/page.tsx
// ── Mirror Module: Main Page (Sprint 7a) ──────────────────────────────────────
//
// Gate state machine:
//
//   auth      → not authenticated (no user_id from Bearer token)
//               Shows: sign-in prompt with magic link
//
//   threshold → authenticated, < 5 sessions logged
//               Shows: progress bar, what Mirror will reveal
//
//   paywall   → ≥5 sessions, no mirror_access row
//               Shows: full Decision Timeline (free) + locked teaser tiles + CTA
//
//   unlocked  → mirror_access row exists
//               Shows: full Decision Timeline
//               Sprint 7b: adds Bias Fingerprint
//               Sprint 7c: adds Independence Score
//
// Auth pattern: reads Supabase session client-side, sends Bearer token to
// /api/mirror/status and /api/mirror/timeline (same pattern as /api/history).
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useCallback } from 'react'
import { useRouter }     from 'next/navigation'
import { createClient }  from '@/lib/supabase'
import MirrorTimeline         from '@/components/MirrorTimeline'
import BiasFingerprint        from '@/components/BiasFingerprint'
import IndependenceScore      from '@/components/IndependenceScore'
import DecisionRules          from '@/components/DecisionRules'
import ContradictionDetector  from '@/components/ContradictionDetector'
import CalibrationSparkline   from '@/components/CalibrationSparkline'
import SessionReliabilityIndex from '@/components/SessionReliabilityIndex'
import AvoidanceAlertCard     from '@/components/AvoidanceAlertCard'
import type { AvoidanceAlertData } from '@/components/AvoidanceAlertCard'
import MonthlyJudgmentReview  from '@/components/MonthlyJudgmentReview'
import PatternStore           from '@/components/PatternStore'
import StyleCalibration        from '@/components/StyleCalibration'
import MirrorNav               from '@/components/MirrorNav'           // Sprint M2
import MirrorSummaryCard      from '@/components/MirrorSummaryCard'    // Sprint M1
import AttentionZone          from '@/components/AttentionZone'         // Sprint M5
import MirrorInsightCard      from '@/components/MirrorInsightCard'     // Sprint M6
import type { SummaryData }   from '@/components/MirrorSummaryCard'
import type { MirrorStatus, TimelineSession, BenchmarkData, StyleCue } from '@/lib/types'

// ── Bias parameter display labels ─────────────────────────────────────────────
const BIAS_LABELS: Record<string, string> = {
  fomo_urgency:                      'FOMO / Manufactured Urgency',
  overconfidence:                    'Overconfidence',
  attribution_asymmetry:             'Attribution Asymmetry',
  social_proof:                      'Social Proof Bias',
  control_illusion:                  'Control Illusion',
  speed_bias:                        'Speed Bias',
  exit_optionality_mispricing:       'Exit Optionality Mispricing',
  recency_bias:                      'Recency Bias',
  uniqueness_fallacy:                'Uniqueness Fallacy',
  deference_distortion:              'Deference Distortion',
  relationship_alignment_assumption: 'Relationship Alignment',
  success_compression:               'Success Compression',
  commitment_escalation:             'Commitment Escalation',
  information_anchoring:             'Information Anchoring',
  loss_aversion_asymmetry:           'Loss Aversion Asymmetry',
}

function getBiasLabel(key: string): string {
  return BIAS_LABELS[key] ?? key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

// ── Segment progress bar ──────────────────────────────────────────────────────
function SegmentBar({ filled, total }: { filled: number; total: number }) {
  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
      {Array.from({ length: total }).map((_, i) => {
        const isFilled = i < filled
        const isPulse  = i === filled && filled < total
        return (
          <div key={i} style={{
            width:      22,
            height:     3,
            borderRadius: 2,
            background: isFilled ? 'var(--gold)' : 'var(--border-mid)',
            opacity:    isFilled ? 1 : isPulse ? 0.4 : 0.2,
            animation:  isPulse ? 'seg-pulse 2s ease-in-out infinite' : 'none',
            transition: 'background 0.3s',
          }} />
        )
      })}
    </div>
  )
}

// ── Icons ─────────────────────────────────────────────────────────────────────
const IconMirror = ({ size = 32, color = 'var(--gold)' }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke={color} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <ellipse cx="12" cy="5" rx="9" ry="3"/>
    <path d="M3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5"/>
    <path d="M3 12c0 1.66 4.03 3 9 3s9-1.34 9-3"/>
  </svg>
)

const IconLock = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
    <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
  </svg>
)

const IconArrowLeft = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="15 18 9 12 15 6"/>
  </svg>
)

// ── Gate: Not authenticated ───────────────────────────────────────────────────
function AuthGate() {
  const [email,    setEmail]    = useState('')
  const [sending,  setSending]  = useState(false)
  const [sent,     setSent]     = useState(false)
  const [errMsg,   setErrMsg]   = useState('')

  const handleSend = async () => {
    if (!email.trim() || !email.includes('@')) {
      setErrMsg('Enter a valid email address.')
      return
    }
    setErrMsg('')
    setSending(true)
    try {
      const res = await fetch('/api/auth', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email: email.trim().toLowerCase() }),
      })
      if (!res.ok) throw new Error()
      setSent(true)
    } catch {
      setErrMsg('Failed to send link. Try again.')
    } finally {
      setSending(false)
    }
  }

  return (
    <div style={{
      maxWidth:       420,
      margin:         '0 auto',
      padding:        '60px 24px',
      textAlign:      'center',
      display:        'flex',
      flexDirection:  'column',
      alignItems:     'center',
      gap:            20,
    }}>
      <div style={{
        width:         64,
        height:        64,
        borderRadius:  '50%',
        background:    'rgba(201,168,76,0.08)',
        border:        '1px solid var(--gold-dim)',
        display:       'flex',
        alignItems:    'center',
        justifyContent:'center',
      }}>
        <IconMirror size={28} />
      </div>

      <div>
        <h2 style={{ fontSize: 22, fontWeight: 400, fontFamily: 'var(--font-display)', color: 'var(--text-1)', margin: '0 0 4px' }}>
          Your behavioral mirror
        </h2>
        <p style={{ fontSize: 11, color: 'var(--text-4)', fontFamily: 'var(--font-mono)', letterSpacing: '0.06em', margin: '0 0 10px' }}>
          A private operating system for your judgment
        </p>
        <p style={{ fontSize: 15, color: 'var(--text-3)', lineHeight: 1.65, margin: 0 }}>
          Mirror surfaces how you actually make decisions — recurring patterns,
          activated biases, and whether your judgment is evolving across time.
        </p>
      </div>

      {sent ? (
        <div style={{
          width:        '100%',
          padding:      '16px 20px',
          background:   'rgba(201,168,76,0.06)',
          border:       '1px solid var(--gold-dim)',
          borderRadius: 12,
        }}>
          <p style={{ fontSize: 13, color: 'var(--gold)', fontWeight: 600, margin: '0 0 4px' }}>
            Check your email
          </p>
          <p style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.5, margin: 0, fontFamily: 'var(--font-mono)' }}>
            A sign-in link was sent to <span style={{ color: 'var(--text-2)' }}>{email}</span>.
            Click it to access Mirror.
          </p>
        </div>
      ) : (
        <div style={{ width: '100%' }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <input
              type="email"
              placeholder="your@email.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSend()}
              style={{
                flex:         1,
                background:   'var(--bg-inset)',
                border:       '1px solid var(--border-mid)',
                borderRadius: 8,
                padding:      '10px 14px',
                fontSize:     13,
                color:        'var(--text-1)',
                fontFamily:   'inherit',
                outline:      'none',
              }}
              disabled={sending}
            />
            <button
              onClick={handleSend}
              disabled={sending || !email.trim()}
              style={{
                padding:      '10px 18px',
                background:   'rgba(201,168,76,0.12)',
                border:       '1px solid var(--gold-dim)',
                borderRadius: 8,
                color:        'var(--gold)',
                fontSize:     13,
                fontWeight:   600,
                fontFamily:   'inherit',
                cursor:       sending || !email.trim() ? 'not-allowed' : 'pointer',
                opacity:      sending || !email.trim() ? 0.45 : 1,
                whiteSpace:   'nowrap',
                transition:   'opacity 0.15s',
              }}
            >
              {sending ? 'Sending…' : 'Send link →'}
            </button>
          </div>
          {errMsg && (
            <p style={{ fontSize: 11, color: '#e05050', margin: 0 }}>{errMsg}</p>
          )}
          <p style={{ fontSize: 11, color: 'var(--text-4)', margin: '8px 0 0', lineHeight: 1.5 }}>
            No password. A sign-in link is sent to your email.
          </p>
        </div>
      )}
    </div>
  )
}

// ── Gate: Session threshold not met ──────────────────────────────────────────
function LockedView({ sessionCount }: { sessionCount: number }) {
  const router = useRouter()
  const LOCK_THRESHOLD = 3
  const remaining = LOCK_THRESHOLD - sessionCount

  return (
    <div style={{
      maxWidth:       480,
      margin:         '0 auto',
      padding:        '60px 24px',
      display:        'flex',
      flexDirection:  'column',
      alignItems:     'center',
      gap:            28,
    }}>
      <div style={{
        width:          64,
        height:         64,
        borderRadius:   '50%',
        background:     'var(--bg-card)',
        border:         '1px solid var(--border-mid)',
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'center',
        position:       'relative',
      }}>
        <IconMirror size={28} color="var(--text-4)" />
        <div style={{
          position:       'absolute',
          bottom:         -2,
          right:          -2,
          background:     'var(--bg-void)',
          borderRadius:   '50%',
          padding:        2,
          color:          'var(--text-4)',
          lineHeight:     1,
        }}>
          <IconLock size={11} />
        </div>
      </div>

      <div style={{ textAlign: 'center' }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-1)', margin: '0 0 10px' }}>
          Mirror activates at {LOCK_THRESHOLD} decisions
        </h2>
        <p style={{ fontSize: 13.5, color: 'var(--text-3)', lineHeight: 1.65, margin: 0 }}>
          {remaining === 1
            ? 'One more decision and your Mirror preview activates.'
            : `${remaining} more decisions and your Mirror preview activates.`
          }
        </p>
      </div>

      {/* Progress bar */}
      <div style={{
        width:        '100%',
        background:   'var(--bg-card)',
        border:       '1px solid var(--border-dim)',
        borderRadius: 12,
        padding:      '18px 20px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <span style={{ fontSize: 11, color: 'var(--text-4)', fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            Progress
          </span>
          <span style={{ fontSize: 11, color: 'var(--gold)', fontVariantNumeric: 'tabular-nums' }}>
            {sessionCount} / {LOCK_THRESHOLD}
          </span>
        </div>
        <SegmentBar filled={sessionCount} total={LOCK_THRESHOLD} />
      </div>

      {/* Preview of what's coming */}
      <div style={{
        width:        '100%',
        background:   'var(--bg-card)',
        border:       '1px solid var(--border-dim)',
        borderRadius: 12,
        padding:      '18px 20px',
      }}>
        <p style={{ fontSize: 11, color: 'var(--text-4)', fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', margin: '0 0 12px' }}>
          What Mirror reveals
        </p>
        {[
          'How you consistently frame risk across different decision types',
          'Biases that activate under specific conditions — not just "you have FOMO"',
          'Whether your judgment is compounding over time',
          'Patterns you repeat across decisions you think are unrelated',
        ].map((item, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: i < 3 ? 10 : 0 }}>
            <div style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--gold-dim)', marginTop: 7, flexShrink: 0 }} />
            <p style={{ fontSize: 12.5, color: 'var(--text-3)', margin: 0, lineHeight: 1.55 }}>{item}</p>
          </div>
        ))}
      </div>

      <button
        onClick={() => window.history.length > 1 ? router.back() : router.push('/')}
        style={{
          background:   'transparent',
          border:       '1px solid var(--border-mid)',
          borderRadius: 8,
          padding:      '10px 22px',
          color:        'var(--text-3)',
          fontSize:     13,
          fontFamily:   'inherit',
          cursor:       'pointer',
          transition:   'all 0.2s',
        }}
        onMouseEnter={e => {
          ;(e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--gold-dim)'
          ;(e.currentTarget as HTMLButtonElement).style.color       = 'var(--gold)'
        }}
        onMouseLeave={e => {
          ;(e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border-mid)'
          ;(e.currentTarget as HTMLButtonElement).style.color       = 'var(--text-3)'
        }}
      >
        Run another decision →
      </button>
    </div>
  )
}

// ── Teaser tile (paywall state) ───────────────────────────────────────────────
function TeaserTile({ biasKey }: { biasKey: string }) {
  const label = getBiasLabel(biasKey)
  return (
    <div style={{
      background:   'var(--bg-card)',
      border:       '1px solid var(--border-dim)',
      borderRadius: 10,
      padding:      '16px 18px',
      position:     'relative',
      overflow:     'hidden',
    }}>
      {/* Header row — no lock icon */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{
          fontSize:      10,
          fontWeight:    700,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color:         'var(--text-3)',
        }}>
          {label}
        </span>
      </div>

      {/* Blurred content placeholder */}
      <div style={{ filter: 'blur(5px)', userSelect: 'none', pointerEvents: 'none', opacity: 0.5 }}>
        <div style={{ height: 8, background: 'var(--border-mid)', borderRadius: 4, marginBottom: 6, width: '85%' }} />
        <div style={{ height: 8, background: 'var(--border-mid)', borderRadius: 4, marginBottom: 6, width: '70%' }} />
        <div style={{ height: 8, background: 'var(--border-mid)', borderRadius: 4, width: '55%' }} />
      </div>

      <div style={{ display: 'flex', gap: 4, marginTop: 10 }}>
        {[0, 1, 2].map(i => (
          <div key={i} style={{
            width:        8,
            height:       8,
            borderRadius: '50%',
            border:       '1.5px solid var(--border-mid)',
            background:   i === 0 ? 'var(--border-hi)' : 'transparent',
          }} />
        ))}
      </div>
    </div>
  )
}

// ── Unlock code input ─────────────────────────────────────────────────────────
function UnlockCodeInput({ authToken, onSuccess }: { authToken: string; onSuccess: () => void }) {
  const [code,     setCode]     = useState('')
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState('')
  const [expanded, setExpanded] = useState(false)

  const handleUnlock = async () => {
    if (!code.trim()) return
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/mirror/unlock', {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({ code: code.trim() }),
      })
      const data = await res.json()
      if (res.ok) {
        onSuccess()
      } else {
        setError(data.error === 'Invalid unlock code'
          ? "That code isn't right. Check the message we sent you."
          : 'Something went wrong. Try again.')
      }
    } catch {
      setError('Connection error. Check your network and try again.')
    } finally {
      setLoading(false)
    }
  }

  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        style={{
          background:   'transparent',
          border:       '1px solid var(--border-mid)',
          borderRadius: 8,
          padding:      '9px 18px',
          color:        'var(--text-3)',
          fontSize:     12.5,
          fontFamily:   'inherit',
          cursor:       'pointer',
          width:        '100%',
          textAlign:    'center',
          transition:   'all 0.2s',
          marginTop:    12,
        }}
        onMouseEnter={e => {
          ;(e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--gold-dim)'
          ;(e.currentTarget as HTMLButtonElement).style.color       = 'var(--gold)'
        }}
        onMouseLeave={e => {
          ;(e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border-mid)'
          ;(e.currentTarget as HTMLButtonElement).style.color       = 'var(--text-3)'
        }}
      >
        Have an unlock code? Enter it here →
      </button>
    )
  }

  return (
    <div style={{ marginTop: 14 }}>
      <p style={{ fontSize: 11.5, color: 'var(--text-4)', margin: '0 0 8px' }}>
        Enter the code shared with you:
      </p>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          type="text"
          placeholder="Unlock code"
          value={code}
          onChange={e => setCode(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleUnlock()}
          autoFocus
          style={{
            flex:         1,
            background:   'var(--bg-inset)',
            border:       `1px solid ${error ? '#e05050' : 'var(--border-mid)'}`,
            borderRadius: 8,
            padding:      '9px 13px',
            fontSize:     13,
            color:        'var(--text-1)',
            fontFamily:   'monospace',
            outline:      'none',
            letterSpacing:'0.04em',
          }}
          disabled={loading}
        />
        <button
          onClick={handleUnlock}
          disabled={loading || !code.trim()}
          style={{
            padding:      '9px 18px',
            background:   loading || !code.trim() ? 'transparent' : 'rgba(201,168,76,0.12)',
            border:       '1px solid var(--gold-dim)',
            borderRadius: 8,
            color:        'var(--gold)',
            fontSize:     13,
            fontWeight:   600,
            fontFamily:   'inherit',
            cursor:       loading || !code.trim() ? 'not-allowed' : 'pointer',
            opacity:      loading || !code.trim() ? 0.45 : 1,
            whiteSpace:   'nowrap',
            transition:   'all 0.15s',
          }}
        >
          {loading ? 'Checking…' : 'Unlock →'}
        </button>
      </div>
      {error && (
        <p style={{ fontSize: 11, color: '#e05050', margin: '6px 0 0' }}>{error}</p>
      )}
    </div>
  )
}

// ── Teaser View (≥3 sessions, no subscription) ────────────────────────────────
interface TeaserData {
  sessionCount:      number
  patternCount:      number
  independenceScore: number | null
  contradictionCount: number
  calibrationDates:  string[]
  teaserBiases:      string[]
}

function TeaserView({
  status,
  sessions,
  authToken,
  onUnlocked,
}: {
  status: MirrorStatus
  sessions: TimelineSession[]
  authToken: string
  onUnlocked: () => void
}) {
  const [teaser, setTeaser] = useState<TeaserData | null>(null)

  useEffect(() => {
    if (!authToken) return
    fetch('/api/mirror/teaser', {
      headers: { Authorization: `Bearer ${authToken}` },
    })
      .then(r => r.json())
      .then(d => setTeaser(d as TeaserData))
      .catch(() => {/* degrade gracefully */})
  }, [authToken])

  const PRICING_URL = 'https://www.quorumvault.org/#pricing'

  const lockedBadge = (
    <span style={{
      display:        'inline-flex',
      alignItems:     'center',
      gap:            5,
      fontSize:       10,
      color:          'var(--text-4)',
      background:     'var(--bg-card)',
      border:         '1px solid var(--border-dim)',
      borderRadius:   6,
      padding:        '3px 9px',
      fontFamily:     'var(--font-mono)',
      letterSpacing:  '0.06em',
    }}>
      building
    </span>
  )

  return (
    <div style={{ maxWidth: 680, margin: '0 auto', padding: '0 0 60px' }}>

      {/* Section: Decision Timeline (always free) */}
      <div style={{ marginBottom: 40 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <h3 className="mirror-section-h3" style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-3)', letterSpacing: '0.1em', textTransform: 'uppercase', margin: 0 }}>
            Decision Timeline
          </h3>
          <span style={{ fontSize: 11, color: 'var(--text-4)' }}>
            {status.sessionCount} session{status.sessionCount !== 1 ? 's' : ''}
          </span>
        </div>
        <MirrorTimeline sessions={sessions} />
      </div>

      <hr className="gold-rule" style={{ margin: '0 0 32px' }} />

      {/* Section: Mirror stats summary (teaser numbers) */}
      {teaser && (
        <div className="mirror-stats-grid" style={{
          display:             'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap:                 12,
          marginBottom:        32,
        }}>
          {[
            { label: 'Patterns detected',      value: teaser.patternCount > 0 ? String(teaser.patternCount) : '—' },
            {
              label: 'Independence score',
              value: teaser.independenceScore != null
                ? <span style={{ filter: 'blur(6px)', userSelect: 'none' }}>{Math.round(teaser.independenceScore)}</span>
                : '—',
            },
            { label: 'Active contradictions', value: teaser.contradictionCount > 0 ? String(teaser.contradictionCount) : '—' },
          ].map((stat, i) => (
            <div key={i} style={{
              background:   'var(--bg-card)',
              border:       '1px solid var(--border-dim)',
              borderRadius: 10,
              padding:      '14px 16px',
              textAlign:    'center',
            }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-1)', marginBottom: 4 }}>
                {stat.value}
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-4)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                {stat.label}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Section: Bias Fingerprint (locked) */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <h3 className="mirror-section-h3" style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-3)', letterSpacing: '0.1em', textTransform: 'uppercase', margin: 0 }}>
            Bias Fingerprint
          </h3>
          {lockedBadge}
        </div>
        {status.teaserBiases.length > 0 ? (
          <>
            <p style={{ fontSize: 12.5, color: 'var(--text-4)', margin: '0 0 14px', lineHeight: 1.55 }}>
              {status.teaserBiases.length} pattern{status.teaserBiases.length !== 1 ? 's' : ''} detected across your decisions. Activate Mirror to read your full profile.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
              {status.teaserBiases.map(key => (
                <TeaserTile key={key} biasKey={key} />
              ))}
            </div>
          </>
        ) : (
          <p style={{ fontSize: 12.5, color: 'var(--text-4)', margin: 0, lineHeight: 1.55 }}>
            Bias patterns are being compiled from your decisions.
          </p>
        )}
      </div>

      {/* Section: Independence Score (locked / blurred) */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <h3 className="mirror-section-h3" style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-3)', letterSpacing: '0.1em', textTransform: 'uppercase', margin: 0 }}>
            Decision Independence Score
          </h3>
          {lockedBadge}
        </div>
        <div className="mirror-score-row" style={{
          background:   'var(--bg-card)',
          border:       '1px solid var(--border-dim)',
          borderRadius: 10,
          padding:      '18px 20px',
          display:      'flex',
          alignItems:   'center',
          gap:          20,
        }}>
          <div style={{ fontSize: 38, fontWeight: 700, color: 'var(--text-1)', filter: 'blur(8px)', userSelect: 'none', flexShrink: 0 }}>
            {teaser?.independenceScore != null ? Math.round(teaser.independenceScore) : 72}
          </div>
          <p style={{ fontSize: 12.5, color: 'var(--text-4)', margin: 0, lineHeight: 1.55 }}>
            Your independence score measures how much your judgment compounds over time versus deferring to external validation. Visible after activating Mirror.
          </p>
        </div>
      </div>

      {/* Section: Contradiction Detector (locked) */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <h3 className="mirror-section-h3" style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-3)', letterSpacing: '0.1em', textTransform: 'uppercase', margin: 0 }}>
            Contradiction Detector
          </h3>
          {lockedBadge}
        </div>
        <div style={{
          background:   'var(--bg-card)',
          border:       '1px solid var(--border-dim)',
          borderRadius: 10,
          padding:      '16px 20px',
        }}>
          <p style={{ fontSize: 12.5, color: 'var(--text-4)', margin: 0, lineHeight: 1.55 }}>
            {teaser && teaser.contradictionCount > 0
              ? `${teaser.contradictionCount} active contradiction${teaser.contradictionCount !== 1 ? 's' : ''} detected across your decisions. Activate Mirror to see where your stated principles conflict with your actual choices.`
              : 'Scans your decisions for inconsistencies between your stated principles and actual choices. Visible after subscribing.'}
          </p>
        </div>
      </div>

      {/* CTA card */}
      <div className="mirror-cta-card" style={{
        background:   'var(--bg-card)',
        border:       '1px solid var(--gold-dim)',
        borderRadius: 14,
        padding:      '24px 24px',
        marginTop:    36,
      }}>
        <p style={{ fontSize: 12, color: 'var(--gold)', fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', margin: '0 0 10px' }}>
          Activate Mirror — complete your Judgment OS
        </p>
        <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-1)', margin: '0 0 6px' }}>
          Your behavioral mirror is already building.
        </p>
        <p style={{ fontSize: 13, color: 'var(--text-3)', lineHeight: 1.6, margin: '0 0 20px' }}>
          From ₹9,999/year · ₹1,499/month. The same quality of insight advisors charge ₹50,000 for — derived from your actual decisions, not a questionnaire.
        </p>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <a
            className="mirror-cta-btn"
            href={PRICING_URL}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display:      'inline-block',
              padding:      '10px 22px',
              background:   'rgba(201,168,76,0.12)',
              border:       '1px solid var(--gold-dim)',
              borderRadius: 8,
              color:        'var(--gold)',
              fontSize:     13,
              fontWeight:   600,
              fontFamily:   'inherit',
              textDecoration: 'none',
              transition:   'all 0.15s',
            }}
          >
            See plans →
          </a>
        </div>
        <UnlockCodeInput authToken={authToken} onSuccess={onUnlocked} />
      </div>
    </div>
  )
}

// ── Benchmark module (Sprint 20) ─────────────────────────────────────────────
//
// Fetches /api/mirror/benchmark and shows anonymised aggregate signals from
// structurally similar decisions in the corpus.
// Silently renders nothing when the cluster is too small (< 5 sessions).

const BIAS_LABELS_BENCH: Record<string, string> = {
  fomo_urgency:                      'FOMO / Manufactured Urgency',
  overconfidence:                    'Overconfidence',
  attribution_asymmetry:             'Attribution Asymmetry',
  social_proof:                      'Social Proof Bias',
  control_illusion:                  'Control Illusion',
  speed_bias:                        'Speed Bias',
  exit_optionality_mispricing:       'Exit Optionality Mispricing',
  recency_bias:                      'Recency Bias',
  uniqueness_fallacy:                'Uniqueness Fallacy',
  deference_distortion:              'Deference Distortion',
  relationship_alignment_assumption: 'Relationship Alignment',
  success_compression:               'Success Compression',
  commitment_escalation:             'Commitment Escalation',
  information_anchoring:             'Information Anchoring',
  loss_aversion_asymmetry:           'Loss Aversion Asymmetry',
}

function BenchmarkModule({ authToken }: { authToken: string }) {
  const [data,    setData]    = useState<BenchmarkData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!authToken) return
    fetch('/api/mirror/benchmark', {
      headers: { Authorization: `Bearer ${authToken}` },
    })
      .then(r => r.json())
      .then(d => setData(d as BenchmarkData))
      .catch(() => setData({ insufficient: true, cluster_size: 0, top_dimensions: [], top_biases: [] }))
      .finally(() => setLoading(false))
  }, [authToken])

  // Silently hide while loading or when cluster is insufficient
  if (loading || !data || data.insufficient) return null

  return (
    <>
      <hr className="gold-rule" style={{ margin: '0 0 32px' }} />
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <h3 className="mirror-section-h3" style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-3)', letterSpacing: '0.1em', textTransform: 'uppercase', margin: 0 }}>
            Others in Similar Decisions
          </h3>
          <span style={{ fontSize: 10, color: 'var(--text-4)', fontVariantNumeric: 'tabular-nums' }}>
            {data.cluster_size} in record
          </span>
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-4)', margin: '0 0 14px', lineHeight: 1.55 }}>
          Decisions with the same structural shape as yours, from others in the Quorum record.
          No identities. No decision text. What keeps showing up in that cluster.
        </p>
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-dim)', borderRadius: 10, padding: '16px 18px' }}>
          {data.top_dimensions.length > 0 && (
            <div style={{ marginBottom: data.top_biases.length > 0 ? 14 : 0 }}>
              <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-4)', margin: '0 0 8px' }}>
                Most elevated dimensions in this cluster
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {data.top_dimensions.map(d => (
                  <div key={d.dim} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ flex: 1, height: 2, background: 'var(--bg-inset)', borderRadius: 1 }}>
                      <div style={{ width: `${Math.round((d.avg_score / 5) * 100)}%`, height: '100%', background: 'var(--gold-dim)', borderRadius: 1 }} />
                    </div>
                    <span style={{ fontSize: 11.5, color: 'var(--text-2)', width: 180 }}>{d.label}</span>
                    <span style={{ fontSize: 10.5, color: 'var(--text-4)', fontVariantNumeric: 'tabular-nums', width: 30, textAlign: 'right' }}>
                      {d.avg_score.toFixed(1)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {data.top_biases.length > 0 && (
            <div>
              <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-4)', margin: '0 0 8px' }}>
                Most common patterns in this cluster
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {data.top_biases.map(key => (
                  <span key={key} style={{
                    fontSize: 11, color: 'var(--text-3)', background: 'var(--bg-card-alt)',
                    border: '1px solid var(--border-dim)', borderRadius: 4, padding: '3px 8px',
                  }}>
                    {BIAS_LABELS_BENCH[key] ?? key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}


// ── Sprint M3: Welcome to Mirror card ────────────────────────────────────────
//
// Shown exactly once on first Mirror open (localStorage gate).
// Purpose: bridge the gap between "Mirror unlocked!" excitement and the reality
// that several modules are still thin at session 3. Without this, users scan
// a page of locked/forming states and feel underwhelmed immediately after
// paying. This card reframes that: names what IS live, and frames thin modules
// as a building system, not broken promises.
//
// Fires for all unlocked users on first visit. After dismiss:
//   localStorage.quorum_mirror_welcomed = 'true'
// MirrorSummaryCard (Sprint M1) takes over the above-fold slot from session 2+.

function WelcomeMirrorCard({
  sessionCount,
  onDismiss,
}: {
  sessionCount: number
  onDismiss:    () => void
}) {
  const handleDismiss = () => {
    try { localStorage.setItem('quorum_mirror_welcomed', 'true') } catch {}
    onDismiss()
  }

  return (
    <div style={{
      background:   'rgba(201,168,76,0.04)',
      border:       '1px solid var(--gold-dim)',
      borderRadius: 12,
      padding:      '20px 22px',
      marginBottom: 28,
      position:     'relative',
      overflow:     'hidden',
    }}>
      {/* Gold top accent */}
      <div style={{
        position:   'absolute', top: 0, left: 0,
        width:      '100%',    height: 2,
        background: 'linear-gradient(90deg, var(--gold) 0%, transparent 70%)',
      }} />

      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--gold)', flexShrink: 0 }} />
          <p style={{
            fontSize: 10, fontWeight: 700, color: 'var(--gold)',
            textTransform: 'uppercase', letterSpacing: '0.1em', margin: 0,
          }}>Mirror active</p>
        </div>
        <button
          onClick={handleDismiss}
          aria-label="Dismiss"
          style={{
            background: 'none', border: 'none', color: 'var(--text-4)',
            cursor: 'pointer', fontSize: 18, lineHeight: 1,
            padding: '0 2px', opacity: 0.45, transition: 'opacity 0.15s',
          }}
          onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.opacity = '1')}
          onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.opacity = '0.45')}
        >×</button>
      </div>

      {/* Headline */}
      <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-1)', margin: '0 0 6px', lineHeight: 1.4 }}>
        Your first {sessionCount} decision{sessionCount !== 1 ? 's are' : ' is'} being read.
      </p>
      <p style={{ fontSize: 13, color: 'var(--text-3)', margin: '0 0 16px', lineHeight: 1.6 }}>
        Some modules are live now. Others build as you add more decisions —
        that&apos;s the difference between a signal and noise.
      </p>

      {/* Active / Building two-column grid — dynamic from sessionCount */}
      {(() => {
        const RULES_THRESHOLD        = 8
        const CONTRADICTION_THRESHOLD = 10
        const activeItems = [
          'Bias Fingerprint',
          'Independence Score',
          'Decision Timeline',
          'What Keeps Coming Up',
          ...(sessionCount >= RULES_THRESHOLD         ? ['Implicit Rules']         : []),
          ...(sessionCount >= CONTRADICTION_THRESHOLD ? ['Contradiction Detector'] : []),
        ]
        const buildingItems: [string, string][] = [
          ...(sessionCount < RULES_THRESHOLD         ? [['Implicit Rules',         `at ${RULES_THRESHOLD} sessions`] as [string, string]] : []),
          ...(sessionCount < CONTRADICTION_THRESHOLD ? [['Contradiction Detector', 'from 10+']                       as [string, string]] : []),
          ['Confidence Calibration', 'file outcomes to start'],
        ]
        return (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-dim)', borderRadius: 8, padding: '12px 14px' }}>
              <p style={{ fontSize: 9, fontWeight: 700, color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.09em', margin: '0 0 9px' }}>
                Active now
              </p>
              {activeItems.map((item, i, arr) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: i < arr.length - 1 ? 5 : 0 }}>
                  <div style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--gold)', flexShrink: 0 }} />
                  <p style={{ fontSize: 12, color: 'var(--text-2)', margin: 0, lineHeight: 1.3 }}>{item}</p>
                </div>
              ))}
            </div>
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-dim)', borderRadius: 8, padding: '12px 14px' }}>
              <p style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: '0.09em', margin: '0 0 9px' }}>
                Still building
              </p>
              {buildingItems.map(([name, hint], i, arr) => (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 7, marginBottom: i < arr.length - 1 ? 5 : 0 }}>
                  <div style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--border-hi)', flexShrink: 0, marginTop: 3 }} />
                  <div>
                    <p style={{ fontSize: 12, color: 'var(--text-3)', margin: 0, lineHeight: 1.3 }}>{name}</p>
                    <p style={{ fontSize: 10, color: 'var(--text-4)', margin: '1px 0 0', lineHeight: 1.3 }}>{hint}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      })()}

      {/* Footer */}
      <div style={{
        paddingTop: 12, borderTop: '1px solid var(--border-dim)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 16, flexWrap: 'wrap',
      }}>
        <p style={{ fontSize: 11, color: 'var(--text-4)', margin: 0, lineHeight: 1.5, flex: 1 }}>
          Answer Examiner questions in depth — that&apos;s the primary signal source across most modules.
        </p>
        <button
          onClick={handleDismiss}
          style={{
            background: 'transparent', border: '1px solid var(--border-mid)',
            borderRadius: 6, padding: '7px 16px',
            color: 'var(--text-3)', fontSize: 12, fontWeight: 600,
            fontFamily: 'inherit', cursor: 'pointer',
            transition: 'all 0.15s', whiteSpace: 'nowrap', flexShrink: 0,
          }}
          onMouseEnter={e => {
            ;(e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--gold-dim)'
            ;(e.currentTarget as HTMLButtonElement).style.color       = 'var(--gold)'
          }}
          onMouseLeave={e => {
            ;(e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border-mid)'
            ;(e.currentTarget as HTMLButtonElement).style.color       = 'var(--text-3)'
          }}
        >
          Got it →
        </button>
      </div>
    </div>
  )
}

// ── Sprint M2: Section wrapper ────────────────────────────────────────────────
// Wraps every Mirror module with:
//   • id="msec-{key}"          → MirrorNav scroll targets
//   • type-coloured left border → urgent / core / deep / archival
//   • desc-collapse toggle      → "?" hides/shows description text (localStorage)
//   • section collapse toggle   → chevron collapses entire section (localStorage)
//   • staggered fade-in         → animDelay ms for smooth page assembly

const SEC_TYPE_BORDER: Record<string, string> = {
  urgent:   '#E24B4A',
  core:     'rgba(201,168,76,0.45)',
  deep:     'rgba(74,158,222,0.45)',
  archival: 'rgba(120,120,115,0.3)',
}

function SectionWrapper({
  sectionKey, title, desc, badge, type = 'core', animDelay = 0,
  highlighted = false,
  collapsed, descHidden, onToggleCollapse, onToggleDesc, children,
}: {
  sectionKey:       string
  title:            string
  desc?:            string
  badge?:           React.ReactNode
  type?:            'urgent' | 'core' | 'deep' | 'archival'
  animDelay?:       number
  highlighted?:     boolean   // Sprint M6 — soft prominence from latest session mode
  collapsed:        boolean
  descHidden:       boolean
  onToggleCollapse: (k: string) => void
  onToggleDesc:     (k: string) => void
  children:         React.ReactNode
}) {
  const border = SEC_TYPE_BORDER[type]
  return (
    <div
      id={`msec-${sectionKey}`}
      style={{
        marginBottom: 28,
        animation:    `secFadeIn 0.4s ease both${highlighted ? ', secPulse 2.4s ease-in-out 0.5s 2' : ''}`,
        animationDelay: `${animDelay}ms`,
        ...(highlighted && {
          outline:       '1px solid rgba(201,168,76,0.25)',
          outlineOffset: 8,
          borderRadius:  10,
        }),
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: collapsed ? 0 : (desc && !descHidden ? 6 : 14) }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
          <h3 style={{
            fontSize: 13, fontWeight: 700, color: 'var(--text-3)',
            letterSpacing: '0.1em', textTransform: 'uppercase', margin: 0,
            paddingLeft: 8, borderLeft: `2px solid ${border}`,
          }}>{title}</h3>
          {badge}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0, marginLeft: 10 }}>
          {desc && (
            <button onClick={() => onToggleDesc(sectionKey)}
              title={descHidden ? 'Show description' : 'Hide description'}
              style={{ background: 'none', border: '1px solid var(--border-dim)', borderRadius: '50%',
                width: 18, height: 18, cursor: 'pointer', fontFamily: 'inherit',
                fontSize: 10, color: 'var(--text-4)', display: 'flex',
                alignItems: 'center', justifyContent: 'center', padding: 0, transition: 'all 0.15s', flexShrink: 0 }}>?</button>
          )}
          <button onClick={() => onToggleCollapse(sectionKey)}
            title={collapsed ? 'Expand' : 'Collapse'}
            style={{ background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--text-4)', padding: '2px 0', display: 'flex',
              alignItems: 'center', transition: 'color 0.15s', flexShrink: 0 }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
              style={{ transform: collapsed ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
              <polyline points="18 15 12 9 6 15"/>
            </svg>
          </button>
        </div>
      </div>
      {!collapsed && desc && !descHidden && (
        <p style={{ fontSize: 12, color: 'var(--text-4)', margin: '0 0 14px', lineHeight: 1.55 }}>{desc}</p>
      )}
      {!collapsed && children}
    </div>
  )
}

// ── Unlocked view ─────────────────────────────────────────────────────────────
function UnlockedView({
  status,
  sessions,
  authToken,
  initialStyleCue,
  avoidanceAlerts,
}: {
  status:           MirrorStatus
  sessions:         TimelineSession[]
  authToken:        string
  initialStyleCue?: StyleCue | null
  avoidanceAlerts:  AvoidanceAlertData[]
}) {
  // Sprint 21: style calibration
  const [showCalibration, setShowCalibration] = useState(() => {
    if (status.sessionCount < 5 || initialStyleCue) return false
    try { return localStorage.getItem('quorum_style_calibration_dismissed') !== 'true' } catch { return true }
  })

  // Sprint M3: Welcome to Mirror card — shown once on first Mirror open.
  // Auto-dismiss for established users: once sessionCount >= 10, all session-
  // threshold features (Rules at 8, Contradictions at 10) are unlocked, so the
  // "still building" list becomes meaningless. Write to localStorage so it
  // stays dismissed on return visits and across devices.
  const [showWelcome, setShowWelcome] = useState(() => {
    if (status.sessionCount >= 10) {
      try { localStorage.setItem('quorum_mirror_welcomed', 'true') } catch {}
      return false
    }
    try { return localStorage.getItem('quorum_mirror_welcomed') !== 'true' } catch { return true }
  })

  function handleCalibrationComplete(_cue: StyleCue) { setShowCalibration(false) }

  // Sprint M3: topBiasLabel for DecisionRules ThresholdGate personalisation.
  const topBiasLabel = status.teaserBiases.length > 0
    ? getBiasLabel(status.teaserBiases[0])
    : undefined

  // Sprint M2: open loop count — drives MJR conditional positioning
  const [openLoopCount, setOpenLoopCount] = useState(0)

  // Sprint M5+M6: lifted summary data shared across SummaryCard, AttentionZone, MirrorInsightCard
  const [summaryData, setSummaryData] = useState<SummaryData | null>(null)

  // Sprint M6: derive highlighted module from latest session mode
  //   REDIRECT → Independence Score    GATE → Contradiction Detector
  const highlightedModule: string | null =
    summaryData?.latestSessionMode === 'REDIRECT' ? 'independence'
    : summaryData?.latestSessionMode === 'GATE'   ? 'contradictions'
    : null

  // Sprint M2: section collapse state (persisted in localStorage)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem('quorum_mirror_collapsed') ?? '{}') } catch { return {} }
  })
  const toggleCollapse = useCallback((k: string) => {
    setCollapsed(prev => {
      const next = { ...prev, [k]: !prev[k] }
      try { localStorage.setItem('quorum_mirror_collapsed', JSON.stringify(next)) } catch {}
      return next
    })
  }, [])

  // Sprint M2: section description hide state (persisted in localStorage)
  const [descHidden, setDescHidden] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem('quorum_mirror_desc_hidden') ?? '{}') } catch { return {} }
  })
  const toggleDesc = useCallback((k: string) => {
    setDescHidden(prev => {
      const next = { ...prev, [k]: !prev[k] }
      try { localStorage.setItem('quorum_mirror_desc_hidden', JSON.stringify(next)) } catch {}
      return next
    })
  }, [])

  // Shorthand to build SectionWrapper props — avoids repeating collapsed/descHidden/handlers
  const sw = (key: string) => ({
    sectionKey:       key,
    collapsed:        collapsed[key] ?? false,
    descHidden:       descHidden[key] ?? false,
    onToggleCollapse: toggleCollapse,
    onToggleDesc:     toggleDesc,
  })

  const earlyUser = status.sessionCount < 10

  return (
    <div style={{ maxWidth: 680, margin: '0 auto', padding: '0 0 60px' }}>

      {/* Sprint 21: Style Calibration */}
      {showCalibration && (
        <StyleCalibration
          authToken={authToken}
          onComplete={handleCalibrationComplete}
          onDismiss={() => setShowCalibration(false)}
        />
      )}

      {/* Sprint M3: Welcome card — first visit only */}
      {showWelcome && (
        <WelcomeMirrorCard sessionCount={status.sessionCount} onDismiss={() => setShowWelcome(false)} />
      )}

      {/* Sprint M1: Summary Card — onData lifts data up for M5 AttentionZone + M6 MirrorInsightCard */}
      {!showWelcome && <MirrorSummaryCard authToken={authToken} onData={setSummaryData} />}

      {/* Sprint M5: Attention Zone — 0-3 urgent/notable cards, absent when nothing to surface */}
      {!showWelcome && summaryData && <AttentionZone data={summaryData} />}

      {/* Sprint M2: Sticky nav — M6 dot badge on highlighted section */}
      {!showWelcome && (
        <MirrorNav highlightedSections={highlightedModule ? [highlightedModule] : []} />
      )}

      {/* Decisions Still Open */}
      {avoidanceAlerts.length > 0 && (
        <>
          <AvoidanceAlertCard alerts={avoidanceAlerts} authToken={authToken} />
          <hr className="gold-rule" style={{ margin: '0 0 32px' }} />
        </>
      )}

      {/* Sprint M2: Decision Timeline — near top for early users (< 10 sessions) */}
      {earlyUser && (
        <>
          <SectionWrapper {...sw('timeline')} title="Decision Timeline" type="archival" animDelay={0}
            badge={<span style={{ fontSize: 10, color: 'var(--text-4)' }}>{status.sessionCount} session{status.sessionCount !== 1 ? 's' : ''}</span>}>
            <MirrorTimeline sessions={sessions} />
          </SectionWrapper>
          <hr className="gold-rule" style={{ margin: '0 0 32px' }} />
        </>
      )}

      {/* Sprint M2: Monthly Judgment Review — near top when open loops exist */}
      {openLoopCount > 0 && (
        <>
          <MonthlyJudgmentReview authToken={authToken} onOpenLoopCount={setOpenLoopCount} />
          <hr className="gold-rule" style={{ margin: '0 0 32px' }} />
        </>
      )}

      {/* ── Core modules ───────────────────────────────────────────────────── */}

      {/* Sprint M6: Cross-module Mirror Insight — deterministic synthesis, top of module stack */}
      {summaryData && <MirrorInsightCard data={summaryData} />}

      <SectionWrapper {...sw('fingerprint')} title="Bias Fingerprint" type="core" animDelay={60}
        desc="The conditions that trigger your patterns — not that you have them, but exactly when and why they show up.">
        <BiasFingerprint authToken={authToken} />
      </SectionWrapper>
      <hr className="gold-rule" style={{ margin: '0 0 32px' }} />

      <SectionWrapper {...sw('independence')} title="Decision Independence Score" type="core" animDelay={100}
        highlighted={highlightedModule === 'independence'}
        desc="How much this decision came from you. Whether your judgment is compounding or deferring over time.">
        <IndependenceScore authToken={authToken} />
      </SectionWrapper>
      <hr className="gold-rule" style={{ margin: '0 0 32px' }} />

      <SectionWrapper {...sw('rules')} title="Your Implicit Rules" type="core" animDelay={140}
        desc="The operating principles you implicitly follow — extracted from how you reason, not what you say about yourself."
        badge={status.sessionCount >= 8 ? <span style={{ fontSize: 10, color: 'var(--text-4)' }}>From {status.sessionCount} decisions</span> : undefined}>
        <DecisionRules authToken={authToken} sessionCount={status.sessionCount} topBiasLabel={topBiasLabel} />
      </SectionWrapper>
      <hr className="gold-rule" style={{ margin: '0 0 32px' }} />

      <SectionWrapper {...sw('patterns')} title="What Keeps Coming Up" type="core" animDelay={180}
        desc="What keeps showing up in how you make decisions — not what you say about yourself, but what Quorum has observed across your actual sessions."
        badge={status.sessionCount >= 3 ? <span style={{ fontSize: 10, color: 'var(--text-4)' }}>From {status.sessionCount} decisions</span> : undefined}>
        <PatternStore authToken={authToken} />
      </SectionWrapper>
      <hr className="gold-rule" style={{ margin: '0 0 32px' }} />

      {/* ── Deep insight modules ────────────────────────────────────────────── */}

      <SectionWrapper {...sw('contradictions')} title="Contradiction Detector" type="deep" animDelay={220}
        highlighted={highlightedModule === 'contradictions'}
        desc="Where what you said you believe and what you actually did come apart — surfaced from your own words, across decisions."
        badge={status.sessionCount >= 40 ? <span style={{ fontSize: 10, color: 'var(--text-4)' }}>{status.sessionCount} decisions</span> : undefined}>
        <ContradictionDetector authToken={authToken} sessionCount={status.sessionCount} />
      </SectionWrapper>
      <hr className="gold-rule" style={{ margin: '0 0 32px' }} />

      <SectionWrapper {...sw('calibration')} title="Confidence Calibration" type="deep" animDelay={260}
        desc="How the confidence you entered a decision with compares to how certain it felt in hindsight — and whether that gap is closing over time.">
        <CalibrationSparkline authToken={authToken} />
      </SectionWrapper>
      <hr className="gold-rule" style={{ margin: '0 0 32px' }} />

      <SectionWrapper {...sw('sri')} title="Session Reliability Index" type="deep" animDelay={300}
        desc="A unified score per session combining structural match quality, active bias signals, Council analysis conditions, and your confidence calibration record — and what to do next to raise it.">
        <SessionReliabilityIndex authToken={authToken} />
      </SectionWrapper>
      <hr className="gold-rule" style={{ margin: '0 0 32px' }} />

      {/* Sprint M2: MJR — default position (when no open loops, or to get the callback) */}
      <MonthlyJudgmentReview
        authToken={authToken}
        onOpenLoopCount={openLoopCount === 0 ? setOpenLoopCount : undefined}
      />
      <hr className="gold-rule" style={{ margin: '0 0 32px' }} />

      {/* Sprint M2: Decision Timeline — bottom for users with >= 10 sessions */}
      {!earlyUser && (
        <SectionWrapper {...sw('timeline')} title="Decision Timeline" type="archival" animDelay={340}
          badge={<span style={{ fontSize: 10, color: 'var(--text-4)' }}>{status.sessionCount} session{status.sessionCount !== 1 ? 's' : ''}</span>}>
          <MirrorTimeline sessions={sessions} />
        </SectionWrapper>
      )}

      <BenchmarkModule authToken={authToken} />
    </div>
  )
}

// ── Main page component ───────────────────────────────────────────────────────
export default function MirrorPage() {
  const router = useRouter()

  const [loading,    setLoading]    = useState(true)
  const [status,          setStatus]          = useState<MirrorStatus | null>(null)
  const [sessions,        setSessions]        = useState<TimelineSession[]>([])
  const [authToken,       setAuthToken]       = useState<string | null>(null)
  const [fetchError,      setFetchError]      = useState(false)
  // Sprint 21: fetched once when status resolves to 'unlocked'
  const [initialStyleCue, setInitialStyleCue] = useState<StyleCue | null>(null)
  // Sprint D3: avoidance alerts — fetched alongside alerts route on unlocked
  const [avoidanceAlerts, setAvoidanceAlerts] = useState<AvoidanceAlertData[]>([])

  // ── 1. Get auth token ──────────────────────────────────────────────────────
  useEffect(() => {
    const getToken = async () => {
      try {
        const supabase = createClient()
        const { data: { session } } = await supabase.auth.getSession()
        setAuthToken(session?.access_token ?? null)
      } catch {
        setAuthToken(null)
      }
    }
    getToken()
  }, [])

  // ── 2. Fetch mirror status once token is resolved ──────────────────────────
  const fetchStatus = useCallback(async (token: string | null) => {
    try {
      const headers: Record<string, string> = {}
      if (token) headers['Authorization'] = `Bearer ${token}`

      const res  = await fetch('/api/mirror/status', { headers })
      const data = await res.json() as MirrorStatus
      setStatus(data)

      // Fetch timeline for teaser and unlocked states
      if (data.gateState === 'teaser' || data.gateState === 'unlocked') {
        const tlRes  = await fetch('/api/mirror/timeline', { headers })
        const tlData = await tlRes.json() as { sessions: TimelineSession[] }
        setSessions(tlData.sessions ?? [])
      }
      // Sprint 21: fetch existing style_cue so StyleCalibration knows whether to show
      if (data.gateState === 'unlocked' && token) {
        try {
          const prefRes  = await fetch('/api/mirror/preferences', { headers })
          if (prefRes.ok) {
            const prefData = await prefRes.json() as { style_cue: StyleCue | null }
            setInitialStyleCue(prefData.style_cue ?? null)
          }
        } catch {
          // Non-critical — calibration simply shows if sessionCount >= 5
        }
        // Sprint D3: fetch avoidance alerts (included in alerts route response)
        try {
          const alertsRes = await fetch('/api/mirror/alerts', { headers })
          if (alertsRes.ok) {
            const alertsData = await alertsRes.json() as { avoidanceAlerts?: AvoidanceAlertData[] }
            setAvoidanceAlerts(alertsData.avoidanceAlerts ?? [])
          }
        } catch {
          // Non-critical — avoidance section simply stays hidden
        }
      }
    } catch {
      setFetchError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  // Trigger fetch when token state is resolved (including null — unauthenticated)
  useEffect(() => {
    if (authToken !== undefined) {
      fetchStatus(authToken)
    }
  }, [authToken, fetchStatus])

  // ── Called when unlock code succeeds ──────────────────────────────────────
  // Re-fetches status so gateState transitions teaser → unlocked in-place.
  const handleUnlocked = useCallback(() => {
    setLoading(true)
    fetchStatus(authToken)
  }, [authToken, fetchStatus])

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
      <style>{`
        @keyframes seg-pulse { 0%, 100% { opacity: 0.2; } 50% { opacity: 0.5; } }
        @keyframes blink      { 0%, 100% { opacity: 0.4; } 50% { opacity: 1; } }
        @keyframes secFadeIn  { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
        @keyframes secPulse   { 0%, 100% { outline-color: rgba(201,168,76,0.12); } 50% { outline-color: rgba(201,168,76,0.5); } }
        .mirror-section-h3   { border-left: 2px solid rgba(201,168,76,0.35); padding-left: 8px; }
        @media (max-width: 600px) {
          .mirror-content-pad   { padding: 0 16px !important; }
          .mirror-page-header   { padding: 24px 16px 20px !important; }
          .mirror-stats-grid    { grid-template-columns: 1fr !important; }
          .mirror-summary-stats { grid-template-columns: repeat(2, 1fr) !important; }
          .mirror-rules-card    { padding: 18px 16px 14px !important; }
          .mirror-rules-btn     { padding: 12px !important; }
          .mirror-score-row     { flex-direction: column !important; align-items: flex-start !important; gap: 12px !important; }
          .mirror-cta-card      { padding: 20px 16px !important; }
          .mirror-cta-btn       { min-height: 44px; display: inline-flex !important; align-items: center !important; }
          .mirror-bias-grid     { grid-template-columns: 1fr !important; }
        }
      `}</style>

      <div style={{
        minHeight:   '100vh',
        background:  'var(--bg-void)',
        color:       'var(--text-2)',
        fontFamily:  'inherit',
      }}>

        {/* ── Top nav ──────────────────────────────────────────────────────── */}
        <div style={{
          borderBottom:  '1px solid var(--border-dim)',
          padding:       '0 24px',
          height:        52,
          display:       'flex',
          alignItems:    'center',
          justifyContent:'space-between',
          position:      'sticky',
          top:           0,
          background:    'var(--bg-void)',
          zIndex:        10,
        }}>
          <button
            onClick={() => window.history.length > 1 ? router.back() : router.push('/')}
            style={{
              display:        'flex',
              alignItems:     'center',
              gap:            6,
              background:     'none',
              border:         'none',
              color:          'var(--gold)',
              fontSize:       13,
              fontFamily:     'inherit',
              cursor:         'pointer',
              padding:        '12px 0',
              transition:     'opacity 0.2s',
              opacity:        0.85,
              fontWeight:     500,
              letterSpacing:  '0.04em',
            }}
            onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
            onMouseLeave={e => (e.currentTarget.style.opacity = '0.85')}
          >
            <IconArrowLeft />
            Quorum
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <IconMirror size={16} color="var(--gold)" />
            <span style={{
              fontSize:      13,
              fontWeight:    600,
              color:         'var(--text-2)',
              letterSpacing: '0.04em',
            }}>
              Mirror
            </span>
          </div>

          {/* Status badge */}
          {status?.gateState === 'unlocked' && (
            <span style={{
              fontSize:      10,
              fontWeight:    600,
              color:         'var(--success-text)',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
            }}>
              ● Active
            </span>
          )}
          {status?.gateState !== 'unlocked' && <span style={{ width: 60 }} />}
        </div>

        {/* ── Page header (teaser/unlocked only) ──────────────────────────── */}
        {(status?.gateState === 'teaser' || status?.gateState === 'unlocked') && (
          <div className="mirror-page-header" style={{
            padding:      '32px 24px 24px',
            maxWidth:     680,
            margin:       '0 auto',
          }}>
            <h1 style={{ fontSize: 26, fontWeight: 700, color: 'var(--text-1)', margin: '0 0 6px' }}>
              Your Decision Mirror
            </h1>
            <p style={{ fontSize: 13.5, color: 'var(--text-3)', margin: 0, lineHeight: 1.6 }}>
              {status.gateState === 'unlocked'
                ? 'Your behavioral patterns across all decisions.'
                : 'Your Mirror is building from every decision you bring.'}
            </p>
          </div>
        )}

        {/* ── Main content ─────────────────────────────────────────────────── */}
        <div className="mirror-content-pad" style={{ padding: '0 24px' }}>
          {/* Loading */}
          {loading && (
            <div style={{
              display:        'flex',
              justifyContent: 'center',
              alignItems:     'center',
              minHeight:      200,
              color:          'var(--text-4)',
              fontSize:       13,
            }}>
              <div style={{
                width:        6,
                height:       6,
                borderRadius: '50%',
                background:   'var(--gold)',
                animation:    'blink 1.5s ease-in-out infinite',
                marginRight:  10,
              }} />
              Loading your Mirror…
            </div>
          )}

          {/* Error */}
          {!loading && fetchError && (
            <div style={{
              maxWidth:     480,
              margin:       '60px auto',
              textAlign:    'center',
              color:        'var(--text-4)',
              fontSize:     13,
            }}>
              Failed to load Mirror. Check your connection and try again.
            </div>
          )}

          {/* Gate states */}
          {!loading && !fetchError && status && (
            <>
              {status.gateState === 'auth'     && <AuthGate />}
              {status.gateState === 'locked'   && (
                <LockedView sessionCount={status.sessionCount} />
              )}
              {status.gateState === 'teaser'   && (
                <TeaserView
                  status={status}
                  sessions={sessions}
                  authToken={authToken ?? ''}
                  onUnlocked={handleUnlocked}
                />
              )}
              {status.gateState === 'unlocked' && (
                <UnlockedView
                  status={status}
                  sessions={sessions}
                  authToken={authToken ?? ''}
                  initialStyleCue={initialStyleCue}
                  avoidanceAlerts={avoidanceAlerts}
                />
              )}
            </>
          )}
        </div>
      </div>
    </>
  )
}

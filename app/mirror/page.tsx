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
import PatternStore           from '@/components/PatternStore'
import StyleCalibration        from '@/components/StyleCalibration'
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
        <h2 style={{ fontSize: 22, fontWeight: 400, fontFamily: 'var(--font-display)', color: 'var(--text-1)', margin: '0 0 10px' }}>
          Your behavioral mirror
        </h2>
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
            ? 'One more session to go.'
            : `${remaining} more decisions to unlock your Mirror preview.`
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
        onClick={() => router.push('/')}
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

// ── Locked teaser tile ────────────────────────────────────────────────────────
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
      {/* Header row */}
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
        <span style={{ color: 'var(--text-4)', display: 'flex', alignItems: 'center' }}>
          <IconLock size={12} />
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
    }}>
      <IconLock size={10} />
      Locked
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
              {status.teaserBiases.length} pattern{status.teaserBiases.length !== 1 ? 's' : ''} detected across your decisions. Subscribe to read your full profile.
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
            Your independence score measures how much your judgment compounds over time versus deferring to external validation. Visible after subscribing.
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
              ? `${teaser.contradictionCount} active contradiction${teaser.contradictionCount !== 1 ? 's' : ''} detected across your decisions. Subscribe to see where your stated principles conflict with your actual choices.`
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
          Subscribe to unlock
        </p>
        <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-1)', margin: '0 0 6px' }}>
          Your behavioral mirror is already building.
        </p>
        <p style={{ fontSize: 13, color: 'var(--text-3)', lineHeight: 1.6, margin: '0 0 20px' }}>
          From ₹1,499/month. Cancel anytime. The same quality of insight advisors charge ₹50,000 for — derived from your actual decisions, not a questionnaire.
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


// ── Unlocked view ─────────────────────────────────────────────────────────────
function UnlockedView({
  status,
  sessions,
  authToken,
  initialStyleCue,
}: {
  status:           MirrorStatus
  sessions:         TimelineSession[]
  authToken:        string
  initialStyleCue?: StyleCue | null
}) {
  // Sprint 21: style calibration — show when sessionCount >= 5, no DB cue, and not
  // previously dismissed/completed in this browser (localStorage guard).
  const [showCalibration, setShowCalibration] = useState(() => {
    if (status.sessionCount < 5 || initialStyleCue) return false
    try { return localStorage.getItem('quorum_style_calibration_dismissed') !== 'true' } catch { return true }
  })

  function handleCalibrationComplete(_cue: StyleCue) {
    setShowCalibration(false)
  }

  return (
    <div style={{ maxWidth: 680, margin: '0 auto', padding: '0 0 60px' }}>

      {/* Sprint 21: Style Calibration — shown once when sessionCount >= 5 */}
      {showCalibration && (
        <StyleCalibration
          authToken={authToken}
          onComplete={handleCalibrationComplete}
          onDismiss={() => setShowCalibration(false)}
        />
      )}

      {/* Bias Fingerprint — live (Sprint 7b) */}
      <div style={{ marginBottom: 28 }}>
        <h3 style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-3)', letterSpacing: '0.1em', textTransform: 'uppercase', margin: '0 0 6px' }}>
          Bias Fingerprint
        </h3>
        <p style={{ fontSize: 12, color: 'var(--text-4)', margin: '0 0 14px', lineHeight: 1.55 }}>
          The conditions that trigger your patterns — not that you have them, but exactly when and why they show up.
        </p>
        <BiasFingerprint authToken={authToken} />
      </div>

      {/* Divider */}
      <hr className="gold-rule" style={{ margin: '0 0 32px' }} />

      {/* Decision Independence Score — Sprint 7c */}
      <div style={{ marginBottom: 28 }}>
        <h3 style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-3)', letterSpacing: '0.1em', textTransform: 'uppercase', margin: '0 0 6px' }}>
          Decision Independence Score
        </h3>
        <p style={{ fontSize: 12, color: 'var(--text-4)', margin: '0 0 14px', lineHeight: 1.55 }}>
          How much this decision came from you. Whether your judgment is compounding or deferring over time.
        </p>
        <IndependenceScore authToken={authToken} />
      </div>

      {/* Divider */}
      <hr className="gold-rule" style={{ margin: '0 0 32px' }} />

      {/* Decision Rules — Sprint 7d */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <h3 className="mirror-section-h3" style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-3)', letterSpacing: '0.1em', textTransform: 'uppercase', margin: 0 }}>
            Your Implicit Rules
          </h3>
          {status.sessionCount >= 8 && (
            <span style={{ fontSize: 10, color: 'var(--text-4)' }}>
              From {status.sessionCount} decisions
            </span>
          )}
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-4)', margin: '0 0 14px', lineHeight: 1.55 }}>
          The operating principles you implicitly follow — extracted from how you reason, not what you say about yourself.
        </p>
        <DecisionRules authToken={authToken} sessionCount={status.sessionCount} />
      </div>

      {/* Divider */}
      <hr className="gold-rule" style={{ margin: '0 0 32px' }} />

      {/* Pattern Store — Sprint 18b */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <h3 className="mirror-section-h3" style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-3)', letterSpacing: '0.1em', textTransform: 'uppercase', margin: 0 }}>
            What Keeps Coming Up
          </h3>
          {status.sessionCount >= 3 && (
            <span style={{ fontSize: 10, color: 'var(--text-4)' }}>
              From {status.sessionCount} decisions
            </span>
          )}
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-4)', margin: '0 0 14px', lineHeight: 1.55 }}>
          What keeps showing up in how you make decisions — not what you say about yourself, but what Quorum
          has observed across your actual sessions.
        </p>
        <PatternStore authToken={authToken} />
      </div>

      {/* Divider */}
      <hr className="gold-rule" style={{ margin: '0 0 32px' }} />

      {/* Contradiction Detector — Sprint 9 */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <h3 className="mirror-section-h3" style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-3)', letterSpacing: '0.1em', textTransform: 'uppercase', margin: 0 }}>
            Contradiction Detector
          </h3>
          {status.sessionCount >= 40 && (
            <span style={{ fontSize: 10, color: 'var(--text-4)' }}>
              {status.sessionCount} decisions
            </span>
          )}
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-4)', margin: '0 0 14px', lineHeight: 1.55 }}>
          Where what you said you believe and what you actually did come apart — surfaced from your own words, across decisions.
        </p>
        <ContradictionDetector authToken={authToken} sessionCount={status.sessionCount} />
      </div>

      {/* Divider */}
      <hr className="gold-rule" style={{ margin: '0 0 32px' }} />

      {/* Calibration Trend — Sprint 15 */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <h3 className="mirror-section-h3" style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-3)', letterSpacing: '0.1em', textTransform: 'uppercase', margin: 0 }}>
            Confidence Calibration
          </h3>
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-4)', margin: '0 0 14px', lineHeight: 1.55 }}>
          How the confidence you entered a decision with compares to how certain it felt in hindsight — and whether that gap is closing over time.
        </p>
        <CalibrationSparkline authToken={authToken} />
      </div>

      {/* Divider */}
      <hr className="gold-rule" style={{ margin: '0 0 32px' }} />

      {/* Decision Timeline — archival record, moved to bottom */}
      <div>
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

      {/* Others in Similar Decisions — Sprint 20 */}
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
        .mirror-section-h3   { border-left: 2px solid rgba(201,168,76,0.35); padding-left: 8px; }
        @media (max-width: 600px) {
          .mirror-content-pad  { padding: 0 16px !important; }
          .mirror-page-header  { padding: 24px 16px 20px !important; }
          .mirror-stats-grid   { grid-template-columns: 1fr !important; }
          .mirror-rules-card   { padding: 18px 16px 14px !important; }
          .mirror-rules-btn    { padding: 12px !important; }
          .mirror-score-row    { flex-direction: column !important; align-items: flex-start !important; gap: 12px !important; }
          .mirror-cta-card     { padding: 20px 16px !important; }
          .mirror-cta-btn      { min-height: 44px; display: inline-flex !important; align-items: center !important; }
          .mirror-bias-grid    { grid-template-columns: 1fr !important; }
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
            onClick={() => router.push('/')}
            style={{
              display:        'flex',
              alignItems:     'center',
              gap:            6,
              background:     'none',
              border:         'none',
              color:          'var(--text-3)',
              fontSize:       13,
              fontFamily:     'inherit',
              cursor:         'pointer',
              padding:        '12px 0',
              transition:     'color 0.2s',
            }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-2)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-3)')}
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
              color:         '#4ade80',
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
                : 'Your Mirror is building. Subscribe to unlock the full profile.'}
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
                />
              )}
            </>
          )}
        </div>
      </div>
    </>
  )
}

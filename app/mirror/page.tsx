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
import MirrorTimeline    from '@/components/MirrorTimeline'
import type { MirrorStatus, TimelineSession } from '@/lib/types'

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
        <h2 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-1)', margin: '0 0 10px' }}>
          Your behavioral mirror
        </h2>
        <p style={{ fontSize: 14, color: 'var(--text-3)', lineHeight: 1.65, margin: 0 }}>
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
          <p style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.5, margin: 0 }}>
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
function ThresholdGate({ sessionCount, threshold }: { sessionCount: number; threshold: number }) {
  const router = useRouter()
  const remaining = threshold - sessionCount

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
          Mirror activates at {threshold} decisions
        </h2>
        <p style={{ fontSize: 13.5, color: 'var(--text-3)', lineHeight: 1.65, margin: 0 }}>
          {remaining === 1
            ? 'One more session to go.'
            : `${remaining} more decisions to unlock your behavioral mirror.`
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
            {sessionCount} / {threshold}
          </span>
        </div>
        <SegmentBar filled={sessionCount} total={threshold} />
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

// ── Gate: Paywall ─────────────────────────────────────────────────────────────
function PaywallGate({
  status,
  sessions,
}: {
  status: MirrorStatus
  sessions: TimelineSession[]
}) {
  return (
    <div style={{ maxWidth: 680, margin: '0 auto', padding: '0 0 60px' }}>

      {/* Section: Decision Timeline (free) */}
      <div style={{ marginBottom: 40 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <h3 style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-3)', letterSpacing: '0.1em', textTransform: 'uppercase', margin: 0 }}>
            Decision Timeline
          </h3>
          <span style={{ fontSize: 11, color: 'var(--text-4)' }}>
            {status.sessionCount} session{status.sessionCount !== 1 ? 's' : ''}
          </span>
        </div>
        <MirrorTimeline sessions={sessions} />
      </div>

      {/* Divider */}
      <hr className="gold-rule" style={{ margin: '0 0 32px' }} />

      {/* Section: Locked Bias Fingerprint */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <h3 style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-3)', letterSpacing: '0.1em', textTransform: 'uppercase', margin: 0 }}>
            Bias Fingerprint
          </h3>
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
        </div>

        {status.teaserBiases.length > 0 ? (
          <>
            <p style={{ fontSize: 12.5, color: 'var(--text-4)', margin: '0 0 14px', lineHeight: 1.55 }}>
              {status.teaserBiases.length} pattern{status.teaserBiases.length !== 1 ? 's' : ''} detected across your decisions. Unlock to read your full profile.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
              {status.teaserBiases.map(key => (
                <TeaserTile key={key} biasKey={key} />
              ))}
            </div>
          </>
        ) : (
          <p style={{ fontSize: 12.5, color: 'var(--text-4)', margin: 0, lineHeight: 1.55 }}>
            Bias patterns are being compiled from your sessions.
            Continue running decisions to build your fingerprint.
          </p>
        )}
      </div>

      {/* CTA card */}
      <div style={{
        background:    'var(--bg-card)',
        border:        '1px solid var(--border-mid)',
        borderRadius:  14,
        padding:       '24px 24px',
        marginTop:     28,
      }}>
        <p style={{ fontSize: 12, color: 'var(--text-4)', fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', margin: '0 0 10px' }}>
          Unlock Decision Profile
        </p>
        <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-1)', margin: '0 0 6px' }}>
          Your full behavioral mirror — ₹4,999
        </p>
        <p style={{ fontSize: 13, color: 'var(--text-3)', lineHeight: 1.6, margin: '0 0 20px' }}>
          The same quality of insight advisors charge ₹50,000 for —
          derived from your actual decisions, not a questionnaire.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
          {[
            'Full Bias Fingerprint — your conditional patterns in plain language',
            'Pattern interpretation — what activates each tendency and when',
            'Decision Independence Score — is your judgment compounding?',
          ].map((item, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                stroke="#4ade80" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                style={{ flexShrink: 0, marginTop: 2 }}>
                <polyline points="20 6 9 17 4 12"/>
              </svg>
              <span style={{ fontSize: 12.5, color: 'var(--text-3)', lineHeight: 1.5 }}>{item}</span>
            </div>
          ))}
        </div>
        <p style={{ fontSize: 11.5, color: 'var(--text-4)', margin: '0 0 6px', lineHeight: 1.5 }}>
          To unlock, send a message to{' '}
          <span style={{ color: 'var(--text-3)' }}>the Quorum team</span>{' '}
          — payment details provided on confirmation.
        </p>
        <p style={{ fontSize: 10.5, color: 'var(--text-4)', margin: 0, fontStyle: 'italic' }}>
          Mirror unlock is also included in the ₹25,000 live advisory session + Brief.
        </p>
      </div>
    </div>
  )
}

// ── Unlocked view ─────────────────────────────────────────────────────────────
function UnlockedView({
  status,
  sessions,
}: {
  status: MirrorStatus
  sessions: TimelineSession[]
}) {
  return (
    <div style={{ maxWidth: 680, margin: '0 auto', padding: '0 0 60px' }}>

      {/* Decision Timeline */}
      <div style={{ marginBottom: 40 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <h3 style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-3)', letterSpacing: '0.1em', textTransform: 'uppercase', margin: 0 }}>
            Decision Timeline
          </h3>
          <span style={{ fontSize: 11, color: 'var(--text-4)' }}>
            {status.sessionCount} session{status.sessionCount !== 1 ? 's' : ''}
          </span>
        </div>
        <MirrorTimeline sessions={sessions} />
      </div>

      {/* Divider */}
      <hr className="gold-rule" style={{ margin: '0 0 32px' }} />

      {/* Bias Fingerprint — placeholder (populated Sprint 7b) */}
      <div style={{ marginBottom: 28 }}>
        <h3 style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-3)', letterSpacing: '0.1em', textTransform: 'uppercase', margin: '0 0 14px' }}>
          Bias Fingerprint
        </h3>
        <div style={{
          background:   'var(--bg-card)',
          border:       '1px solid var(--border-dim)',
          borderRadius: 12,
          padding:      '20px 20px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <div style={{
              width:  8, height: 8, borderRadius: '50%',
              background: 'var(--gold)',
              animation:  'blink 2s ease-in-out infinite',
            }} />
            <span style={{ fontSize: 12, color: 'var(--text-3)', fontWeight: 600 }}>
              Analyzing your patterns…
            </span>
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-4)', margin: 0, lineHeight: 1.6 }}>
            Your bias fingerprint is being compiled from {status.sessionCount} sessions.
            Pattern tiles and your personal decision narrative will appear here once the
            analysis cycle completes.
          </p>
        </div>
      </div>

      {/* Decision Independence Score — placeholder (Sprint 7c) */}
      <div>
        <h3 style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-3)', letterSpacing: '0.1em', textTransform: 'uppercase', margin: '0 0 14px' }}>
          Decision Independence
        </h3>
        <div style={{
          background:   'var(--bg-card)',
          border:       '1px solid var(--border-dim)',
          borderRadius: 12,
          padding:      '20px 20px',
        }}>
          <p style={{ fontSize: 12, color: 'var(--text-4)', margin: 0, lineHeight: 1.6 }}>
            Tracks whether you're incorporating Quorum's frameworks in your own reasoning,
            unprompted — the measure of whether your judgment is truly compounding.
            Score calculation coming in the next update.
          </p>
        </div>
      </div>
    </div>
  )
}

// ── Main page component ───────────────────────────────────────────────────────
export default function MirrorPage() {
  const router = useRouter()

  const [loading,   setLoading]   = useState(true)
  const [status,    setStatus]    = useState<MirrorStatus | null>(null)
  const [sessions,  setSessions]  = useState<TimelineSession[]>([])
  const [authToken, setAuthToken] = useState<string | null>(null)
  const [fetchError, setFetchError] = useState(false)

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

      // If user can see the timeline (paywall or unlocked), fetch it
      if (data.gateState === 'paywall' || data.gateState === 'unlocked') {
        const tlRes  = await fetch('/api/mirror/timeline', { headers })
        const tlData = await tlRes.json() as { sessions: TimelineSession[] }
        setSessions(tlData.sessions ?? [])
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

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
      <style>{`
        @keyframes seg-pulse { 0%, 100% { opacity: 0.2; } 50% { opacity: 0.5; } }
        @keyframes blink      { 0%, 100% { opacity: 0.4; } 50% { opacity: 1; } }
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
              padding:        '4px 0',
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

        {/* ── Page header (paywall/unlocked only) ──────────────────────────── */}
        {(status?.gateState === 'paywall' || status?.gateState === 'unlocked') && (
          <div style={{
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
                : 'Your decision history — bias fingerprint locked below.'}
            </p>
          </div>
        )}

        {/* ── Main content ─────────────────────────────────────────────────── */}
        <div style={{ padding: '0 24px' }}>
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
              {status.gateState === 'auth'      && <AuthGate />}
              {status.gateState === 'threshold' && (
                <ThresholdGate sessionCount={status.sessionCount} threshold={status.threshold} />
              )}
              {status.gateState === 'paywall'   && (
                <PaywallGate status={status} sessions={sessions} />
              )}
              {status.gateState === 'unlocked'  && (
                <UnlockedView status={status} sessions={sessions} />
              )}
            </>
          )}
        </div>
      </div>
    </>
  )
}

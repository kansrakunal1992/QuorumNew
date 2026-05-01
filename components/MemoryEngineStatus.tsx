'use client'

// ── MemoryEngineStatus ────────────────────────────────────────────────────────
// Displays a compact "system readiness" card on the home page.
// Tells users how close they are to activating Structural Retrieval (5 sessions)
// and Mirror (10 sessions), and nudges them to log pending outcomes.
//
// Sprint 4b: hasIdentity prop added.
// When false (anonymous / no email), shows a minimal email CTA instead of the
// progress bar. Prevents anonymous users from seeing misleading pattern-memory
// progress that would vanish if they clear localStorage.
//
// Placement: between the input card and persona/tips grid.
// Only rendered when sessions.length > 0.

interface Props {
  sessionCount: number
  pendingOutcomes: number
  decidedCount: number
  hasIdentity: boolean          // true if user_email or user_id is present
  onScrollToHistory: () => void
}

const PATTERN_MEMORY_THRESHOLD = 5
const MIRROR_THRESHOLD = 5   // Sprint 7a: Mirror unlocks at 5 sessions (same as Pattern Memory)

function SegmentBar({ filled, total }: { filled: number; total: number }) {
  return (
    <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
      {Array.from({ length: total }).map((_, i) => {
        const isFilled = i < filled
        const isPulse  = i === filled && filled < total
        return (
          <div
            key={i}
            style={{
              width: 18,
              height: 4,
              borderRadius: 2,
              background: isFilled
                ? filled >= PATTERN_MEMORY_THRESHOLD
                  ? 'rgba(74,222,128,0.85)'
                  : 'var(--gold)'
                : 'var(--border-mid)',
              opacity: isFilled ? 1 : isPulse ? 0.4 : 0.2,
              transition: 'background 0.4s, opacity 0.4s',
              animation: isPulse ? 'segment-pulse 2s ease-in-out infinite' : 'none',
            }}
          />
        )
      })}
    </div>
  )
}

export default function MemoryEngineStatus({
  sessionCount,
  pendingOutcomes,
  decidedCount,
  hasIdentity,
  onScrollToHistory,
}: Props) {
  if (sessionCount === 0) return null

  // ── Anonymous view (no email, no user_id) ─────────────────────────────────
  // Show a minimal card with a CTA to add email. Do NOT show progress bar —
  // device-local sessions would be "forgotten" if localStorage is cleared,
  // so surfacing pattern-memory progress would be misleading.
  if (!hasIdentity) {
    return (
      <>
        <style>{`
          @keyframes dot-blink {
            0%, 100% { opacity: 0.4; }
            50%       { opacity: 1; }
          }
        `}</style>
        <div
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border-mid)',
            borderRadius: 14,
            padding: '14px 20px',
            marginBottom: 20,
            display: 'flex',
            alignItems: 'center',
            gap: 14,
          }}
        >
          <div
            style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: 'var(--gold)',
              animation: 'dot-blink 2s ease-in-out infinite',
              flexShrink: 0,
            }}
          />
          <div style={{ flex: 1 }}>
            <p style={{ fontSize: 11, color: 'var(--text-3)', margin: '0 0 2px', fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
              Memory Engine
            </p>
            <p style={{ fontSize: 11, color: 'var(--text-4)', margin: 0, lineHeight: 1.5 }}>
              Add your email below to build pattern memory across sessions.{' '}
              <span style={{ color: 'var(--text-3)' }}>
                {sessionCount} session{sessionCount !== 1 ? 's' : ''} on this device
              </span>
              {' '}— not yet linked to your profile.
            </p>
          </div>
        </div>
      </>
    )
  }

  // ── Identified view (email or user_id present) ─────────────────────────────
  const sessionsTowardMirror  = Math.min(sessionCount, MIRROR_THRESHOLD)
  const patternActive         = sessionCount >= PATTERN_MEMORY_THRESHOLD
  const mirrorReady           = sessionCount >= MIRROR_THRESHOLD

  let statusLabel: string
  let statusColor: string
  if (mirrorReady) {
    statusLabel = 'Pattern Memory active · Mirror unlocked'
    statusColor = '#4ade80'
  } else if (patternActive) {
    // patternActive and mirrorReady are same threshold now — this branch shouldn't fire
    statusLabel = 'Pattern Memory active'
    statusColor = '#4ade80'
  } else {
    const remaining = PATTERN_MEMORY_THRESHOLD - sessionCount
    statusLabel = `${remaining} more session${remaining !== 1 ? 's' : ''} to activate Pattern Memory + Mirror`
    statusColor = 'var(--gold)'
  }

  return (
    <>
      <style>{`
        @keyframes segment-pulse {
          0%, 100% { opacity: 0.25; }
          50%       { opacity: 0.6; }
        }
        @keyframes dot-blink {
          0%, 100% { opacity: 0.4; }
          50%       { opacity: 1; }
        }
      `}</style>

      <div
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border-mid)',
          borderRadius: 14,
          padding: '16px 20px',
          marginBottom: 20,
        }}
      >
        {/* Header row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div
              style={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: patternActive ? '#4ade80' : 'var(--gold)',
                animation: patternActive ? 'none' : 'dot-blink 2s ease-in-out infinite',
                flexShrink: 0,
              }}
            />
            <span
              style={{
                fontSize: 10.5,
                fontWeight: 700,
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                color: 'var(--text-3)',
              }}
            >
              Memory Engine
            </span>
          </div>

          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              color: patternActive ? '#4ade80' : 'var(--gold)',
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
            }}
          >
            {patternActive ? (mirrorReady ? '● Active' : '● Pattern Memory') : '○ Inactive'}
          </span>
        </div>

        {/* Main metrics row */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 16, alignItems: 'center' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <SegmentBar
                filled={Math.min(sessionCount, MIRROR_THRESHOLD)}
                total={MIRROR_THRESHOLD}
              />
              <span style={{ fontSize: 11, color: 'var(--text-3)', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
                {mirrorReady
                  ? `${sessionCount} sessions`
                  : `${sessionCount} of ${MIRROR_THRESHOLD}`}
              </span>
            </div>
            <p style={{ fontSize: 11, color: statusColor, margin: 0, lineHeight: 1.4 }}>
              {statusLabel}
              {mirrorReady && (
                <a
                  href="/mirror"
                  style={{
                    display:        'inline-flex',
                    alignItems:     'center',
                    gap:            4,
                    marginLeft:     10,
                    color:          '#4ade80',
                    fontSize:       10.5,
                    fontWeight:     600,
                    textDecoration: 'none',
                    letterSpacing:  '0.06em',
                    opacity:        0.85,
                  }}
                >
                  View Mirror →
                </a>
              )}
            </p>
          </div>

          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            {pendingOutcomes > 0 ? (
              <button
                onClick={onScrollToHistory}
                style={{
                  background: 'rgba(201,168,76,0.08)',
                  border: '1px solid var(--gold-dim)',
                  borderRadius: 8,
                  padding: '6px 12px',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  textAlign: 'right',
                }}
              >
                <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--gold)', margin: '0 0 1px' }}>
                  {pendingOutcomes}
                </p>
                <p style={{ fontSize: 9.5, color: 'var(--text-4)', margin: 0, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                  {pendingOutcomes === 1 ? 'Outcome pending' : 'Outcomes pending'}
                </p>
              </button>
            ) : decidedCount > 0 ? (
              <div style={{ textAlign: 'right' }}>
                <p style={{ fontSize: 13, fontWeight: 700, color: '#4ade80', margin: '0 0 1px' }}>
                  {decidedCount}
                </p>
                <p style={{ fontSize: 9.5, color: 'var(--text-4)', margin: 0, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                  Outcomes logged
                </p>
              </div>
            ) : null}
          </div>
        </div>

        {!patternActive && (
          <div
            style={{
              marginTop: 12,
              paddingTop: 10,
              borderTop: '1px solid var(--border-dim)',
              display: 'flex',
              alignItems: 'flex-start',
              gap: 8,
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-4)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}>
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            <p style={{ fontSize: 11, color: 'var(--text-4)', margin: 0, lineHeight: 1.5 }}>
              Pattern Memory surfaces structural matches between your current decision and past sessions —&nbsp;
              <span style={{ color: 'var(--text-3)' }}>
                "you faced this structure before."
              </span>
              {' '}Each session logged builds toward it.
            </p>
          </div>
        )}


      </div>
    </>
  )
}

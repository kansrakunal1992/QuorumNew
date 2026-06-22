// components/DecisionTimeline.tsx
// ── RET-5 Sprint 3: Decision Arc timeline ─────────────────────────────────────
//
// Shown on the ROOT session's record page when ≥1 revisit exists.
// Stitches all sittings in the chain with their outcomes and dates.
//
// Free, ungated — always visible for any chain.
//
// Mirror conversion tile at the bottom is ADDITIVE:
//   - Mirror users: shows calibration delta across sittings (if outcomes logged)
//   - Non-Mirror users: names what exists without showing the data
//
// Server component — no client interactivity needed; all data passed as props.
// ─────────────────────────────────────────────────────────────────────────────

import Link from 'next/link'

export interface TimelineEntry {
  id:              string
  createdAt:       string   // ISO string
  decisionSnippet: string   // truncated, already decrypted
  isCurrent:       boolean
  outcome: {
    whatDecided:      string
    councilHelped:    string   // 'yes' | 'partially' | 'no'
    calibrationDelta: number | null
  } | null
}

interface Props {
  entries:             TimelineEntry[]
  currentSessionId:    string
  hasMirrorAccess:     boolean
  avgCalibrationDelta: number | null   // mean of logged calibration_deltas across chain
}

// ── helpers ──────────────────────────────────────────────────────────────────

function formatDateShort(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric',
  })
}

const HELPED_LABEL: Record<string, string> = {
  yes:       'Council helped',
  partially: 'Partially helpful',
  no:        'Council not helpful',
}

const HELPED_COLOR: Record<string, string> = {
  yes:       'var(--green-text)',
  partially: 'var(--gold-dim)',
  no:        'var(--text-4)',
}

// ─────────────────────────────────────────────────────────────────────────────

export default function DecisionTimeline({
  entries,
  currentSessionId,
  hasMirrorAccess,
  avgCalibrationDelta,
}: Props) {
  if (entries.length < 2) return null

  const sittingCount = entries.length
  const outcomesLogged = entries.filter(e => e.outcome !== null).length
  const hasCalibrationData = avgCalibrationDelta !== null

  return (
    <div style={{
      background:   'linear-gradient(180deg, rgba(255,255,255,0.012) 0%, transparent 60%), var(--bg-card)',
      border:       '1px solid var(--border-dim)',
      borderRadius: 12,
      padding:      '18px 20px 14px',
      position:     'relative',
      overflow:     'hidden',
    }}>
      {/* Gold top accent — same as AdvisoryUpsellCard */}
      <div style={{
        position: 'absolute', top: 0, left: 0,
        width: '100%', height: 2,
        background: 'linear-gradient(90deg, var(--gold-dim) 0%, transparent 60%)',
      }} />

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 16 }}>
        <p style={{
          fontSize: 10, fontWeight: 700,
          textTransform: 'uppercase', letterSpacing: '0.12em',
          color: 'var(--gold)', margin: 0,
        }}>
          Decision Arc
        </p>
        <p style={{
          fontSize: 11, color: 'var(--text-4)',
          fontFamily: 'var(--font-mono)', margin: 0,
        }}>
          {sittingCount} sittings
        </p>
      </div>

      {/* Timeline entries */}
      <div style={{ position: 'relative' }}>
        {/* Vertical connector line */}
        <div style={{
          position:   'absolute',
          left:        6,
          top:         10,
          bottom:      10,
          width:       1,
          background: 'var(--border-dim)',
        }} />

        {entries.map((entry, idx) => {
          const isLast    = idx === entries.length - 1
          const isCurrent = entry.id === currentSessionId
          const nodeColor = isCurrent ? 'var(--gold)' : 'var(--text-4)'

          const inner = (
            <div style={{
              display:      'flex',
              gap:           14,
              marginBottom:  isLast ? 0 : 18,
              position:     'relative',
            }}>
              {/* Node dot */}
              <div style={{
                flexShrink:    0,
                width:         13,
                height:        13,
                borderRadius:  '50%',
                border:        `2px solid ${nodeColor}`,
                background:    isCurrent ? 'var(--gold)' : 'transparent',
                marginTop:     3,
                position:     'relative',
                zIndex:        1,
              }} />

              {/* Content */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{
                  fontSize:      11,
                  color:         isCurrent ? 'var(--gold)' : 'var(--text-4)',
                  fontFamily:   'var(--font-mono)',
                  letterSpacing: '0.08em',
                  margin:        '0 0 3px',
                }}>
                  {formatDateShort(entry.createdAt)}
                  {isCurrent && (
                    <span style={{
                      marginLeft:    8,
                      fontSize:      10,
                      background:   'rgba(201,168,76,0.12)',
                      color:        'var(--gold)',
                      padding:      '1px 7px',
                      borderRadius:  20,
                      fontFamily:   'var(--font-mono)',
                      letterSpacing: '0.1em',
                      textTransform: 'uppercase',
                    }}>
                      this sitting
                    </span>
                  )}
                </p>

                <p style={{
                  fontSize:    12.5,
                  color:       isCurrent ? 'var(--text-2)' : 'var(--text-3)',
                  lineHeight:  1.55,
                  margin:      '0 0 5px',
                  fontStyle:   isCurrent ? 'normal' : 'normal',
                }}>
                  {entry.decisionSnippet}
                </p>

                {entry.outcome ? (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    <span style={{
                      fontSize:     11,
                      color:        'var(--text-3)',
                      background:   'var(--bg-input)',
                      borderRadius:  20,
                      padding:      '2px 9px',
                    }}>
                      {entry.outcome.whatDecided.length > 60
                        ? entry.outcome.whatDecided.slice(0, 60).replace(/\s+\S*$/, '') + '…'
                        : entry.outcome.whatDecided}
                    </span>
                    <span style={{
                      fontSize:     10,
                      color:        HELPED_COLOR[entry.outcome.councilHelped] ?? 'var(--text-4)',
                      letterSpacing: '0.05em',
                    }}>
                      {HELPED_LABEL[entry.outcome.councilHelped] ?? entry.outcome.councilHelped}
                    </span>
                  </div>
                ) : (
                  <p style={{ fontSize: 11, color: 'var(--text-4)', margin: 0, fontStyle: 'italic' }}>
                    Outcome not yet logged
                  </p>
                )}
              </div>
            </div>
          )

          // Non-current entries are links to their record pages
          return isCurrent ? (
            <div key={entry.id}>{inner}</div>
          ) : (
            <Link
              key={entry.id}
              href={`/record/${entry.id}`}
              style={{ textDecoration: 'none', display: 'block' }}
            >
              {inner}
            </Link>
          )
        })}
      </div>

      {/* ── Mirror conversion tile ───────────────────────────────────────────── */}
      {/* Additive — timeline always free above. This tile shows calibration
          arc data to Mirror members; names it (not blurs it) for non-members. */}
      <div style={{
        marginTop:    16,
        borderTop:   '1px solid var(--border-dim)',
        paddingTop:   14,
      }}>
        {hasMirrorAccess ? (
          // Mirror unlocked — show actual calibration data if available
          hasCalibrationData ? (
            <div>
              <p style={{
                fontSize: 10, fontWeight: 700,
                textTransform: 'uppercase', letterSpacing: '0.12em',
                color: 'var(--text-3)', margin: '0 0 5px',
              }}>
                Calibration Arc
              </p>
              <p style={{ fontSize: 12.5, color: 'var(--text-3)', margin: 0, lineHeight: 1.6 }}>
                Across {outcomesLogged} logged outcome{outcomesLogged !== 1 ? 's' : ''} in this arc, your
                pre-decision confidence shifted by{' '}
                <span style={{
                  color:  avgCalibrationDelta! >= 0 ? 'var(--green-text)' : 'var(--text-4)',
                  fontWeight: 600,
                }}>
                  {avgCalibrationDelta! >= 0 ? '+' : ''}{avgCalibrationDelta!.toFixed(1)} points
                </span>{' '}
                on average between what you expected and how the outcome landed.
                {Math.abs(avgCalibrationDelta!) < 1 && ' Well-calibrated across sittings.'}
                {avgCalibrationDelta! >= 2  && ' Your confidence was running ahead of outcomes — worth noting for the next sitting.'}
                {avgCalibrationDelta! <= -2 && ' Outcomes landed better than you expected — confidence may have been understating your judgment.'}
              </p>
            </div>
          ) : (
            // Mirror unlocked, but no outcome data yet
            <p style={{ fontSize: 11.5, color: 'var(--text-4)', margin: 0, fontStyle: 'italic' }}>
              Log outcomes for both sittings to see your calibration arc.
            </p>
          )
        ) : (
          // Non-Mirror — teaser tile, names the feature, no data shown, no blur
          <div>
            <p style={{
              fontSize: 10, fontWeight: 700,
              textTransform: 'uppercase', letterSpacing: '0.12em',
              color: 'var(--gold)', margin: '0 0 5px',
            }}>
              Calibration Arc · Mirror
            </p>
            <p style={{ fontSize: 12.5, color: 'var(--text-4)', margin: 0, lineHeight: 1.6 }}>
              Mirror members see how confidence and judgment accuracy shifted across
              this decision's sittings — across {sittingCount} sitting{sittingCount !== 1 ? 's' : ''} and
              every outcome logged in the arc.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

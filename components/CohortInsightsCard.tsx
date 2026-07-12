'use client'
// components/CohortInsightsCard.tsx
// Institutional Sprint 3 (task 4) — the "Cohort" section on a member's own
// Mirror view. Populated only when they're in a cohort with at least one
// other mutually-consenting member; renders null otherwise — no UI element
// implying a cohort exists if it doesn't (plan Section 4 task 4, verbatim).
//
// Self-contained by necessity: app/mirror/page.tsx's SectionWrapper/sw()
// collapse-state helpers are local functions defined inside that file, not
// exported, so they can't be imported here. This card supplies its own
// section chrome (title + description + divider) and only renders that
// chrome when there's real data — matching the "absent, not empty" rule
// more directly than reusing an external wrapper would anyway, since the
// wrapper itself would need to be conditional on the same data this
// component fetches.
//
// Trade-off, flagged rather than silently accepted: this means the cohort
// section doesn't get the shared collapse/expand-and-remember-state
// affordance every other Mirror section has. Reasonable for a Sprint 3
// skeleton; Sprint 5 (full UI integration) can lift this into the shared
// wrapper mechanism if that affordance matters enough by then.
//
// Usage: <CohortInsightsCard authToken={authToken} /> — matches the
// authToken-prop convention already used by BiasFingerprint, CalibrationSparkline, etc.

import { useState, useEffect } from 'react'
import { isInstitutionalModeEnabled } from '@/lib/feature-flags'   // Sprint 6 fix — was missing (Sprint 3 predates this convention); server route already 404s so no UI leak existed, but this avoids a wasted fetch for every non-institutional user on every Mirror load

interface CohortPeerInsight {
  userId:              string
  email:               string | null
  sessionScore:        number | null
  sessionScoreDelta:   number | null
  calibrationDeltaAvg: number | null
  biasParameters:      string[]
}

interface CohortInsightsGroup {
  cohortId:   string
  cohortName: string
  peers:      CohortPeerInsight[]
}

interface CohortInsightsResponse {
  hasCohortInsights: boolean
  cohorts: CohortInsightsGroup[]
}

export default function CohortInsightsCard({ authToken }: { authToken: string | null }) {
  const [data, setData] = useState<CohortInsightsResponse | null>(null)

  useEffect(() => {
    if (!isInstitutionalModeEnabled() || !authToken) return
    let cancelled = false

    fetch('/api/institutions/cohort-insights', {
      headers: { Authorization: `Bearer ${authToken}` },
    })
      .then(res => (res.ok ? res.json() : null))
      .then((json: CohortInsightsResponse | null) => { if (!cancelled) setData(json) })
      .catch(() => { if (!cancelled) setData(null) })

    return () => { cancelled = true }
  }, [authToken])

  if (!data?.hasCohortInsights) return null

  const populatedCohorts = data.cohorts.filter(c => c.peers.length > 0)
  if (!populatedCohorts.length) return null

  return (
    <div id="msec-cohort" style={{ marginBottom: 28 }}>
      <h2 style={{
        fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 400,
        color: 'var(--text-1)', margin: '0 0 6px',
      }}>
        Your Cohort
      </h2>
      <p style={{ fontSize: 12.5, color: 'var(--text-4)', lineHeight: 1.55, margin: '0 0 16px' }}>
        Insights mutually shared with cohort members who&apos;ve also opted in — session trends
        and calibration patterns only, never your raw decisions or theirs.
      </p>

      {populatedCohorts.map(cohort => (
        <div key={cohort.cohortId} style={{
          background: 'var(--bg-card)', border: '1px solid var(--border-dim)',
          borderRadius: 14, padding: '16px 18px', marginBottom: 14,
        }}>
          <p style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-2)', margin: '0 0 12px' }}>
            {cohort.cohortName}
          </p>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {cohort.peers.map(peer => (
              <div key={peer.userId} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '9px 0', borderTop: '1px solid var(--border-dim)',
              }}>
                <span style={{ fontSize: 12.5, color: 'var(--text-2)' }}>
                  {peer.email ?? 'Cohort member'}
                </span>
                <span style={{ fontSize: 11.5, color: 'var(--text-4)', fontFamily: 'var(--font-mono)' }}>
                  {peer.sessionScore != null ? `Score ${peer.sessionScore}` : '—'}
                  {peer.calibrationDeltaAvg != null ? `  ·  Δ ${peer.calibrationDeltaAvg}` : ''}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}

      <hr className="gold-rule" style={{ margin: '4px 0 0' }} />
    </div>
  )
}

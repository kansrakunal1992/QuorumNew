'use client'
// app/admin/page.tsx
// ── Quorum Admin Dashboard ────────────────────────────────────────────────────
//
// Available at /admin — completely hidden from public router.
// Auth: ADMIN_CODE Railway env var. Wrong password → silent redirect to /.
// Correct password stored in sessionStorage for the tab's lifetime.
//
// Sections:
//   Action items — everything currently "due" across the page, one place,
//                   hover for why (no popups/modals — see components/Tooltip.tsx)
//   Case studies  — human-review queue (components/CaseStudyReviewPanel.tsx)
//   Institutions  — create/manage (components/CreateInstitutionPanel.tsx)
//   Audit log     — last 100 admin/account events
//   R7 — Rule Calibration: per-rule council_helped correlation (last 90 days)
//   R8 — Threshold Sensitivity: corpus counts at current ± 10% for each constant
//   R11 — Active Thresholds + avoidance-alert stats
//
// Revamp notes (this pass):
//   - Was hardcoded to Tailwind zinc-* classes throughout, so it never
//     responded to the site's data-theme toggle — light mode showed a fully
//     dark page. Rewritten on the same var(--bg-card) / var(--text-*) tokens
//     CreateInstitutionPanel.tsx and app/institution/admin/page.tsx already
//     use, so it now follows light/dark correctly.
//   - Sections are now visually distinct cards instead of loose blocks on
//     the page background, and low-contrast text (zinc-600/700 on zinc-950)
//     is replaced with the theme's calibrated text tokens.
//   - Added an "Action items" strip at the top that surfaces every signal
//     this page already computes but previously buried in tables (flagged
//     rules, milestone thresholds, env overrides, open avoidance alerts,
//     case studies waiting on review) — each is a small hover tooltip, not
//     a popup, so nothing needs to be dismissed or blocks the page.
//
// No new schema. No new env vars beyond ADMIN_CODE.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useRouter }                                  from 'next/navigation'
import CaseStudyReviewPanel   from '@/components/CaseStudyReviewPanel'   // Item #11
import CreateInstitutionPanel from '@/components/CreateInstitutionPanel' // Institutional Sprint 6
import Tooltip, { DueDot }    from '@/components/Tooltip'

// ── Types ─────────────────────────────────────────────────────────────────────

interface R7Row {
  rule_id:       string
  label:         string
  fires_90d:     number
  outcomes_90d:  number
  avg_fired:     number | null
  avg_not_fired: number | null
  delta:         number | null
  flag:          boolean
  global_avg:    number | null
}

type R8ThresholdVariant = { value: number; count: number } | null

interface R8Row {
  name:          string
  location:      string
  description:   string
  current:       number
  current_count: number | null
  minus_10:      R8ThresholdVariant
  plus_10:       R8ThresholdVariant
  corpus_total:  number | null
  milestone:     string
  note:          string | null
}

interface R11ThresholdRow {
  name:            string
  default_value:   number
  effective_value: number
  is_overridden:   boolean
  env_raw:         string | null
}

interface R11Data {
  effective_thresholds: R11ThresholdRow[]
  avoidance: {
    total:                 number
    open:                  number
    dismissed:             number
    avg_days_open:         number | null
    active_days_threshold: number
    active_echo_threshold: number
  }
}

interface DashboardData {
  r7:   R7Row[]
  r8:   R8Row[]
  r11:  R11Data
  meta: {
    generated_at:           string
    window_days:            number
    total_sessions:         number
    sessions_with_outcomes: number
    global_avg_helped:      number | null
  }
}

interface AuditLogEntry {
  id:          string
  created_at:  string
  actor_email: string | null
  action:      string
  resource_id: string | null
  ip_address:  string | null
  metadata:    Record<string, unknown> | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtScore(v: number | null): string {
  if (v == null) return '—'
  return (v * 100).toFixed(0) + '%'
}

function fmtDelta(v: number | null): string {
  if (v == null) return '—'
  const pct = (v * 100).toFixed(0)
  return v >= 0 ? `+${pct}pp` : `${pct}pp`
}

function deltaColor(v: number | null, flag: boolean): string {
  if (v == null) return 'var(--text-4)'
  if (flag) return 'var(--error)'
  if (v > 0.05) return 'var(--success-text)'
  return 'var(--text-3)'
}

function auditActionColor(action: string): string {
  if (action.startsWith('admin.auth_fail') || action.startsWith('admin.locked')) return 'var(--error)'
  if (action.startsWith('account.delete')) return '#e08a3a'
  if (action.startsWith('admin.')) return 'var(--gold)'
  return 'var(--text-3)'
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function AdminPage() {
  const router = useRouter()

  const [phase,     setPhase]     = useState<'gate' | 'loading' | 'ready' | 'error'>('gate')
  const [codeInput, setCodeInput] = useState('')
  const [data,      setData]      = useState<DashboardData | null>(null)
  const [auditLog,  setAuditLog]  = useState<AuditLogEntry[]>([])
  const [errorMsg,  setErrorMsg]  = useState('')
  const [caseStudyCount, setCaseStudyCount] = useState<number | null>(null)

  // Define fetchDashboard BEFORE useEffect so the closure captures an
  // initialised binding. Defining it after caused a TDZ reference in
  // React strict-mode's synchronous effect replay.
  const fetchDashboard = useCallback(async (code: string) => {
    setPhase('loading')
    try {
      const res = await fetch('/api/admin/dashboard', {
        headers: { Authorization: `Bearer ${code}` },
      })
      if (res.status === 401) {
        sessionStorage.removeItem('quorum_admin_code')
        router.push('/')
        return
      }
      // Parse JSON separately so a non-JSON body (Railway HTML error page)
      // produces a clear message rather than landing in the generic catch.
      let json: DashboardData
      try {
        json = await res.json() as DashboardData
      } catch {
        setErrorMsg(`Response was not JSON — check Railway build logs (HTTP ${res.status})`)
        setPhase('error')
        return
      }
      if (!res.ok) {
        setErrorMsg(`Server error ${res.status} — check Railway logs`)
        setPhase('error')
        return
      }
      setData(json)
      sessionStorage.setItem('quorum_admin_code', code)
      setPhase('ready')

      // S6-05: fetch audit log (non-blocking — failure is non-fatal)
      try {
        const auditRes = await fetch('/api/admin/audit-log', {
          headers: { Authorization: `Bearer ${code}` },
        })
        if (auditRes.ok) {
          const auditData = await auditRes.json() as { entries: AuditLogEntry[] }
          setAuditLog(auditData.entries ?? [])
        }
      } catch { /* non-fatal */ }
    } catch (err) {
      setErrorMsg(`Network error: ${String(err)}`)
      setPhase('error')
    }
  }, [router])

  // On mount: if a code is already stored, skip the gate and fetch immediately.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const stored = sessionStorage.getItem('quorum_admin_code')
    if (stored) void fetchDashboard(stored)
  }, [fetchDashboard])

  const handleSubmit = () => {
    if (!codeInput.trim()) return
    void fetchDashboard(codeInput.trim())
  }

  // ── Action items — everything on this page currently "due", computed
  //    once per data change so the tooltip strip and the tables below stay
  //    in sync without duplicating logic. ────────────────────────────────
  const actionItems = useMemo(() => {
    if (!data) return []
    const items: { key: string; tone: 'flag' | 'note'; label: string; detail: string }[] = []

    const flaggedRules = data.r7.filter(r => r.flag)
    if (flaggedRules.length) {
      items.push({
        key: 'r7-flags', tone: 'flag',
        label: `${flaggedRules.length} rule${flaggedRules.length > 1 ? 's' : ''} flagged`,
        detail: `Council performs 10pp+ worse on average when these fire: ${flaggedRules.map(r => r.rule_id).join(', ')}. Review quarterly — consider threshold or prompt tuning.`,
      })
    }

    const atMilestone = data.r8.filter(r => r.milestone.startsWith('🟡') || r.milestone.startsWith('🟢'))
    if (atMilestone.length) {
      items.push({
        key: 'r8-milestone', tone: 'note',
        label: `${atMilestone.length} threshold${atMilestone.length > 1 ? 's' : ''} at a review milestone`,
        detail: `${atMilestone.map(r => `${r.name} (${r.milestone.replace(/[🟡🟢]\s*/, '')})`).join(', ')}. 100+ sessions → review; 250+ → recalibrate against real data.`,
      })
    }

    const overridden = data.r11.effective_thresholds.filter(t => t.is_overridden)
    if (overridden.length) {
      items.push({
        key: 'r11-override', tone: 'note',
        label: `${overridden.length} threshold${overridden.length > 1 ? 's' : ''} overridden`,
        detail: `Set via Railway env, differ from code defaults: ${overridden.map(t => t.name).join(', ')}.`,
      })
    }

    if (data.r11.avoidance.open > 0) {
      items.push({
        key: 'r11-avoidance', tone: 'flag',
        label: `${data.r11.avoidance.open} avoidance alert${data.r11.avoidance.open > 1 ? 's' : ''} open`,
        detail: `Days open ≥ ${data.r11.avoidance.active_days_threshold} or structural-echo score ≥ ${data.r11.avoidance.active_echo_threshold}/100 — worth a manual look at who's stuck.`,
      })
    }

    if (caseStudyCount) {
      items.push({
        key: 'case-studies', tone: 'note',
        label: `${caseStudyCount} case stud${caseStudyCount > 1 ? 'ies' : 'y'} to review`,
        detail: `User-submitted, waiting on a human read before anything goes into the public library.`,
      })
    }

    return items
  }, [data, caseStudyCount])

  // ── Password Gate ───────────────────────────────────────────────────────────

  if (phase === 'gate') {
    return (
      <div style={fullScreenCenterStyle}>
        <div style={{ width: '100%', maxWidth: 360, display: 'flex', flexDirection: 'column', gap: 16, padding: '0 24px' }}>
          <p className="t-label">Quorum</p>
          <input
            type="password"
            value={codeInput}
            onChange={e => setCodeInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleSubmit() }}
            placeholder="Admin code"
            style={gateInputStyle}
            autoFocus
          />
          <button onClick={handleSubmit} style={gateButtonStyle}>
            Enter
          </button>
        </div>
      </div>
    )
  }

  if (phase === 'loading') {
    return (
      <div style={fullScreenCenterStyle}>
        <p style={{ color: 'var(--text-4)', fontSize: 13 }}>Loading…</p>
      </div>
    )
  }

  if (phase === 'error') {
    return (
      <div style={fullScreenCenterStyle}>
        <p style={{ color: 'var(--error)', fontSize: 13, maxWidth: 420, textAlign: 'center', padding: '0 20px' }}>{errorMsg}</p>
      </div>
    )
  }

  if (!data) return null

  const { r7, r8, r11, meta } = data
  const storedCode = sessionStorage.getItem('quorum_admin_code') ?? ''

  // ── Dashboard ───────────────────────────────────────────────────────────────

  return (
    <div style={{ minHeight: '100vh', color: 'var(--text-1)', padding: '40px 24px 48px', maxWidth: 1100, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 36 }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <p className="t-label" style={{ marginBottom: 4 }}>Quorum</p>
          <h1 style={{ fontSize: 21, fontWeight: 600, color: 'var(--text-1)', margin: 0 }}>Admin Dashboard</h1>
          <p style={{ fontSize: 12.5, color: 'var(--text-3)', marginTop: 6 }}>
            Generated {new Date(meta.generated_at).toLocaleString()} · {meta.total_sessions} sessions
            {' '}({meta.sessions_with_outcomes} with outcomes) · Last 90 days
            {meta.global_avg_helped != null && (
              <> · Global avg helpfulness: <span style={{ color: 'var(--text-2)' }}>{fmtScore(meta.global_avg_helped)}</span></>
            )}
          </p>
        </div>
        <button onClick={() => void fetchDashboard(storedCode)} style={refreshButtonStyle}>
          Refresh
        </button>
      </div>

      {/* ── Action items — one place for everything currently due ──────────── */}
      <section style={actionBarStyle}>
        <p className="t-label" style={{ marginBottom: 10 }}>Needs attention</p>
        {actionItems.length === 0 ? (
          <p style={{ fontSize: 12.5, color: 'var(--text-3)', margin: 0 }}>
            All clear — nothing flagged, no overrides, no open alerts.
          </p>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            {actionItems.map(item => (
              <Tooltip key={item.key} label={item.detail} tone={item.tone === 'flag' ? 'warning' : 'default'}>
                <span style={actionChipStyle}>
                  <DueDot tone={item.tone === 'flag' ? 'warning' : 'amber'} />
                  {item.label}
                </span>
              </Tooltip>
            ))}
          </div>
        )}
      </section>

      {/* Item #11 — case-study review queue; actionable, time-sensitive,
          so it sits above the R7/R8 analytics rather than below them */}
      <CaseStudyReviewPanel adminCode={storedCode} onCountChange={setCaseStudyCount} />
      <CreateInstitutionPanel adminCode={storedCode} />

      {/* ── Audit Log ─────────────────────────────────────────────────────── */}
      <section style={cardStyle}>
        <div style={cardHeaderStyle}>
          <p style={cardHeaderTitleStyle}>Audit Log</p>
          <span style={{ fontSize: 11, color: 'var(--text-4)' }}>Last 100 events · most recent first</span>
        </div>
        <div style={{ padding: '14px 18px 18px' }}>
          {auditLog.length === 0 ? (
            <p style={{ fontSize: 12, color: 'var(--text-4)', margin: 0 }}>
              No audit events yet — run the sprint6_audit_log.sql migration first.
            </p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={thStyle}>Time (UTC)</th>
                    <th style={thStyle}>Actor</th>
                    <th style={thStyle}>Action</th>
                    <th style={thStyle}>IP</th>
                    <th style={thStyle}>Meta</th>
                  </tr>
                </thead>
                <tbody>
                  {auditLog.map(entry => (
                    <tr key={entry.id} style={trStyle}>
                      <td style={{ ...tdStyle, color: 'var(--text-3)', whiteSpace: 'nowrap', fontFamily: 'var(--font-mono)' }}>
                        {new Date(entry.created_at).toISOString().replace('T', ' ').slice(0, 19)}
                      </td>
                      <td style={{ ...tdStyle, color: 'var(--text-2)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {entry.actor_email ?? '—'}
                      </td>
                      <td style={tdStyle}>
                        <span style={{ fontFamily: 'var(--font-mono)', color: auditActionColor(entry.action) }}>
                          {entry.action}
                        </span>
                      </td>
                      <td style={{ ...tdStyle, color: 'var(--text-4)', fontFamily: 'var(--font-mono)' }}>
                        {entry.ip_address ?? '—'}
                      </td>
                      <td style={{ ...tdStyle, color: 'var(--text-4)', fontFamily: 'var(--font-mono)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {entry.metadata ? JSON.stringify(entry.metadata) : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {/* ── R7: Rule Calibration ─────────────────────────────────────────────── */}
      <section style={cardStyle}>
        <div style={cardHeaderStyle}>
          <p style={cardHeaderTitleStyle}>R7 — Rule Calibration</p>
        </div>
        <div style={{ padding: '14px 18px 18px' }}>
          <p style={sectionNoteStyle}>
            <DueDot tone="warning" /> flag = rule fires on sessions where council helped less than baseline (&gt;10pp gap).
            Review flagged rules quarterly — consider threshold adjustments or prompt tuning.
          </p>
          <div style={{ overflowX: 'auto' }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Rule</th>
                  <th style={thStyleRight}>Fires (90d)</th>
                  <th style={thStyleRight}>w/ Outcome</th>
                  <th style={thStyleRight}>Avg (fired)</th>
                  <th style={thStyleRight}>Avg (not fired)</th>
                  <th style={thStyleRight}>Delta</th>
                  <th style={thStyleRight}>Flag</th>
                </tr>
              </thead>
              <tbody>
                {r7.map(row => (
                  <tr key={row.rule_id} style={trStyle}>
                    <td style={tdStyle}>
                      <span style={{ color: 'var(--text-2)', fontFamily: 'var(--font-mono)', marginRight: 8 }}>{row.rule_id}</span>
                      <span style={{ color: 'var(--text-3)' }}>{row.label}</span>
                    </td>
                    <td style={{ ...tdStyleRight, color: 'var(--text-2)' }}>{row.fires_90d}</td>
                    <td style={{ ...tdStyleRight, color: 'var(--text-4)' }}>{row.outcomes_90d}</td>
                    <td style={{ ...tdStyleRight, color: 'var(--text-2)' }}>{fmtScore(row.avg_fired)}</td>
                    <td style={{ ...tdStyleRight, color: 'var(--text-2)' }}>{fmtScore(row.avg_not_fired)}</td>
                    <td style={{ ...tdStyleRight, color: deltaColor(row.delta, row.flag), fontWeight: row.flag ? 600 : 400 }}>
                      {fmtDelta(row.delta)}
                    </td>
                    <td style={tdStyleRight}>
                      {row.flag ? (
                        <Tooltip
                          side="left" tone="warning"
                          label={`${row.rule_id} — council helped ${fmtDelta(row.delta)} less when this fired vs. when it didn't. Worth reviewing.`}
                        >
                          <DueDot tone="warning" />
                        </Tooltip>
                      ) : <span style={{ color: 'var(--text-4)' }}>—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {r7.every(r => r.outcomes_90d === 0) && (
            <p style={{ ...sectionNoteStyle, marginTop: 12, marginBottom: 0 }}>
              No outcome data yet for this window — ask users to complete the Outcome Tracker after decisions resolve.
            </p>
          )}
        </div>
      </section>

      {/* ── R8: Threshold Sensitivity ─────────────────────────────────────────── */}
      <section style={cardStyle}>
        <div style={cardHeaderStyle}>
          <p style={cardHeaderTitleStyle}>R8 — Threshold Sensitivity</p>
        </div>
        <div style={{ padding: '14px 18px 18px' }}>
          <p style={sectionNoteStyle}>
            🟡 = 100+ sessions (review thresholds). 🟢 = 250+ sessions (recalibrate thresholds against data).
            Counts show how many corpus rows would be included/excluded at each variant.
          </p>
          <div style={{ overflowX: 'auto' }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Constant</th>
                  <th style={thStyleRight}>Current</th>
                  <th style={thStyleRight}>Count (current)</th>
                  <th style={thStyleRight}>−10%</th>
                  <th style={thStyleRight}>+10%</th>
                  <th style={thStyleRight}>Corpus</th>
                  <th style={thStyleRight}>Milestone</th>
                </tr>
              </thead>
              <tbody>
                {r8.map(row => {
                  const atMilestone = row.milestone.startsWith('🟡') || row.milestone.startsWith('🟢')
                  return (
                    <tr key={row.name} style={trStyle}>
                      <td style={{ ...tdStyle, paddingTop: 10, paddingBottom: 10 }}>
                        <div style={{ color: 'var(--text-2)', fontFamily: 'var(--font-mono)' }}>{row.name}</div>
                        <div style={{ color: 'var(--text-4)', fontSize: 10.5, marginTop: 2 }}>{row.description}</div>
                        {row.note && (
                          <div style={{ color: 'var(--gold)', opacity: 0.85, fontSize: 10.5, marginTop: 2, fontStyle: 'italic' }}>{row.note}</div>
                        )}
                        <div style={{ color: 'var(--text-4)', opacity: 0.7, fontSize: 10.5, marginTop: 2 }}>{row.location}</div>
                      </td>
                      <td style={{ ...tdStyleRight, color: 'var(--text-2)' }}>{row.current}</td>
                      <td style={tdStyleRight}>
                        {row.current_count != null ? <span style={{ color: 'var(--text-2)' }}>{row.current_count}</span> : <span style={{ color: 'var(--text-4)' }}>—</span>}
                      </td>
                      <td style={{ ...tdStyleRight, color: 'var(--text-3)' }}>
                        {row.minus_10 != null ? <>{row.minus_10.value} → {row.minus_10.count}</> : <span style={{ color: 'var(--text-4)' }}>—</span>}
                      </td>
                      <td style={{ ...tdStyleRight, color: 'var(--text-3)' }}>
                        {row.plus_10 != null ? <>{row.plus_10.value} → {row.plus_10.count}</> : <span style={{ color: 'var(--text-4)' }}>—</span>}
                      </td>
                      <td style={{ ...tdStyleRight, color: 'var(--text-4)' }}>
                        {row.corpus_total != null ? row.corpus_total : '—'}
                      </td>
                      <td style={tdStyleRight}>
                        {atMilestone ? (
                          <Tooltip
                            side="left"
                            label={row.milestone.startsWith('🟢')
                              ? `${row.corpus_total ?? 'This many'} sessions in corpus — enough data to recalibrate ${row.name} against real numbers instead of the guessed default.`
                              : `${row.corpus_total ?? 'This many'} sessions in corpus — worth a first review of ${row.name} now that some data exists.`}
                          >
                            <span style={{ color: 'var(--text-2)', cursor: 'help' }}>{row.milestone}</span>
                          </Tooltip>
                        ) : (
                          <span style={{ color: 'var(--text-4)' }}>{row.milestone}</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ── R11: Configurable Thresholds + Avoidance Stats ───────────────────── */}
      <section style={cardStyle}>
        <div style={cardHeaderStyle}>
          <p style={cardHeaderTitleStyle}>R11 — Active Thresholds</p>
        </div>
        <div style={{ padding: '14px 18px 18px' }}>
          <p style={sectionNoteStyle}>
            Thresholds configurable via Railway env vars without a deploy. Overridden values shown in gold.
            Recalibrate formally at 100 and 250 session milestones.
          </p>

          {/* Effective threshold values */}
          <div style={{ overflowX: 'auto', marginBottom: 24 }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Variable</th>
                  <th style={thStyleRight}>Default</th>
                  <th style={thStyleRight}>Active</th>
                  <th style={thStyleRight}>Source</th>
                </tr>
              </thead>
              <tbody>
                {r11.effective_thresholds.map(row => (
                  <tr key={row.name} style={trStyle}>
                    <td style={{ ...tdStyle, color: 'var(--text-2)', fontFamily: 'var(--font-mono)' }}>{row.name}</td>
                    <td style={{ ...tdStyleRight, color: 'var(--text-4)' }}>{row.default_value}</td>
                    <td style={{ ...tdStyleRight, fontWeight: 600, color: row.is_overridden ? 'var(--gold)' : 'var(--text-2)' }}>
                      {row.effective_value}
                    </td>
                    <td style={tdStyleRight}>
                      {row.is_overridden ? (
                        <Tooltip side="left" label={`Set via Railway env${row.env_raw ? ` — raw value: ${row.env_raw}` : ''}. Differs from the code default of ${row.default_value}.`}>
                          <span style={{ fontSize: 10.5, color: 'var(--gold)', cursor: 'help' }}>env override</span>
                        </Tooltip>
                      ) : (
                        <span style={{ fontSize: 10.5, color: 'var(--text-4)' }}>default</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Avoidance alerts stats */}
          <p className="t-label" style={{ marginBottom: 10 }}>R11 Avoidance Alert Stats</p>
          <div style={statsGridStyle}>
            {[
              { label: 'Total alerts',       value: r11.avoidance.total },
              { label: 'Open (undismissed)', value: r11.avoidance.open, flagged: r11.avoidance.open > 0 },
              { label: 'Dismissed',          value: r11.avoidance.dismissed },
              { label: 'Avg days open',      value: r11.avoidance.avg_days_open ?? '—' },
            ].map(({ label, value, flagged }) => (
              <div key={label} style={statCardStyle}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ fontSize: 19, fontWeight: 600, color: 'var(--text-1)' }}>{value}</div>
                  {flagged && (
                    <Tooltip label={`Open avoidance alerts — days open ≥ ${r11.avoidance.active_days_threshold} or structural echo ≥ ${r11.avoidance.active_echo_threshold}/100. Worth checking who's stuck.`}>
                      <DueDot tone="warning" />
                    </Tooltip>
                  )}
                </div>
                <div style={{ fontSize: 10.5, color: 'var(--text-4)', marginTop: 3 }}>{label}</div>
              </div>
            ))}
          </div>
          <p style={{ fontSize: 10.5, color: 'var(--text-4)', marginTop: 10, marginBottom: 0 }}>
            Threshold: days open ≥ {r11.avoidance.active_days_threshold} · structural echo min score: {r11.avoidance.active_echo_threshold}/100
          </p>
        </div>
      </section>

      <p style={{ fontSize: 11.5, color: 'var(--text-4)', paddingBottom: 8 }}>
        Quorum Admin · Review cadence: R7 monthly · R8 at 100 and 250 sessions · R11 thresholds tunable anytime via Railway Variables
      </p>
    </div>
  )
}

// ── Shared style tokens ──────────────────────────────────────────────────────

const fullScreenCenterStyle: React.CSSProperties = {
  minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
}

const gateInputStyle: React.CSSProperties = {
  width: '100%', background: 'var(--bg-inset)', border: '1px solid var(--border-dim)',
  color: 'var(--text-1)', padding: '13px 16px', borderRadius: 10, fontSize: 14,
  fontFamily: 'inherit', outline: 'none',
}

const gateButtonStyle: React.CSSProperties = {
  width: '100%', background: 'var(--gold-glow)', border: '1px solid var(--gold-dim)',
  color: 'var(--gold)', fontSize: 13, fontWeight: 600, padding: '11px 0', borderRadius: 10,
  cursor: 'pointer', fontFamily: 'inherit',
}

const refreshButtonStyle: React.CSSProperties = {
  fontSize: 12, color: 'var(--text-3)', background: 'transparent',
  border: '1px solid var(--border-dim)', padding: '7px 14px', borderRadius: 8,
  cursor: 'pointer', fontFamily: 'inherit',
}

const actionBarStyle: React.CSSProperties = {
  background: 'var(--bg-card)', border: '1px solid var(--border-dim)',
  borderRadius: 14, padding: '16px 18px',
}

const actionChipStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12,
  color: 'var(--text-2)', background: 'var(--bg-card-alt)', border: '1px solid var(--border-dim)',
  borderRadius: 20, padding: '6px 13px', cursor: 'help',
}

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-card)', border: '1px solid var(--border-dim)',
  borderRadius: 14, overflow: 'hidden',
}

const cardHeaderStyle: React.CSSProperties = {
  padding: '13px 18px 11px', borderBottom: '1px solid var(--border-dim)',
  background: 'var(--bg-card-alt)', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
}

const cardHeaderTitleStyle: React.CSSProperties = {
  fontSize: 12.5, fontWeight: 600, color: 'var(--text-2)', margin: 0, letterSpacing: '0.02em',
}

const sectionNoteStyle: React.CSSProperties = {
  fontSize: 12, color: 'var(--text-3)', lineHeight: 1.6, marginTop: 0, marginBottom: 14,
  display: 'flex', alignItems: 'flex-start', gap: 6,
}

const tableStyle: React.CSSProperties = {
  width: '100%', fontSize: 12.5, borderCollapse: 'collapse',
}

const thStyle: React.CSSProperties = {
  padding: '8px 14px 8px 0', fontWeight: 500, textAlign: 'left',
  color: 'var(--text-4)', borderBottom: '1px solid var(--border-dim)', fontSize: 11,
}

const thStyleRight: React.CSSProperties = { ...thStyle, textAlign: 'right' }

const trStyle: React.CSSProperties = {
  borderBottom: '1px solid var(--border-dim)',
}

const tdStyle: React.CSSProperties = {
  padding: '9px 14px 9px 0', color: 'var(--text-3)',
}

const tdStyleRight: React.CSSProperties = {
  ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums',
}

const statsGridStyle: React.CSSProperties = {
  display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10,
}

const statCardStyle: React.CSSProperties = {
  background: 'var(--bg-inset)', border: '1px solid var(--border-dim)', borderRadius: 10, padding: '12px 14px',
}

'use client'
// app/admin/page.tsx
// ── Quorum Admin Dashboard ────────────────────────────────────────────────────
//
// Available at /admin — completely hidden from public router.
// Auth: ADMIN_CODE Railway env var. Wrong password → silent redirect to /.
// Correct password stored in sessionStorage for the tab's lifetime.
//
// Two sections:
//   R7 — Rule Calibration: per-rule council_helped correlation (last 90 days)
//   R8 — Threshold Sensitivity: corpus counts at current ± 10% for each constant
//
// No new schema. No new env vars beyond ADMIN_CODE.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useCallback } from 'react'
import { useRouter }                         from 'next/navigation'
import CaseStudyReviewPanel from '@/components/CaseStudyReviewPanel' // Item #11

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
  if (v == null) return 'text-zinc-500'
  if (flag) return 'text-red-400 font-semibold'
  if (v > 0.05) return 'text-emerald-400'
  return 'text-zinc-400'
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function AdminPage() {
  const router = useRouter()

  const [phase,     setPhase]     = useState<'gate' | 'loading' | 'ready' | 'error'>('gate')
  const [codeInput, setCodeInput] = useState('')
  const [data,      setData]      = useState<DashboardData | null>(null)
  const [auditLog,  setAuditLog]  = useState<AuditLogEntry[]>([])
  const [errorMsg,  setErrorMsg]  = useState('')

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

  // ── Password Gate ───────────────────────────────────────────────────────────

  if (phase === 'gate') {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="w-full max-w-sm space-y-4 px-6">
          <p className="text-zinc-500 text-xs tracking-widest uppercase">Quorum</p>
          <input
            type="password"
            value={codeInput}
            onChange={e => setCodeInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleSubmit() }}
            placeholder="Admin code"
            className="w-full bg-zinc-900 border border-zinc-800 text-zinc-100 px-4 py-3 rounded text-sm placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600"
            autoFocus
          />
          <button
            onClick={handleSubmit}
            className="w-full bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-sm py-2.5 rounded transition-colors"
          >
            Enter
          </button>
        </div>
      </div>
    )
  }

  if (phase === 'loading') {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <p className="text-zinc-600 text-sm">Loading…</p>
      </div>
    )
  }

  if (phase === 'error') {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <p className="text-red-400 text-sm">{errorMsg}</p>
      </div>
    )
  }

  if (!data) return null

  const { r7, r8, r11, meta } = data

  const storedCode = sessionStorage.getItem('quorum_admin_code') ?? ''

  // ── Dashboard ───────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-300 px-6 py-10 max-w-6xl mx-auto space-y-12">

      {/* Item #11 — case-study review queue; actionable, time-sensitive,
          so it sits above the R7/R8 analytics rather than below them */}
      <CaseStudyReviewPanel adminCode={storedCode} />

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <p className="text-zinc-600 text-xs tracking-widest uppercase mb-1">Quorum</p>
          <h1 className="text-zinc-100 text-xl font-medium">Admin Dashboard</h1>
          <p className="text-zinc-500 text-xs mt-1">
            Generated {new Date(meta.generated_at).toLocaleString()} · {meta.total_sessions} sessions
            ({meta.sessions_with_outcomes} with outcomes) · Last 90 days
            {meta.global_avg_helped != null && (
              <> · Global avg helpfulness: <span className="text-zinc-400">{fmtScore(meta.global_avg_helped)}</span></>
            )}
          </p>
        </div>
        <button
          onClick={() => void fetchDashboard(storedCode)}
          className="text-xs text-zinc-500 hover:text-zinc-300 border border-zinc-800 hover:border-zinc-700 px-3 py-1.5 rounded transition-colors"
        >
          Refresh
        </button>
      </div>

      {/* ── R7: Rule Calibration ─────────────────────────────────────────────── */}
      {/* ── S6-05: Audit Log ─────────────────────────────────────────────── */}
      <section>
        <h2 className="text-sm font-semibold text-zinc-300 mb-1">Audit Log</h2>
        <p className="text-xs text-zinc-500 mb-3">Last 100 events · most recent first</p>
        {auditLog.length === 0 ? (
          <p className="text-xs text-zinc-600">No audit events yet — run the sprint6_audit_log.sql migration first.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b border-zinc-800">
                  <th className="py-2 pr-4 text-left font-medium text-zinc-400 whitespace-nowrap">Time (UTC)</th>
                  <th className="py-2 pr-4 text-left font-medium text-zinc-400">Actor</th>
                  <th className="py-2 pr-4 text-left font-medium text-zinc-400">Action</th>
                  <th className="py-2 pr-4 text-left font-medium text-zinc-400">IP</th>
                  <th className="py-2 text-left font-medium text-zinc-400">Meta</th>
                </tr>
              </thead>
              <tbody>
                {auditLog.map(entry => (
                  <tr key={entry.id} className="border-b border-zinc-900 hover:bg-zinc-900/30">
                    <td className="py-1.5 pr-4 text-zinc-500 whitespace-nowrap tabular-nums">
                      {new Date(entry.created_at).toISOString().replace('T', ' ').slice(0, 19)}
                    </td>
                    <td className="py-1.5 pr-4 text-zinc-400 max-w-[160px] truncate">
                      {entry.actor_email ?? '—'}
                    </td>
                    <td className="py-1.5 pr-4">
                      <span className={`font-mono ${
                        entry.action.startsWith('admin.auth_fail') || entry.action.startsWith('admin.locked')
                          ? 'text-red-400'
                          : entry.action.startsWith('account.delete')
                          ? 'text-orange-400'
                          : entry.action.startsWith('admin.')
                          ? 'text-amber-400'
                          : 'text-zinc-400'
                      }`}>
                        {entry.action}
                      </span>
                    </td>
                    <td className="py-1.5 pr-4 text-zinc-600 font-mono">
                      {entry.ip_address ?? '—'}
                    </td>
                    <td className="py-1.5 text-zinc-600 font-mono max-w-[200px] truncate">
                      {entry.metadata ? JSON.stringify(entry.metadata) : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="text-zinc-400 text-xs tracking-widest uppercase mb-1">R7 — Rule Calibration</h2>
        <p className="text-zinc-600 text-xs mb-4">
          🔴 flag = rule fires on sessions where council helped less than baseline (&gt;10pp gap).
          Review flagged rules quarterly — consider threshold adjustments or prompt tuning.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-b border-zinc-800 text-zinc-500 text-left">
                <th className="py-2 pr-4 font-normal">Rule</th>
                <th className="py-2 pr-4 font-normal text-right">Fires (90d)</th>
                <th className="py-2 pr-4 font-normal text-right">w/ Outcome</th>
                <th className="py-2 pr-4 font-normal text-right">Avg (fired)</th>
                <th className="py-2 pr-4 font-normal text-right">Avg (not fired)</th>
                <th className="py-2 pr-4 font-normal text-right">Delta</th>
                <th className="py-2 font-normal text-right">Flag</th>
              </tr>
            </thead>
            <tbody>
              {r7.map(row => (
                <tr key={row.rule_id} className="border-b border-zinc-900 hover:bg-zinc-900/40">
                  <td className="py-2 pr-4">
                    <span className="text-zinc-400 font-mono mr-2">{row.rule_id}</span>
                    <span className="text-zinc-500">{row.label}</span>
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">{row.fires_90d}</td>
                  <td className="py-2 pr-4 text-right tabular-nums text-zinc-500">{row.outcomes_90d}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{fmtScore(row.avg_fired)}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{fmtScore(row.avg_not_fired)}</td>
                  <td className={`py-2 pr-4 text-right tabular-nums ${deltaColor(row.delta, row.flag)}`}>
                    {fmtDelta(row.delta)}
                  </td>
                  <td className="py-2 text-right">{row.flag ? '🔴' : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {r7.every(r => r.outcomes_90d === 0) && (
          <p className="text-zinc-600 text-xs mt-3">
            No outcome data yet for this window — ask users to complete the Outcome Tracker after decisions resolve.
          </p>
        )}
      </section>

      {/* ── R8: Threshold Sensitivity ─────────────────────────────────────────── */}
      <section>
        <h2 className="text-zinc-400 text-xs tracking-widest uppercase mb-1">R8 — Threshold Sensitivity</h2>
        <p className="text-zinc-600 text-xs mb-4">
          🟡 = 100+ sessions (review thresholds). 🟢 = 250+ sessions (recalibrate thresholds against data).
          Counts show how many corpus rows would be included/excluded at each variant.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-b border-zinc-800 text-zinc-500 text-left">
                <th className="py-2 pr-4 font-normal">Constant</th>
                <th className="py-2 pr-4 font-normal text-right">Current</th>
                <th className="py-2 pr-4 font-normal text-right">Count (current)</th>
                <th className="py-2 pr-4 font-normal text-right">−10%</th>
                <th className="py-2 pr-4 font-normal text-right">+10%</th>
                <th className="py-2 pr-4 font-normal text-right">Corpus</th>
                <th className="py-2 font-normal text-right">Milestone</th>
              </tr>
            </thead>
            <tbody>
              {r8.map(row => (
                <tr key={row.name} className="border-b border-zinc-900 hover:bg-zinc-900/40">
                  <td className="py-2.5 pr-4">
                    <div className="text-zinc-300 font-mono">{row.name}</div>
                    <div className="text-zinc-600 text-[10px] mt-0.5">{row.description}</div>
                    {row.note && (
                      <div className="text-amber-600/70 text-[10px] mt-0.5 italic">{row.note}</div>
                    )}
                    <div className="text-zinc-700 text-[10px] mt-0.5">{row.location}</div>
                  </td>
                  <td className="py-2.5 pr-4 text-right tabular-nums text-zinc-300">{row.current}</td>
                  <td className="py-2.5 pr-4 text-right tabular-nums">
                    {row.current_count != null ? row.current_count : <span className="text-zinc-700">—</span>}
                  </td>
                  <td className="py-2.5 pr-4 text-right tabular-nums text-zinc-500">
                    {row.minus_10 != null
                      ? <>{row.minus_10.value} → {row.minus_10.count}</>
                      : <span className="text-zinc-700">—</span>}
                  </td>
                  <td className="py-2.5 pr-4 text-right tabular-nums text-zinc-500">
                    {row.plus_10 != null
                      ? <>{row.plus_10.value} → {row.plus_10.count}</>
                      : <span className="text-zinc-700">—</span>}
                  </td>
                  <td className="py-2.5 pr-4 text-right tabular-nums text-zinc-600">
                    {row.corpus_total != null ? row.corpus_total : '—'}
                  </td>
                  <td className="py-2.5 text-right text-zinc-500">{row.milestone}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── R11: Configurable Thresholds + Avoidance Stats ───────────────────── */}
      <section>
        <h2 className="text-zinc-400 text-xs tracking-widest uppercase mb-1">R11 — Active Thresholds</h2>
        <p className="text-zinc-600 text-xs mb-4">
          Thresholds configurable via Railway env vars without a deploy. Overridden values shown in amber.
          Recalibrate formally at 100 and 250 session milestones.
        </p>

        {/* Effective threshold values */}
        <div className="overflow-x-auto mb-6">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-b border-zinc-800 text-zinc-500 text-left">
                <th className="py-2 pr-4 font-normal">Variable</th>
                <th className="py-2 pr-4 font-normal text-right">Default</th>
                <th className="py-2 pr-4 font-normal text-right">Active</th>
                <th className="py-2 font-normal text-right">Source</th>
              </tr>
            </thead>
            <tbody>
              {r11.effective_thresholds.map(row => (
                <tr key={row.name} className="border-b border-zinc-900 hover:bg-zinc-900/40">
                  <td className="py-2 pr-4 font-mono text-zinc-300">{row.name}</td>
                  <td className="py-2 pr-4 text-right tabular-nums text-zinc-500">{row.default_value}</td>
                  <td className={`py-2 pr-4 text-right tabular-nums font-semibold ${row.is_overridden ? 'text-amber-400' : 'text-zinc-300'}`}>
                    {row.effective_value}
                  </td>
                  <td className="py-2 text-right">
                    {row.is_overridden
                      ? <span className="text-amber-500 text-[10px]">env override</span>
                      : <span className="text-zinc-700 text-[10px]">default</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Avoidance alerts stats */}
        <h3 className="text-zinc-500 text-xs tracking-wider uppercase mb-3">R11 Avoidance Alert Stats</h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: 'Total alerts',      value: r11.avoidance.total },
            { label: 'Open (undismissed)', value: r11.avoidance.open },
            { label: 'Dismissed',          value: r11.avoidance.dismissed },
            { label: 'Avg days open',      value: r11.avoidance.avg_days_open ?? '—' },
          ].map(({ label, value }) => (
            <div key={label} className="bg-zinc-900 border border-zinc-800 rounded-lg p-3">
              <div className="text-zinc-300 text-lg font-semibold tabular-nums">{value}</div>
              <div className="text-zinc-600 text-[10px] mt-0.5">{label}</div>
            </div>
          ))}
        </div>
        <p className="text-zinc-700 text-[10px] mt-2">
          Threshold: days open ≥ {r11.avoidance.active_days_threshold} · structural echo min score: {r11.avoidance.active_echo_threshold}/100
        </p>
      </section>

      <p className="text-zinc-700 text-xs pb-6">
        Quorum Admin · Review cadence: R7 monthly · R8 at 100 and 250 sessions · R11 thresholds tunable anytime via Railway Variables
      </p>
    </div>
  )
}

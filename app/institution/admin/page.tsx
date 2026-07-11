'use client'
// app/institution/admin/page.tsx
// Institutional Sprint 3 (task 3) — admin portal skeleton.
//
// Discovers which institution(s) the signed-in user administers by reusing
// the Sprint 2 GET /api/institutions/consent endpoint (it already returns
// role per membership — no separate "my institutions" endpoint needed).
// If they administer more than one, a simple picker switches between them;
// no "active institution" concept exists yet platform-wide (that's Sprint
// 5's mode switcher), so this page owns its own local selection.
//
// The aggregate dashboard panel is a static "coming soon" placeholder with
// no backend call and no fake data, per plan Section 4 task 3, bullet 4 —
// built in Sprint 4/5 once the floor-protected aggregate view exists.

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import { isInstitutionalModeEnabled } from '@/lib/feature-flags'
import { DIM_LABELS, type VectorDimName } from '@/lib/structural-retrieval'   // Institutional Sprint 5 (task 7)

interface AdminMembership {
  institution_id: string
  role: 'admin' | 'member'
  institutions: { name: string } | { name: string }[] | null
}

interface RosterRow {
  userId: string
  email: string | null
  role: 'admin' | 'member'
  joinedAt: string
}

interface CodeStatus {
  adminSeatClaimed: boolean
  allowedEmailDomains: string[]
  children: { id: string; name: string; created_at: string }[]
}

// Institutional Sprint 5 (task 7)
type ConsentRate =
  | { belowFloor: true; memberCount: number; kFloor: number }
  | { belowFloor: false; memberCount: number; aggregateRate: number; cohortRate: number }

interface AggregateSegment {
  dim: string
  high_avg_delta: number | null
  high_n: number | null
  low_avg_delta: number | null
  low_n: number | null
  gap: number | null
  is_signal: boolean | null
}

function institutionName(m: AdminMembership): string {
  const inst = Array.isArray(m.institutions) ? m.institutions[0] : m.institutions
  return inst?.name ?? 'Institution'
}

export default function InstitutionAdminPage() {
  const [authToken, setAuthToken] = useState<string | null>(null)
  const [loading, setLoading]     = useState(true)
  const [adminMemberships, setAdminMemberships] = useState<AdminMembership[]>([])
  const [selectedInstitutionId, setSelectedInstitutionId] = useState<string | null>(null)

  const [roster, setRoster]           = useState<RosterRow[] | null>(null)
  const [codeStatus, setCodeStatus]   = useState<CodeStatus | null>(null)
  const [consentCounts, setConsentCounts] = useState<Record<string, number> | null>(null)
  const [consentRate, setConsentRate] = useState<ConsentRate | null>(null)
  const [aggregateSegments, setAggregateSegments] = useState<AggregateSegment[] | null>(null)
  const [lastIssuedCode, setLastIssuedCode] = useState<string | null>(null)
  const [busy, setBusy]               = useState(false)
  const [notice, setNotice]           = useState<string | null>(null)

  // ── 1. Auth token, then discover which institutions this user administers ──
  useEffect(() => {
    if (!isInstitutionalModeEnabled()) { setLoading(false); return }
    const bootstrap = async () => {
      try {
        const supabase = createClient()
        const { data: { session } } = await supabase.auth.getSession()
        const token = session?.access_token ?? null
        setAuthToken(token)
        if (!token) { setLoading(false); return }

        const res = await fetch('/api/institutions/consent', {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (res.ok) {
          const data = await res.json() as { memberships: AdminMembership[] }
          const admins = data.memberships.filter(m => m.role === 'admin')
          setAdminMemberships(admins)
          if (admins.length) setSelectedInstitutionId(admins[0].institution_id)
        }
      } finally {
        setLoading(false)
      }
    }
    bootstrap()
  }, [])

  // ── 2. Load roster + code status whenever the selected institution changes ──
  const loadInstitutionData = useCallback(async (institutionId: string, token: string) => {
    const headers = { Authorization: `Bearer ${token}` }
    const [rosterRes, codesRes, consentRes, rateRes, dashboardRes] = await Promise.all([
      fetch(`/api/institutions/${institutionId}/admin/roster`, { headers }),
      fetch(`/api/institutions/${institutionId}/admin/codes`, { headers }),
      fetch(`/api/institutions/${institutionId}/consent-changes`, { headers }),
      fetch(`/api/institutions/${institutionId}/admin/consent-rate`, { headers }),
      fetch(`/api/institutions/${institutionId}/admin/aggregate-dashboard`, { headers }),
    ])
    setRoster(rosterRes.ok ? (await rosterRes.json()).roster : null)
    setCodeStatus(codesRes.ok ? await codesRes.json() : null)
    setConsentCounts(consentRes.ok ? (await consentRes.json()).counts : null)
    setConsentRate(rateRes.ok ? await rateRes.json() : null)
    setAggregateSegments(dashboardRes.ok ? (await dashboardRes.json()).segments : null)
  }, [])

  useEffect(() => {
    if (selectedInstitutionId && authToken) {
      setLastIssuedCode(null)
      loadInstitutionData(selectedInstitutionId, authToken)
    }
  }, [selectedInstitutionId, authToken, loadInstitutionData])

  const showNotice = (msg: string) => { setNotice(msg); setTimeout(() => setNotice(null), 4000) }

  const changeRole = async (userId: string, role: 'admin' | 'member') => {
    if (!selectedInstitutionId || !authToken) return
    setBusy(true)
    try {
      const res = await fetch(`/api/institutions/${selectedInstitutionId}/admin/role`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, role }),
      })
      const body = await res.json()
      if (!res.ok) { showNotice(body.error ?? 'Role update failed'); return }
      showNotice(`Updated to ${role}`)
      await loadInstitutionData(selectedInstitutionId, authToken)
    } finally {
      setBusy(false)
    }
  }

  const rotateCode = async () => {
    if (!selectedInstitutionId || !authToken) return
    setBusy(true)
    try {
      const res = await fetch(`/api/institutions/${selectedInstitutionId}/admin/codes`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'rotate' }),
      })
      const body = await res.json()
      if (!res.ok) { showNotice(body.error ?? 'Rotation failed'); return }
      setLastIssuedCode(body.unlockCode)
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <PageShell><p style={{ color: 'var(--text-4)' }}>Loading…</p></PageShell>

  if (!isInstitutionalModeEnabled() || !adminMemberships.length) {
    return (
      <PageShell>
        <p style={{ color: 'var(--text-4)', fontSize: 13 }}>
          You don&apos;t administer any institution.
        </p>
      </PageShell>
    )
  }

  return (
    <PageShell>
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 400, color: 'var(--text-1)', margin: '0 0 6px' }}>
        Institution Admin
      </h1>

      {adminMemberships.length > 1 && (
        <select
          value={selectedInstitutionId ?? ''}
          onChange={e => setSelectedInstitutionId(e.target.value)}
          style={{
            marginBottom: 22, padding: '7px 12px', borderRadius: 8,
            border: '1px solid var(--border-mid)', background: 'var(--bg-card)',
            color: 'var(--text-2)', fontSize: 12.5, fontFamily: 'inherit',
          }}
        >
          {adminMemberships.map(m => (
            <option key={m.institution_id} value={m.institution_id}>{institutionName(m)}</option>
          ))}
        </select>
      )}

      {notice && (
        <p style={{ fontSize: 12, color: 'var(--gold)', margin: '0 0 16px', fontFamily: 'var(--font-mono)' }}>
          {notice}
        </p>
      )}

      {/* ── Roster ──────────────────────────────────────────────────────── */}
      <Panel title="Roster">
        {!roster ? <p style={{ color: 'var(--text-4)', fontSize: 12.5 }}>Loading…</p> : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {roster.map(r => (
              <div key={r.userId} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '9px 0', borderTop: '1px solid var(--border-dim)',
              }}>
                <span style={{ fontSize: 12.5, color: 'var(--text-2)' }}>{r.email ?? r.userId}</span>
                <select
                  value={r.role}
                  disabled={busy}
                  onChange={e => changeRole(r.userId, e.target.value as 'admin' | 'member')}
                  style={{
                    padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border-mid)',
                    background: 'var(--bg-card-alt)', color: 'var(--text-3)', fontSize: 11.5,
                    fontFamily: 'inherit',
                  }}
                >
                  <option value="member">member</option>
                  <option value="admin">admin</option>
                </select>
              </div>
            ))}
            {!roster.length && <p style={{ color: 'var(--text-4)', fontSize: 12.5 }}>No members yet.</p>}
          </div>
        )}
      </Panel>

      {/* ── Code Management ─────────────────────────────────────────────── */}
      <Panel title="Unlock Code">
        {codeStatus && (
          <>
            <p style={{ fontSize: 12.5, color: 'var(--text-3)', margin: '0 0 4px' }}>
              Admin seat: {codeStatus.adminSeatClaimed ? 'claimed' : 'unclaimed — awaiting first redemption'}
            </p>
            {!!codeStatus.allowedEmailDomains.length && (
              <p style={{ fontSize: 11.5, color: 'var(--text-4)', margin: '0 0 12px' }}>
                Restricted to: {codeStatus.allowedEmailDomains.join(', ')}
              </p>
            )}
            <button onClick={rotateCode} disabled={busy} style={buttonStyle}>
              Rotate code
            </button>
            {lastIssuedCode && (
              <p style={{ fontSize: 12.5, color: 'var(--gold)', margin: '12px 0 0', fontFamily: 'var(--font-mono)' }}>
                New code (shown once): {lastIssuedCode}
              </p>
            )}
            {!!codeStatus.children.length && (
              <div style={{ marginTop: 16 }}>
                <p style={{ fontSize: 11.5, color: 'var(--text-4)', margin: '0 0 8px' }}>Sub-institutions</p>
                {codeStatus.children.map(c => (
                  <p key={c.id} style={{ fontSize: 12, color: 'var(--text-3)', margin: '2px 0' }}>{c.name}</p>
                ))}
              </div>
            )}
          </>
        )}
      </Panel>

      {/* ── Consent Activity (Institutional Sprint 2's admin-visibility task,
          wired to a UI home here since Sprint 2 predates this page) ────── */}
      <Panel title="Consent Activity (last 7 days)">
        {!consentCounts ? (
          <p style={{ color: 'var(--text-4)', fontSize: 12.5 }}>Loading…</p>
        ) : Object.keys(consentCounts).length === 0 ? (
          <p style={{ color: 'var(--text-4)', fontSize: 12.5 }}>No consent changes this week.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {Object.entries(consentCounts).map(([field, count]) => (
              <div key={field} style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 12.5, color: 'var(--text-3)' }}>{field}</span>
                <span style={{ fontSize: 12.5, color: 'var(--text-2)', fontFamily: 'var(--font-mono)' }}>{count}</span>
              </div>
            ))}
          </div>
        )}
        <p style={{ fontSize: 11, color: 'var(--text-4)', margin: '10px 0 0' }}>
          Counts only — who changed what is never shown here.
        </p>
      </Panel>

      {/* ── Consent Rate (Task 7) — floor-gated per the answered question:
          no rate shown until total membership itself clears K_FLOOR ────── */}
      <Panel title="Consent Rate">
        {!consentRate ? (
          <p style={{ color: 'var(--text-4)', fontSize: 12.5 }}>Loading…</p>
        ) : consentRate.belowFloor ? (
          <p style={{ fontSize: 12.5, color: 'var(--text-4)' }}>
            Not enough members yet ({consentRate.memberCount} of {consentRate.kFloor} needed) —
            a rate isn&apos;t shown below this size, since it could nearly reveal who specifically opted in.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 12.5, color: 'var(--text-3)' }}>Aggregate benchmarking</span>
              <span style={{ fontSize: 12.5, color: 'var(--text-2)', fontFamily: 'var(--font-mono)' }}>{consentRate.aggregateRate}%</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 12.5, color: 'var(--text-3)' }}>Cohort sharing</span>
              <span style={{ fontSize: 12.5, color: 'var(--text-2)', fontFamily: 'var(--font-mono)' }}>{consentRate.cohortRate}%</span>
            </div>
            <p style={{ fontSize: 11, color: 'var(--text-4)', margin: '4px 0 0' }}>
              Of {consentRate.memberCount} members.
            </p>
          </div>
        )}
      </Panel>

      {/* ── Aggregate Dashboard (Task 7) — real data now, replacing Sprint 3's
          placeholder. Absent dimensions simply haven't cleared K_FLOOR yet —
          not listed as "locked", same absence-is-the-mechanism pattern. ── */}
      <Panel title="Aggregate Dashboard">
        {!aggregateSegments ? (
          <p style={{ color: 'var(--text-4)', fontSize: 12.5 }}>Loading…</p>
        ) : !aggregateSegments.length ? (
          <p style={{ fontSize: 12.5, color: 'var(--text-4)' }}>
            No dimensions have cleared the participation floor yet. This fills in as more
            members opt in and log outcomes — nothing to configure.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {aggregateSegments.map(s => (
              <div key={s.dim} style={{ padding: '8px 0', borderTop: '1px solid var(--border-dim)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                  <span style={{ fontSize: 12.5, color: 'var(--text-2)' }}>{DIM_LABELS[s.dim as VectorDimName] ?? s.dim}</span>
                  {s.is_signal && <span style={{ fontSize: 10, color: 'var(--gold)' }}>signal</span>}
                </div>
                <span style={{ fontSize: 11, color: 'var(--text-4)', fontFamily: 'var(--font-mono)' }}>
                  {s.high_avg_delta != null && `high avg Δ ${s.high_avg_delta} (n=${s.high_n})`}
                  {s.high_avg_delta != null && s.low_avg_delta != null && '  ·  '}
                  {s.low_avg_delta != null && `low avg Δ ${s.low_avg_delta} (n=${s.low_n})`}
                </span>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </PageShell>
  )
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ maxWidth: 640, margin: '0 auto', padding: '40px 20px 80px' }}>
      {children}
    </div>
  )
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{
      background: 'var(--bg-card)', border: '1px solid var(--border-dim)',
      borderRadius: 14, overflow: 'hidden', marginBottom: 16,
    }}>
      <div style={{ padding: '13px 18px 11px', borderBottom: '1px solid var(--border-dim)', background: 'var(--bg-card-alt)' }}>
        <p style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-2)', margin: 0 }}>{title}</p>
      </div>
      <div style={{ padding: '16px 18px 18px' }}>{children}</div>
    </div>
  )
}

const buttonStyle: React.CSSProperties = {
  padding: '8px 18px', borderRadius: 8, border: '1px solid var(--gold-dim)',
  background: 'rgba(201,168,76,0.12)', color: 'var(--gold)', fontSize: 12.5,
  fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
}

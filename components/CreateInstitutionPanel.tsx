'use client'
// components/CreateInstitutionPanel.tsx
// Institutional Sprint 6 — self-contained panel for the founder's admin
// dashboard (app/admin/page.tsx), following the same pattern as
// components/CaseStudyReviewPanel.tsx: receives the already-authenticated
// adminCode as a prop, fetches/posts its own data, doesn't touch the
// existing dashboard fetch/state logic at all.
//
// Lets the founder create institutions (and child institutions, for
// conglomerate partners) directly from the browser, instead of curl —
// calls the same app/api/admin/create-institution route Sprint 1 already
// built, now fixed (Sprint 6) to accept the same ADMIN_CODE this page
// already authenticates with.

import { useState, useEffect, useCallback } from 'react'

interface Institution {
  id: string
  name: string
  parent_institution_id: string | null
  admin_seat_claimed: boolean
  k_floor_override: number | null
  created_at: string
}

export default function CreateInstitutionPanel({ adminCode }: { adminCode: string }) {
  const [institutions, setInstitutions] = useState<Institution[] | null>(null)
  const [error, setError]     = useState('')
  const [busy, setBusy]       = useState(false)
  const [lastCode, setLastCode] = useState<{ name: string; code: string } | null>(null)

  const [name, setName]           = useState('')
  const [parentId, setParentId]   = useState('')
  const [kFloor, setKFloor]       = useState('')
  const [domains, setDomains]     = useState('')

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/create-institution', {
        headers: { Authorization: `Bearer ${adminCode}` },
      })
      if (!res.ok) { setError(`Server error ${res.status}`); return }
      const json = await res.json() as { institutions: Institution[] }
      setInstitutions(json.institutions ?? [])
    } catch {
      setError('Network error loading institutions')
    }
  }, [adminCode])

  useEffect(() => { void load() }, [load])

  const create = async () => {
    if (!name.trim()) return
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/admin/create-institution', {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminCode}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          parentInstitutionId: parentId.trim() || undefined,
          kFloorOverride: kFloor.trim() ? Number(kFloor.trim()) : undefined,
          allowedEmailDomains: domains.trim()
            ? domains.split(',').map(d => d.trim()).filter(Boolean)
            : undefined,
        }),
      })
      const json = await res.json()
      if (!res.ok) { setError(json.error ?? `Server error ${res.status}`); return }

      setLastCode({ name: json.institution.name, code: json.unlockCode })
      setName(''); setParentId(''); setKFloor(''); setDomains('')
      await load()
    } catch {
      setError('Network error creating institution')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section style={{
      background: 'var(--bg-card)', border: '1px solid var(--border-dim)',
      borderRadius: 14, overflow: 'hidden', marginTop: 24,
    }}>
      <div style={{ padding: '13px 18px 11px', borderBottom: '1px solid var(--border-dim)', background: 'var(--bg-card-alt)' }}>
        <p style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-2)', margin: 0 }}>
          Institutions
        </p>
      </div>

      <div style={{ padding: '16px 18px 18px' }}>
        {error && <p style={{ fontSize: 12, color: '#f87171', margin: '0 0 12px' }}>{error}</p>}

        {/* ── Create form ──────────────────────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 18 }}>
          <input
            placeholder="Institution name"
            value={name}
            onChange={e => setName(e.target.value)}
            style={inputStyle}
          />
          <select value={parentId} onChange={e => setParentId(e.target.value)} style={inputStyle}>
            <option value="">No parent (top-level institution)</option>
            {institutions?.filter(i => !i.parent_institution_id).map(i => (
              <option key={i.id} value={i.id}>Child of: {i.name}</option>
            ))}
          </select>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              placeholder="K_FLOOR override (optional, default 20)"
              value={kFloor}
              onChange={e => setKFloor(e.target.value)}
              style={{ ...inputStyle, flex: 1 }}
            />
            <input
              placeholder="Allowed email domains, comma-separated (optional)"
              value={domains}
              onChange={e => setDomains(e.target.value)}
              style={{ ...inputStyle, flex: 2 }}
            />
          </div>
          <button onClick={create} disabled={busy || !name.trim()} style={buttonStyle}>
            {busy ? 'Creating…' : 'Create institution'}
          </button>
        </div>

        {lastCode && (
          <div style={{
            padding: '12px 14px', borderRadius: 10, marginBottom: 18,
            border: '1px solid var(--gold-dim)', background: 'rgba(201,168,76,0.10)',
          }}>
            <p style={{ fontSize: 12, color: 'var(--text-2)', margin: '0 0 4px' }}>
              Created <strong>{lastCode.name}</strong> — unlock code (shown once, deliver out-of-band):
            </p>
            <p style={{ fontSize: 14, color: 'var(--gold)', margin: 0, fontFamily: 'var(--font-mono)' }}>
              {lastCode.code}
            </p>
          </div>
        )}

        {/* ── Existing institutions ───────────────────────────────────────── */}
        {!institutions ? (
          <p style={{ fontSize: 12.5, color: 'var(--text-4)' }}>Loading…</p>
        ) : !institutions.length ? (
          <p style={{ fontSize: 12.5, color: 'var(--text-4)' }}>No institutions yet.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {institutions.map(i => (
              <div key={i.id} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '8px 0', borderTop: '1px solid var(--border-dim)',
              }}>
                <span style={{ fontSize: 12.5, color: 'var(--text-2)' }}>
                  {i.parent_institution_id && '↳ '}{i.name}
                </span>
                <span style={{ fontSize: 10.5, color: 'var(--text-4)', fontFamily: 'var(--font-mono)' }}>
                  {i.admin_seat_claimed ? 'admin claimed' : 'awaiting first redemption'}
                  {i.k_floor_override ? `  ·  K_FLOOR=${i.k_floor_override}` : ''}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

const inputStyle: React.CSSProperties = {
  padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border-mid)',
  background: 'var(--bg-card-alt)', color: 'var(--text-2)', fontSize: 12.5,
  fontFamily: 'inherit', outline: 'none',
}

const buttonStyle: React.CSSProperties = {
  padding: '9px 18px', borderRadius: 8, border: '1px solid var(--gold-dim)',
  background: 'rgba(201,168,76,0.12)', color: 'var(--gold)', fontSize: 12.5,
  fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', alignSelf: 'flex-start',
}

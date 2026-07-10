'use client'
// components/InstitutionConsentSettings.tsx
// Institutional Sprint 2 (task 1) — the two consent toggles from plan
// Section 4: consent_aggregate and consent_shared_cohort, both default-off.
// Turning consent_aggregate ON opens a SEPARATE modal for
// consent_aggregate_backfill ("include your past decisions too?") — the
// plan is explicit these must never be bundled into one toggle.
//
// Renders nothing if the institutional flag is off, or if the signed-in
// user has no institution_memberships rows — no empty "you're not in an
// institution" state, just absent.
//
// Drop this into app/settings/privacy/page.tsx alongside the existing
// Cookie & Storage Preferences card — see the two-line integration note
// that comes with this file.

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import { isInstitutionalModeEnabled } from '@/lib/feature-flags'

interface Membership {
  institution_id: string
  role: 'admin' | 'member'
  consent_aggregate: boolean
  consent_aggregate_backfill: boolean
  consent_shared_cohort: boolean
  institutions: { name: string } | { name: string }[] | null
}

type ToggleField = 'consent_aggregate' | 'consent_aggregate_backfill' | 'consent_shared_cohort'

function institutionName(m: Membership): string {
  const inst = Array.isArray(m.institutions) ? m.institutions[0] : m.institutions
  return inst?.name ?? 'Your institution'
}

async function getAuthToken(): Promise<string | null> {
  const supabase = createClient()
  const { data: { session } } = await supabase.auth.getSession()
  return session?.access_token ?? null
}

export default function InstitutionConsentSettings() {
  const [memberships, setMemberships]       = useState<Membership[] | null>(null)
  const [loading, setLoading]               = useState(true)
  const [pendingBackfillFor, setPendingBackfillFor] = useState<string | null>(null)
  const [savedField, setSavedField]         = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!isInstitutionalModeEnabled()) { setLoading(false); return }
    const token = await getAuthToken()
    if (!token) { setLoading(false); return }
    try {
      const res = await fetch('/api/institutions/consent', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) { setLoading(false); return }
      const data = await res.json() as { memberships: Membership[] }
      setMemberships(data.memberships)
    } catch {
      setMemberships(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const toggleField = async (institutionId: string, field: ToggleField, value: boolean) => {
    const token = await getAuthToken()
    if (!token) return
    // Optimistic update, reverted to server truth on failure
    setMemberships(prev =>
      prev?.map(m => (m.institution_id === institutionId ? { ...m, [field]: value } : m)) ?? prev,
    )
    try {
      const res = await fetch('/api/institutions/consent', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ institutionId, field, value }),
      })
      if (!res.ok) { await load(); return }
      setSavedField(field)
      setTimeout(() => setSavedField(null), 2000)
    } catch {
      await load()
    }
  }

  const handleAggregateToggle = (institutionId: string, value: boolean) => {
    toggleField(institutionId, 'consent_aggregate', value)
    if (value) setPendingBackfillFor(institutionId) // separate modal, never bundled
  }

  if (loading || !memberships?.length) return null

  return (
    <div id="institutional-sharing" style={{ scrollMarginTop: 80 }}>
      {memberships.map(m => (
        <div key={m.institution_id} style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border-dim)',
          borderRadius: 14, overflow: 'hidden', marginBottom: 16,
        }}>
          <div style={{
            padding: '13px 18px 11px',
            borderBottom: '1px solid var(--border-dim)',
            background: 'var(--bg-card-alt)',
          }}>
            <p style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-2)', margin: 0, fontFamily: 'var(--font-body)' }}>
              {institutionName(m)} — Institutional Sharing
            </p>
          </div>
          <div style={{ padding: '18px 18px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <Toggle
              label="Include me in institution benchmarks"
              description="Lets your institution's aggregate benchmarks include your data. Your individual data is never visible to anyone — off by default."
              checked={m.consent_aggregate}
              onChange={v => handleAggregateToggle(m.institution_id, v)}
            />
            <Toggle
              label="Share insights with my cohort"
              description="If you're placed in a cohort, mutually-consenting members can see your session score trend and calibration pattern — never your raw decisions."
              checked={m.consent_shared_cohort}
              onChange={v => toggleField(m.institution_id, 'consent_shared_cohort', v)}
            />
            {savedField && (
              <p style={{ fontSize: 11.5, color: 'var(--gold)', margin: 0, fontFamily: 'var(--font-mono)' }}>
                ✓ Saved
              </p>
            )}
          </div>
        </div>
      ))}

      {/* ── Backfill modal — always separate, never bundled with the main toggle ── */}
      {pendingBackfillFor && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9100,
          background: 'rgba(0,0,0,0.72)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
        }}>
          <div style={{
            width: '100%', maxWidth: 420,
            background: 'var(--bg-card)',
            border: '1px solid var(--border-mid)',
            borderRadius: 16,
            boxShadow: '0 20px 60px rgba(0,0,0,0.55)',
            overflow: 'hidden',
          }}>
            <div style={{
              padding: '18px 22px 14px',
              borderBottom: '1px solid var(--border-dim)',
              background: 'var(--bg-card-alt)',
            }}>
              <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-1)', margin: '0 0 4px' }}>
                Include your past decisions too?
              </p>
              <p style={{ fontSize: 11.5, color: 'var(--text-4)', margin: 0, lineHeight: 1.55 }}>
                You just turned on institution benchmarking for future decisions. Separately: should your
                existing decision history also count toward the benchmark?
              </p>
            </div>
            <div style={{ padding: '16px 22px 18px', display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setPendingBackfillFor(null)}
                style={{
                  padding: '8px 18px', borderRadius: 8, border: '1px solid var(--border-mid)',
                  background: 'none', color: 'var(--text-3)', fontSize: 12.5, fontWeight: 500,
                  cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                No, future decisions only
              </button>
              <button
                onClick={() => {
                  toggleField(pendingBackfillFor, 'consent_aggregate_backfill', true)
                  setPendingBackfillFor(null)
                }}
                style={{
                  padding: '8px 20px', borderRadius: 8, border: '1px solid var(--gold-dim)',
                  background: 'rgba(201,168,76,0.12)', color: 'var(--gold)', fontSize: 12.5,
                  fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                Yes, include past decisions
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Toggle row sub-component ─────────────────────────────────────────────────
// Duplicated locally to match the existing pattern in components/CookieConsent.tsx
// and app/settings/privacy/page.tsx (both define their own copy rather than
// sharing one) — kept self-contained rather than extracted to a shared file.

function Toggle({
  label, description, checked, onChange,
}: {
  label: string
  description: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
      <div style={{ flex: 1 }}>
        <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-2)', margin: '0 0 2px' }}>{label}</p>
        <p style={{ fontSize: 11.5, color: 'var(--text-4)', lineHeight: 1.5, margin: 0 }}>{description}</p>
      </div>
      <button
        onClick={() => onChange(!checked)}
        role="switch" aria-checked={checked} aria-label={label}
        style={{
          flexShrink: 0, width: 38, height: 22, borderRadius: 11,
          background: checked ? 'var(--gold)' : 'var(--border-mid)',
          border: 'none', cursor: 'pointer', position: 'relative',
          transition: 'background 0.22s', marginTop: 2, padding: 0,
        }}
      >
        <span style={{
          position: 'absolute', top: 3, left: checked ? 19 : 3,
          width: 16, height: 16, borderRadius: '50%',
          background: '#fff', transition: 'left 0.22s',
          boxShadow: '0 1px 3px rgba(0,0,0,0.30)', display: 'block',
        }} />
      </button>
    </div>
  )
}

'use client'
// components/InstitutionModeBadge.tsx
// Institutional Sprint 5 (tasks 1+2) — global nav mode badge, multi-
// institution switcher, and the sharing-status pill.
//
// Per the answered question: renders null entirely for a user with zero
// institution_memberships — no "Individual" badge for the ~100% of users
// with no institutional involvement, so nav stays pixel-identical to today
// for them. Only once someone has actually joined an institution does this
// component render anything at all.
//
// Mounted in the root layout (app/layout.tsx) so it CAN appear on every
// route — same "mount globally, render null when irrelevant" pattern as
// CookieConsent/UpdateBanner already use in that file, not a new pattern.

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import { isInstitutionalModeEnabled } from '@/lib/feature-flags'

interface Membership {
  institutionId: string
  name: string
  role: 'admin' | 'member'
}

interface ActiveInstitutionResponse {
  institutionId: string | null
  institutionName: string | null
  memberships: Membership[]
}

interface ConsentMembership {
  institution_id: string
  consent_aggregate: boolean
  consent_shared_cohort: boolean
}

function sharingLabel(m: ConsentMembership | undefined): string {
  if (!m) return 'Off'
  if (m.consent_aggregate && m.consent_shared_cohort) return 'Aggregate + Cohort'
  if (m.consent_aggregate) return 'Aggregate'
  if (m.consent_shared_cohort) return 'Cohort'
  return 'Off'
}

async function getAuthToken(): Promise<string | null> {
  const supabase = createClient()
  const { data: { session } } = await supabase.auth.getSession()
  return session?.access_token ?? null
}

export default function InstitutionModeBadge() {
  const [active, setActive]   = useState<ActiveInstitutionResponse | null>(null)
  const [sharing, setSharing] = useState<string>('Off')
  const [open, setOpen]       = useState(false)
  const [busy, setBusy]       = useState(false)

  const load = useCallback(async () => {
    if (!isInstitutionalModeEnabled()) return
    const token = await getAuthToken()
    if (!token) return

    const headers = { Authorization: `Bearer ${token}` }
    const [activeRes, consentRes] = await Promise.all([
      fetch('/api/institutions/active', { headers }),
      fetch('/api/institutions/consent', { headers }),
    ])

    if (activeRes.ok) {
      const data = await activeRes.json() as ActiveInstitutionResponse
      setActive(data)

      if (data.institutionId && consentRes.ok) {
        const consentData = await consentRes.json() as { memberships: ConsentMembership[] }
        const mine = consentData.memberships.find(m => m.institution_id === data.institutionId)
        setSharing(sharingLabel(mine))
      }
    }
  }, [])

  useEffect(() => { load() }, [load])

  const switchTo = async (institutionId: string) => {
    const token = await getAuthToken()
    if (!token) return
    setBusy(true)
    try {
      const res = await fetch('/api/institutions/active', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ institutionId }),
      })
      if (res.ok) {
        setOpen(false)
        await load()
      }
    } finally {
      setBusy(false)
    }
  }

  // No memberships at all → render nothing, not even an "Individual" badge.
  if (!active?.institutionId || !active.memberships.length) return null

  return (
    <div style={{
      position: 'fixed', top: 14, right: 16, zIndex: 500,
      display: 'inline-flex', alignItems: 'center', gap: 8,
    }}>
      <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        <button
          onClick={() => setOpen(v => !v)}
          disabled={busy}
          style={{
            display: 'flex', alignItems: 'center', gap: 4,
            padding: '5px 12px', borderRadius: 20,
            border: '1px solid var(--border-mid)', background: 'var(--bg-card)',
            color: 'var(--text-2)', fontSize: 11.5, fontFamily: 'var(--font-mono)',
            cursor: 'pointer',
          }}
        >
          {active.institutionName}
          {active.memberships.length > 1 && <span style={{ fontSize: 9 }}>▾</span>}
        </button>

        <span style={{
          padding: '3px 10px', borderRadius: 20,
          border: '1px solid var(--border-dim)', background: 'transparent',
          color: 'var(--text-4)', fontSize: 10.5, fontFamily: 'var(--font-mono)',
        }}>
          Sharing: {sharing}
        </span>

        {open && active.memberships.length > 1 && (
          <div style={{
            position: 'absolute', top: '100%', right: 0, marginTop: 6, zIndex: 501,
            background: 'var(--bg-card)', border: '1px solid var(--border-mid)',
            borderRadius: 10, overflow: 'hidden', minWidth: 180,
            boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
          }}>
            {active.memberships.map(m => (
              <button
                key={m.institutionId}
                onClick={() => switchTo(m.institutionId)}
                disabled={busy || m.institutionId === active.institutionId}
                style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  padding: '9px 14px', border: 'none',
                  background: m.institutionId === active.institutionId ? 'var(--bg-card-alt)' : 'transparent',
                  color: 'var(--text-2)', fontSize: 12, fontFamily: 'inherit', cursor: 'pointer',
                }}
              >
                {m.name}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

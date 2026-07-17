'use client'
// components/InstitutionModeBadge.tsx
// Institutional Sprint 5 (tasks 1+2) — global nav mode strip, multi-
// institution switcher, and the sharing-status detail.
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
//
// Layout fix: this used to be two separate position:fixed pills floating
// over page content (institution switcher + sharing-status link). Nothing
// reserved space for them, so they overlapped whatever a given page rendered
// near the top — and since every page has a different top structure (Home's
// header row, Mirror's own sticky nav, Record's page title), a single global
// buffer to clear them was fragile and kept needing retuning per page as new
// layouts shipped. Rewritten as one collapsed, fully opaque, in-flow strip
// that reserves its own real document height — nothing can overlap it
// because it isn't floating anymore. Tapping it expands a drawer that pushes
// the rest of the page down, never overlays it.

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
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
    <div className="institution-mode-strip" style={{
      background:   'var(--bg-card)',   // fully opaque — no transparency anywhere in the strip
      borderBottom: '1px solid var(--border-dim)',
    }}>
      <button
        onClick={() => setOpen(v => !v)}
        disabled={busy}
        style={{
          display:       'flex',
          alignItems:    'center',
          justifyContent: 'center',
          gap:           6,
          width:         '100%',
          padding:       '7px 16px',
          border:        'none',
          background:    'transparent',   // transparent to the strip's own opaque background, not to page content
          color:         'var(--text-3)',
          fontSize:      11.5,
          fontFamily:    'var(--font-mono)',
          cursor:        'pointer',
        }}
      >
        <span style={{ color: 'var(--text-2)' }}>{active.institutionName}</span>
        <span style={{ opacity: 0.5 }}>·</span>
        <span>Sharing: {sharing}</span>
        <span style={{ fontSize: 9, opacity: 0.6, marginLeft: 2, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>▾</span>
      </button>

      {/* Drawer — pushes the rest of the page down when open, never overlays it */}
      {open && (
        <div style={{
          borderTop:  '1px solid var(--border-dim)',
          background: 'var(--bg-card-alt)',
          padding:    '12px 16px 14px',
        }}>
          {active.memberships.length > 1 && (
            <>
              <p style={{
                fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700,
                letterSpacing: '0.08em', textTransform: 'uppercase',
                color: 'var(--text-4)', margin: '0 0 8px',
              }}>
                Switch institution
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 14 }}>
                {active.memberships.map(m => (
                  <button
                    key={m.institutionId}
                    onClick={() => switchTo(m.institutionId)}
                    disabled={busy || m.institutionId === active.institutionId}
                    style={{
                      display: 'block', width: '100%', textAlign: 'left',
                      padding: '8px 10px', borderRadius: 8, border: 'none',
                      background: m.institutionId === active.institutionId ? 'var(--bg-card)' : 'transparent',
                      color: 'var(--text-2)', fontSize: 12.5, fontFamily: 'inherit', cursor: 'pointer',
                    }}
                  >
                    {m.name}
                  </button>
                ))}
              </div>
            </>
          )}
          <Link
            href="/settings/privacy#institutional-sharing"
            onClick={() => setOpen(false)}
            style={{
              display:       'inline-block',
              fontFamily:    'var(--font-mono)',
              fontSize:      11.5,
              color:         'var(--gold)',
              textDecoration: 'none',
            }}
          >
            Change sharing settings →
          </Link>
        </div>
      )}
    </div>
  )
}

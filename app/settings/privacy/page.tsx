'use client'
// app/settings/privacy/page.tsx
// ── Sprint 3 (S3-05) — Privacy Center ────────────────────────────────────────
// Consent management, data export stub, account deletion stub.
// Client component — reads/writes quorum_cookie_consent from localStorage.
// Data export and deletion are stubs here; S6-02 / S6-03 wire up the real endpoints.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import InstitutionConsentSettings from '@/components/InstitutionConsentSettings' // Institutional Sprint 2

const CONSENT_KEY = 'quorum_cookie_consent'

interface ConsentState {
  necessary: true
  functional: boolean
  analytics: boolean
  ts: number
}

function readConsent(): ConsentState | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(CONSENT_KEY)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

function writeConsent(s: ConsentState) {
  try { localStorage.setItem(CONSENT_KEY, JSON.stringify(s)) } catch {}
}

export default function PrivacyCenterPage() {
  const router = useRouter()

  // ── Consent state ──────────────────────────────────────────────────────────
  const [functional, setFunctional]   = useState(true)
  const [analytics,  setAnalytics]    = useState(false)
  const [consentSaved, setConsentSaved] = useState(false)
  const [consentLoaded, setConsentLoaded] = useState(false)

  // ── Modal state ────────────────────────────────────────────────────────────
  const [showExportNote, setShowExportNote]   = useState(false)
  const [exportLoading, setExportLoading]     = useState(false)
  const [exportError,   setExportError]       = useState<string | null>(null)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [deleteConfirm, setDeleteConfirm]     = useState('')
  const [deleteSubmitted, setDeleteSubmitted] = useState(false)
  const [deleteLoading,   setDeleteLoading]   = useState(false)
  const [deleteError,     setDeleteError]     = useState<string | null>(null)

  useEffect(() => {
    const consent = readConsent()
    if (consent) {
      setFunctional(consent.functional)
      setAnalytics(consent.analytics)
    }
    setConsentLoaded(true)
  }, [])

  const saveConsent = () => {
    writeConsent({ necessary: true, functional, analytics, ts: Date.now() })
    setConsentSaved(true)
    setTimeout(() => setConsentSaved(false), 2400)
  }

  // S6-02: Real data export
  const handleExport = async () => {
    setExportLoading(true)
    setExportError(null)
    try {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) {
        setExportError('Please sign in first to export your data.')
        return
      }
      const res = await fetch('/api/account/export', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (res.status === 401) { setExportError('Please sign in to export your data.'); return }
      if (res.status === 429) {
        const data = await res.json() as { message?: string }
        setExportError(data.message ?? 'Export limit reached. Try again in 24 hours.')
        return
      }
      if (!res.ok) { setExportError('Export failed. Please try again.'); return }

      // Trigger download
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      const date = new Date().toISOString().split('T')[0]
      a.href = url
      a.download = `quorum-data-export-${date}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      setShowExportNote(false)
    } catch {
      setExportError('Export failed. Please try again.')
    } finally {
      setExportLoading(false)
    }
  }

  // S6-03: Real account deletion
  const handleDeleteRequest = async () => {
    setDeleteLoading(true)
    setDeleteError(null)
    try {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) {
        setDeleteError('Please sign in first.')
        setDeleteLoading(false)
        return
      }
      const res = await fetch('/api/account', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (!res.ok) {
        const data = await res.json() as { error?: string }
        setDeleteError(data.error ?? 'Deletion failed. Please try again.')
        setDeleteLoading(false)
        return
      }
      // Success — sign out and redirect to home
      await supabase.auth.signOut()
      setDeleteSubmitted(true)
      setShowDeleteModal(false)
      setDeleteConfirm('')
      setTimeout(() => router.push('/'), 1500)
    } catch {
      setDeleteError('Deletion failed. Please try again.')
      setDeleteLoading(false)
    }
  }

  return (
    <main style={{
      minHeight: '100vh',
      background: 'var(--bg-void)',
      padding: '48px 20px 96px',
    }}>
      <div style={{ maxWidth: 640, margin: '0 auto' }}>

        {/* Back */}
        <Link href="/" style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          fontSize: 11, color: 'var(--text-4)',
          fontFamily: 'var(--font-mono)', letterSpacing: '0.08em',
          textDecoration: 'none', marginBottom: 32,
        }}>
          ← Back to Quorum
        </Link>

        {/* Page title */}
        <div style={{ marginBottom: 28 }}>
          <p style={{
            fontFamily: 'var(--font-mono)', fontSize: 10,
            letterSpacing: '0.18em', textTransform: 'uppercase',
            color: 'var(--text-4)', margin: '0 0 10px',
          }}>
            Settings
          </p>
          <h1 style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'clamp(24px, 3.5vw, 34px)',
            fontWeight: 400, letterSpacing: '-0.02em',
            color: 'var(--text-1)', margin: 0, lineHeight: 1.2,
          }}>
            Privacy Center
          </h1>
        </div>

        {/* Settings tab nav */}
        <SettingsNav active="privacy" />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 24 }}>

          {/* ── Consent Preferences ─────────────────────────────────────────── */}
          <SettingsCard title="Cookie & Storage Preferences">
            {!consentLoaded ? (
              <p style={{ fontSize: 13, color: 'var(--text-4)', fontFamily: 'var(--font-mono)' }}>
                Loading…
              </p>
            ) : (
              <>
                <p style={{ fontSize: 13, color: 'var(--text-3)', lineHeight: 1.65, marginBottom: 20, margin: '0 0 20px' }}>
                  Control what Quorum stores on this device. Changes apply to this browser only.
                </p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {/* Strictly Necessary — locked */}
                  <Toggle
                    label="Strictly Necessary"
                    description="Theme preference and this consent record. Always on."
                    checked={true}
                    locked
                  />
                  {/* Functional */}
                  <Toggle
                    label="Functional"
                    description="Device ID and session history — allows your recent decisions to appear on the home screen across visits."
                    checked={functional}
                    onChange={setFunctional}
                  />
                  {/* Analytics */}
                  <Toggle
                    label="Analytics"
                    description="Aggregate usage signals to improve the product. No third-party ad networks. Currently off by default."
                    checked={analytics}
                    onChange={setAnalytics}
                  />
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 20 }}>
                  <button
                    onClick={saveConsent}
                    style={{
                      padding: '9px 20px', borderRadius: 8,
                      border: '1px solid var(--gold-dim)',
                      background: 'rgba(201,168,76,0.10)', color: 'var(--gold)',
                      fontSize: 13, fontWeight: 600, cursor: 'pointer',
                      fontFamily: 'inherit', transition: 'opacity 0.15s',
                    }}
                  >
                    Save preferences
                  </button>
                  {consentSaved && (
                    <span style={{
                      fontSize: 11.5, color: 'var(--green-text)',
                      fontFamily: 'var(--font-mono)', letterSpacing: '0.04em',
                    }}>
                      ✓ Saved
                    </span>
                  )}
                </div>

                <p style={{ marginTop: 12, fontSize: 11.5, color: 'var(--text-4)', fontFamily: 'var(--font-mono)' }}>
                  Last updated:{' '}
                  {readConsent()?.ts
                    ? new Date(readConsent()!.ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
                    : 'Not yet set'}
                </p>
              </>
            )}
          </SettingsCard>

          {/* ── Institutional Sharing (Institutional Sprint 2) ─────────────────
              Renders nothing if the flag is off or the user has no
              institution memberships — self-contained, no props needed. */}
          <InstitutionConsentSettings />

          {/* ── Data Rights ─────────────────────────────────────────────────── */}
          <SettingsCard title="Your Data Rights">
            <p style={{ fontSize: 13, color: 'var(--text-3)', lineHeight: 1.65, margin: '0 0 20px' }}>
              Under GDPR and DPDP, you have the right to access, export, correct, and erase your data.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

              {/* Export */}
              <div style={{
                background: 'var(--bg-card-alt)',
                border: '1px solid var(--border-dim)',
                borderRadius: 10, padding: '14px 16px',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 180 }}>
                    <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-1)', margin: '0 0 3px' }}>
                      Export my data
                    </p>
                    <p style={{ fontSize: 12.5, color: 'var(--text-4)', margin: 0, lineHeight: 1.55 }}>
                      Download all your decisions, analyses, and profile data as JSON.
                    </p>
                  </div>
                  <button
                    onClick={handleExport}
                    disabled={exportLoading}
                    style={{
                      padding: '8px 16px', borderRadius: 7, flexShrink: 0,
                      border: '1px solid var(--border-mid)',
                      background: 'none', color: 'var(--text-3)',
                      fontSize: 12.5, fontWeight: 500, cursor: 'pointer',
                      fontFamily: 'inherit', whiteSpace: 'nowrap',
                    }}
                  >
                    {exportLoading ? 'Exporting…' : 'Export my data'}
                  </button>
                </div>
                {exportLoading && (
                  <p style={{ marginTop: 8, fontSize: 12, color: 'var(--text-4)', fontFamily: 'var(--font-mono)' }}>
                    Preparing your export…
                  </p>
                )}
                {exportError && (
                  <p style={{ marginTop: 8, fontSize: 12.5, color: '#e05050', lineHeight: 1.6 }}>
                    {exportError}
                  </p>
                )}
              </div>

              {/* Delete */}
              <div style={{
                background: 'var(--bg-card-alt)',
                border: '1px solid var(--border-dim)',
                borderRadius: 10, padding: '14px 16px',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 180 }}>
                    <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-1)', margin: '0 0 3px' }}>
                      Delete my account
                    </p>
                    <p style={{ fontSize: 12.5, color: 'var(--text-4)', margin: 0, lineHeight: 1.55 }}>
                      Permanently erase all decisions, analyses, and your profile. This cannot be undone.
                    </p>
                  </div>
                  <button
                    onClick={() => setShowDeleteModal(true)}
                    disabled={deleteSubmitted}
                    style={{
                      padding: '8px 16px', borderRadius: 7, flexShrink: 0,
                      border: '1px solid rgba(224,80,80,0.35)',
                      background: 'rgba(224,80,80,0.07)', color: deleteSubmitted ? 'var(--text-4)' : '#e05050',
                      fontSize: 12.5, fontWeight: 500, cursor: deleteSubmitted ? 'not-allowed' : 'pointer',
                      fontFamily: 'inherit', whiteSpace: 'nowrap',
                      opacity: deleteSubmitted ? 0.6 : 1,
                    }}
                  >
                    {deleteSubmitted ? 'Request received' : 'Delete account'}
                  </button>
                </div>
                {deleteSubmitted && (
                  <p style={{
                    marginTop: 10, fontSize: 12.5, color: 'var(--text-4)', lineHeight: 1.6,
                    fontFamily: 'var(--font-mono)',
                  }}>
                    Your deletion request has been received and will be processed within 30 days.
                    Automated deletion is coming soon and will be immediate once available.
                  </p>
                )}
              </div>

            </div>
          </SettingsCard>

          {/* ── Legal links ──────────────────────────────────────────────────── */}
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', paddingTop: 4 }}>
            {[
              { href: '/privacy', label: 'Privacy Policy' },
              { href: '/cookies', label: 'Cookie Policy' },
              { href: '/terms',   label: 'Terms of Service' },
            ].map(l => (
              <Link key={l.href} href={l.href} style={{
                fontSize: 12, color: 'var(--text-4)', textDecoration: 'none',
                fontFamily: 'var(--font-mono)', letterSpacing: '0.04em',
                borderBottom: '1px solid var(--border-dim)', paddingBottom: 1,
                transition: 'color 0.15s',
              }}>
                {l.label}
              </Link>
            ))}
          </div>

        </div>
      </div>

      {/* ── Delete confirmation modal ────────────────────────────────────────── */}
      {showDeleteModal && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9100,
          background: 'rgba(0,0,0,0.72)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
        }}>
          <div style={{
            width: '100%', maxWidth: 400,
            background: 'var(--bg-card)',
            border: '1px solid rgba(224,80,80,0.3)',
            borderRadius: 16,
            boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
            overflow: 'hidden',
          }}>
            <div style={{
              padding: '18px 22px 14px',
              borderBottom: '1px solid var(--border-dim)',
              background: 'var(--bg-card-alt)',
            }}>
              <p style={{ fontSize: 14, fontWeight: 600, color: '#e05050', margin: '0 0 4px' }}>
                Delete account
              </p>
              <p style={{ fontSize: 12, color: 'var(--text-4)', margin: 0, lineHeight: 1.55 }}>
                This will permanently erase all your decisions, analyses, bias profile, and account data.
                This action cannot be undone.
              </p>
            </div>
            <div style={{ padding: '16px 22px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <label style={{ fontSize: 12.5, color: 'var(--text-3)', fontFamily: 'var(--font-body)' }}>
                Type <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-1)' }}>delete my account</code> to confirm:
              </label>
              <input
                type="text"
                value={deleteConfirm}
                onChange={e => setDeleteConfirm(e.target.value)}
                placeholder="delete my account"
                style={{
                  background: 'var(--bg-inset)', border: '1px solid var(--border-mid)',
                  borderRadius: 8, padding: '9px 12px', color: 'var(--text-1)',
                  fontSize: 13, fontFamily: 'var(--font-mono)', outline: 'none', width: '100%',
                }}
              />
              {deleteError && (
                <p style={{ fontSize: 12.5, color: '#e05050', margin: '0 0 4px' }}>{deleteError}</p>
              )}
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 4 }}>
                <button
                  onClick={() => { setShowDeleteModal(false); setDeleteConfirm('') }}
                  style={{
                    padding: '8px 18px', borderRadius: 8,
                    border: '1px solid var(--border-mid)',
                    background: 'none', color: 'var(--text-3)',
                    fontSize: 12.5, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleDeleteRequest}
                  disabled={deleteConfirm.trim().toLowerCase() !== 'delete my account' || deleteLoading}
                  style={{
                    padding: '8px 18px', borderRadius: 8,
                    border: '1px solid rgba(224,80,80,0.4)',
                    background: 'rgba(224,80,80,0.12)', color: '#e05050',
                    fontSize: 12.5, fontWeight: 600, cursor: deleteConfirm.trim().toLowerCase() !== 'delete my account' ? 'not-allowed' : 'pointer',
                    fontFamily: 'inherit',
                    opacity: deleteConfirm.trim().toLowerCase() !== 'delete my account' ? 0.4 : 1,
                  }}
                >
                  {deleteLoading ? 'Deleting…' : 'Delete permanently'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}

// ── Sub-components ───────────────────────────────────────────────────────────

function SettingsNav({ active }: { active: 'privacy' | 'security' }) {
  return (
    <div style={{
      display: 'flex', gap: 4,
      background: 'var(--bg-card)',
      border: '1px solid var(--border-dim)',
      borderRadius: 10, padding: 4,
    }}>
      {([
        { href: '/settings/privacy',  label: 'Privacy Center',  key: 'privacy'  },
        { href: '/settings/security', label: 'Security Center', key: 'security' },
      ] as const).map(tab => (
        <Link
          key={tab.key}
          href={tab.href}
          style={{
            flex: 1, textAlign: 'center',
            padding: '8px 16px', borderRadius: 7,
            fontSize: 12.5, fontWeight: active === tab.key ? 600 : 400,
            color: active === tab.key ? 'var(--text-1)' : 'var(--text-4)',
            background: active === tab.key ? 'var(--bg-card-alt)' : 'none',
            border: active === tab.key ? '1px solid var(--border-mid)' : '1px solid transparent',
            textDecoration: 'none', transition: 'all 0.15s',
            fontFamily: 'var(--font-body)',
          }}
        >
          {tab.label}
        </Link>
      ))}
    </div>
  )
}

function SettingsCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{
      background: 'var(--bg-card)',
      border: '1px solid var(--border-dim)',
      borderRadius: 14, overflow: 'hidden',
    }}>
      <div style={{
        padding: '13px 18px 11px',
        borderBottom: '1px solid var(--border-dim)',
        background: 'var(--bg-card-alt)',
      }}>
        <p style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-2)', margin: 0, fontFamily: 'var(--font-body)' }}>
          {title}
        </p>
      </div>
      <div style={{ padding: '18px 18px 20px' }}>
        {children}
      </div>
    </div>
  )
}

function Toggle({
  label, description, checked, onChange, locked,
}: {
  label: string; description: string; checked: boolean
  onChange?: (v: boolean) => void; locked?: boolean
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
      <div style={{ flex: 1 }}>
        <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-2)', margin: '0 0 2px' }}>{label}</p>
        <p style={{ fontSize: 12, color: 'var(--text-4)', lineHeight: 1.5, margin: 0 }}>{description}</p>
      </div>
      <button
        onClick={() => !locked && onChange?.(!checked)}
        role="switch" aria-checked={checked} aria-label={label}
        style={{
          flexShrink: 0, width: 38, height: 22, borderRadius: 11,
          background: checked ? 'var(--gold)' : 'var(--border-mid)',
          border: 'none', cursor: locked ? 'not-allowed' : 'pointer',
          position: 'relative', transition: 'background 0.22s',
          opacity: locked ? 0.5 : 1, marginTop: 2, padding: 0,
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

'use client'
// app/settings/security/page.tsx
// ── Sprint 3 (S3-06) — Security Center ───────────────────────────────────────
// Current session info, sign-out controls.
// Client component — uses Supabase auth.getSession() (same pattern as Mirror).
// Full login history deferred to S6 (requires audit_log table).
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'

interface SessionInfo {
  email: string | null
  lastSignIn: string | null
  userId: string | null
}

export default function SecurityCenterPage() {
  const router = useRouter()

  const [sessionInfo, setSessionInfo] = useState<SessionInfo | null>(null)
  const [loading, setLoading]         = useState(true)

  const [signingOut,    setSigningOut]    = useState(false)
  const [signOutAll,    setSignOutAll]    = useState(false)
  const [signOutDone,   setSignOutDone]   = useState<'device' | 'all' | null>(null)
  const [signOutError,  setSignOutError]  = useState<string | null>(null)

  // ── 1. Load session info ───────────────────────────────────────────────────
  useEffect(() => {
    const load = async () => {
      try {
        const supabase = createClient()
        const { data: { session } } = await supabase.auth.getSession()
        if (session?.user) {
          setSessionInfo({
            email:      session.user.email ?? null,
            lastSignIn: session.user.last_sign_in_at ?? null,
            userId:     session.user.id ?? null,
          })
        } else {
          setSessionInfo({ email: null, lastSignIn: null, userId: null })
        }
      } catch {
        setSessionInfo({ email: null, lastSignIn: null, userId: null })
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  // ── 2. Sign out this device ────────────────────────────────────────────────
  const handleSignOutDevice = async () => {
    setSigningOut(true)
    setSignOutError(null)
    try {
      const supabase = createClient()
      const { error } = await supabase.auth.signOut()
      if (error) throw error
      setSignOutDone('device')
      setTimeout(() => router.push('/'), 1800)
    } catch (e: unknown) {
      setSignOutError(e instanceof Error ? e.message : 'Sign out failed')
    } finally {
      setSigningOut(false)
    }
  }

  // ── 3. Sign out all devices ────────────────────────────────────────────────
  const handleSignOutAll = async () => {
    setSignOutAll(true)
    setSignOutError(null)
    try {
      const supabase = createClient()
      // scope: 'global' invalidates all refresh tokens for this user
      const { error } = await supabase.auth.signOut({ scope: 'global' })
      if (error) throw error
      setSignOutDone('all')
      setTimeout(() => router.push('/'), 1800)
    } catch (e: unknown) {
      setSignOutError(e instanceof Error ? e.message : 'Sign out failed')
    } finally {
      setSignOutAll(false)
    }
  }

  const isSignedIn = !loading && !!sessionInfo?.email

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
            Security Center
          </h1>
        </div>

        {/* Tab nav */}
        <SettingsNav active="security" />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 24 }}>

          {/* ── Account ─────────────────────────────────────────────────────── */}
          <SettingsCard title="Account">
            {loading ? (
              <p style={{ fontSize: 13, color: 'var(--text-4)', fontFamily: 'var(--font-mono)' }}>Loading…</p>
            ) : !isSignedIn ? (
              <div>
                <p style={{ fontSize: 13, color: 'var(--text-3)', lineHeight: 1.65, margin: '0 0 14px' }}>
                  You are not currently signed in. Sign in to see your account details and manage sessions.
                </p>
                <Link href="/" style={{
                  display: 'inline-block',
                  padding: '8px 18px', borderRadius: 8,
                  border: '1px solid var(--gold-dim)',
                  background: 'rgba(201,168,76,0.10)', color: 'var(--gold)',
                  fontSize: 13, fontWeight: 600,
                  textDecoration: 'none', fontFamily: 'var(--font-body)',
                }}>
                  Sign in
                </Link>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <InfoRow label="Email" value={sessionInfo!.email ?? '—'} />
                <InfoRow label="Authentication" value="Passwordless magic link" />
                <InfoRow
                  label="Last sign-in"
                  value={
                    sessionInfo!.lastSignIn
                      ? new Date(sessionInfo!.lastSignIn).toLocaleString('en-GB', {
                          day: 'numeric', month: 'short', year: 'numeric',
                          hour: '2-digit', minute: '2-digit',
                        })
                      : '—'
                  }
                />
              </div>
            )}
          </SettingsCard>

          {/* ── Session management ─────────────────────────────────────────── */}
          {isSignedIn && (
            <SettingsCard title="Session Management">
              <p style={{ fontSize: 13, color: 'var(--text-3)', lineHeight: 1.65, margin: '0 0 18px' }}>
                Magic links are the only authentication method — no passwords are stored.
                If you believe your account may be compromised, sign out of all devices immediately.
              </p>

              {signOutDone && (
                <div style={{
                  marginBottom: 16, padding: '10px 14px', borderRadius: 8,
                  background: 'var(--success-bg)', border: '1px solid var(--success-border)',
                }}>
                  <p style={{ margin: 0, fontSize: 13, color: 'var(--success-text)' }}>
                    {signOutDone === 'all'
                      ? '✓ Signed out of all devices. Redirecting…'
                      : '✓ Signed out of this device. Redirecting…'
                    }
                  </p>
                </div>
              )}

              {signOutError && (
                <div style={{
                  marginBottom: 16, padding: '10px 14px', borderRadius: 8,
                  background: 'rgba(224,80,80,0.08)', border: '1px solid rgba(224,80,80,0.25)',
                }}>
                  <p style={{ margin: 0, fontSize: 13, color: 'var(--error)' }}>{signOutError}</p>
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

                {/* Sign out this device */}
                <ActionRow
                  label="Sign out of this device"
                  description="Ends your current session on this browser. Other sessions remain active."
                  buttonLabel={signingOut ? 'Signing out…' : 'Sign out'}
                  onAction={handleSignOutDevice}
                  disabled={signingOut || signOutAll || !!signOutDone}
                />

                {/* Sign out all devices */}
                <ActionRow
                  label="Sign out of all devices"
                  description="Invalidates all active sessions across every device and browser. You will need a new magic link to sign in again."
                  buttonLabel={signOutAll ? 'Signing out…' : 'Sign out everywhere'}
                  onAction={handleSignOutAll}
                  disabled={signOutAll || signingOut || !!signOutDone}
                  danger
                />

              </div>

              <p style={{
                marginTop: 14, fontSize: 11.5, color: 'var(--text-4)',
                fontFamily: 'var(--font-mono)', letterSpacing: '0.03em', lineHeight: 1.55,
              }}>
                Full session history will be available in a future update.
                To sign in again after signing out, visit Quorum and enter your email.
              </p>
            </SettingsCard>
          )}

          {/* ── Security measures ─────────────────────────────────────────── */}
          <SettingsCard title="How Quorum Protects Your Data">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[
                { icon: '🔒', text: 'Decision text encrypted at rest (AES-256-GCM)' },
                { icon: '🔗', text: 'All data transmitted over HTTPS / TLS' },
                { icon: '✉️', text: 'Passwordless authentication — no passwords stored' },
                { icon: '🛡️', text: 'Row-level security on all database tables' },
                { icon: '🚫', text: 'No advertising, no data selling' },
              ].map((item, i) => (
                <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <span style={{ fontSize: 14, flexShrink: 0, marginTop: 1 }}>{item.icon}</span>
                  <span style={{ fontSize: 13, color: 'var(--text-3)', lineHeight: 1.6 }}>{item.text}</span>
                </div>
              ))}
            </div>
            <p style={{ marginTop: 14, fontSize: 12, color: 'var(--text-4)', lineHeight: 1.55 }}>
              For a complete and honest account of what is and is not implemented,
              see the{' '}
              <Link href="/security" style={{ color: 'var(--gold)', textDecoration: 'none' }}>
                Security &amp; Trust
              </Link>
              {' '}page.
            </p>
          </SettingsCard>

        </div>
      </div>
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

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '130px 1fr', gap: 0,
      background: 'var(--bg-card-alt)', border: '1px solid var(--border-dim)',
      borderRadius: 8, overflow: 'hidden',
    }}>
      <div style={{
        padding: '9px 12px',
        fontSize: 11.5, fontWeight: 600, color: 'var(--text-3)',
        fontFamily: 'var(--font-body)',
        borderRight: '1px solid var(--border-dim)',
      }}>
        {label}
      </div>
      <div style={{
        padding: '9px 12px',
        fontSize: 12.5, color: 'var(--text-2)',
        fontFamily: 'var(--font-mono)', letterSpacing: '0.02em',
      }}>
        {value}
      </div>
    </div>
  )
}

function ActionRow({
  label, description, buttonLabel, onAction, disabled, danger,
}: {
  label: string; description: string; buttonLabel: string
  onAction: () => void; disabled?: boolean; danger?: boolean
}) {
  return (
    <div style={{
      background: 'var(--bg-card-alt)', border: '1px solid var(--border-dim)',
      borderRadius: 10, padding: '13px 16px',
      display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
      gap: 14, flexWrap: 'wrap',
    }}>
      <div style={{ flex: 1, minWidth: 160 }}>
        <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-1)', margin: '0 0 3px' }}>{label}</p>
        <p style={{ fontSize: 12, color: 'var(--text-4)', margin: 0, lineHeight: 1.55 }}>{description}</p>
      </div>
      <button
        onClick={onAction}
        disabled={disabled}
        style={{
          flexShrink: 0, padding: '7px 16px', borderRadius: 7,
          border: danger ? '1px solid rgba(224,80,80,0.35)' : '1px solid var(--border-mid)',
          background: danger ? 'rgba(224,80,80,0.07)' : 'none',
          color: danger ? '#e05050' : 'var(--text-3)',
          fontSize: 12.5, fontWeight: 500, cursor: disabled ? 'not-allowed' : 'pointer',
          fontFamily: 'inherit', whiteSpace: 'nowrap', opacity: disabled ? 0.5 : 1,
          transition: 'opacity 0.15s',
        }}
      >
        {buttonLabel}
      </button>
    </div>
  )
}

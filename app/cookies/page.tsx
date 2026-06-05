// app/cookies/page.tsx
// ── Sprint 3 (S3-03) — Cookie Policy ─────────────────────────────────────────
// Every localStorage key listed by name, purpose, category, and duration.
// Server component — static.
// ─────────────────────────────────────────────────────────────────────────────

import Link from 'next/link'

export const metadata = {
  title: 'Cookie Policy — Quorum',
  description: 'A full list of every item stored on your device by Quorum, and how to manage it.',
}

// Full registry of every localStorage / session storage key Quorum writes.
const STORAGE_REGISTRY = [
  {
    key: 'quorum_cookie_consent',
    category: 'Strictly Necessary',
    purpose: 'Records your cookie consent choices (necessary, functional, analytics). Required to respect your preferences.',
    duration: 'Until manually cleared',
    consent: false,
  },
  {
    key: 'quorum_theme',
    category: 'Strictly Necessary',
    purpose: 'Remembers your light / dark mode preference so the interface loads in your chosen theme without a flash.',
    duration: 'Until manually cleared',
    consent: false,
  },
  {
    key: 'quorum_user_email',
    category: 'Authentication',
    purpose: 'Persists your email address after signing in so the interface can recognise you across page loads without requiring a fresh session check.',
    duration: 'Until you sign out or clear storage',
    consent: false,
  },
  {
    key: 'quorum_device_id',
    category: 'Functional',
    purpose: 'An anonymous identifier generated on your device. Used to group decision sessions created on this device before you sign in, so history is preserved at sign-up.',
    duration: 'Until manually cleared',
    consent: true,
  },
  {
    key: 'quorum_session_ids',
    category: 'Functional',
    purpose: 'A local list of decision session IDs created on this device. Allows the home screen to show your recent decisions without a server request.',
    duration: 'Until manually cleared',
    consent: true,
  },
  {
    key: 'sb-*-auth-token',
    category: 'Authentication',
    purpose: 'Supabase authentication session token. Maintains your signed-in state across browser sessions.',
    duration: 'Session, or until Supabase token expiry',
    consent: false,
  },
]

const CATEGORY_COLOR: Record<string, string> = {
  'Strictly Necessary': '#2e6644',
  'Authentication':     '#1a52a8',
  'Functional':         '#5a3f1a',
}

export default function CookiePolicyPage() {
  return (
    <main style={{
      minHeight: '100vh',
      background: 'var(--bg-void)',
      padding: '48px 20px 96px',
    }}>
      <div style={{ maxWidth: 720, margin: '0 auto' }}>

        {/* Back link */}
        <Link href="/" style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          fontSize: 11, color: 'var(--text-4)',
          fontFamily: 'var(--font-mono)', letterSpacing: '0.08em',
          textDecoration: 'none', marginBottom: 36,
        }}>
          ← Back to Quorum
        </Link>

        {/* Header */}
        <div style={{ marginBottom: 40 }}>
          <p style={{
            fontFamily: 'var(--font-mono)', fontSize: 10,
            letterSpacing: '0.18em', textTransform: 'uppercase',
            color: 'var(--text-4)', margin: '0 0 12px',
          }}>
            Legal
          </p>
          <h1 style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'clamp(28px, 4vw, 42px)',
            fontWeight: 400, letterSpacing: '-0.02em',
            color: 'var(--text-1)', margin: '0 0 12px', lineHeight: 1.15,
          }}>
            Cookie Policy
          </h1>
          <p style={{
            fontFamily: 'var(--font-mono)', fontSize: 11,
            color: 'var(--text-4)', letterSpacing: '0.06em', margin: 0,
          }}>
            Effective 5 June 2026 · Version 1.0
          </p>
        </div>

        <hr style={{ border: 'none', borderTop: '1px solid var(--border-dim)', marginBottom: 40 }} />

        <div style={{ fontSize: 14, color: 'var(--text-2)', lineHeight: 1.85, fontFamily: 'var(--font-body)' }}>

          <p style={{
            fontSize: 15, color: 'var(--text-2)', lineHeight: 1.8, marginBottom: 36,
            borderLeft: '2px solid var(--gold-dim)', paddingLeft: 16,
          }}>
            Quorum does not use traditional HTTP cookies. Instead, we use browser{' '}
            <strong style={{ color: 'var(--text-1)' }}>local storage</strong> — a similar
            technology that stores small pieces of data in your browser. This page lists every
            key we store, what it contains, and how to manage it.
          </p>

          {/* Category legend */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 28 }}>
            {Object.entries(CATEGORY_COLOR).map(([cat, col]) => (
              <span key={cat} style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '4px 10px', borderRadius: 100,
                border: `1px solid ${col}44`,
                background: `${col}18`,
                fontSize: 11, fontFamily: 'var(--font-mono)',
                color: 'var(--text-3)',
              }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: col, flexShrink: 0 }} />
                {cat}
              </span>
            ))}
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '4px 10px', borderRadius: 100,
              border: '1px solid var(--border-dim)',
              background: 'var(--bg-card)',
              fontSize: 11, fontFamily: 'var(--font-mono)',
              color: 'var(--text-3)',
            }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--gold)', flexShrink: 0 }} />
              Functional (consent required)
            </span>
          </div>

          {/* Storage registry */}
          <section style={{ marginBottom: 44 }}>
            <h2 style={{
              fontSize: 13, fontWeight: 600, color: 'var(--text-1)',
              fontFamily: 'var(--font-body)', margin: '0 0 14px', paddingBottom: 8,
              borderBottom: '1px solid var(--border-dim)',
            }}>
              Local storage registry
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {STORAGE_REGISTRY.map((item) => {
                const catColor = item.consent
                  ? 'var(--gold)'
                  : (CATEGORY_COLOR[item.category] ?? 'var(--text-4)')
                return (
                  <div key={item.key} style={{
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border-dim)',
                    borderRadius: 10, overflow: 'hidden',
                  }}>
                    <div style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '10px 14px', gap: 12, flexWrap: 'wrap',
                      background: 'var(--bg-card-alt)',
                      borderBottom: '1px solid var(--border-dim)',
                    }}>
                      <code style={{
                        fontFamily: 'var(--font-mono)', fontSize: 11.5,
                        color: 'var(--text-1)', letterSpacing: '0.04em',
                      }}>
                        {item.key}
                      </code>
                      <span style={{
                        padding: '3px 9px', borderRadius: 100,
                        border: `1px solid ${catColor}44`,
                        background: `${catColor === 'var(--gold)' ? 'rgba(201,168,76' : catColor.replace('#', 'rgba(').replace(')', ',')}0.14)`,
                        fontSize: 10.5, fontFamily: 'var(--font-mono)',
                        color: 'var(--text-3)',
                        whiteSpace: 'nowrap',
                      }}>
                        {item.consent ? 'Functional — consent required' : item.category}
                      </span>
                    </div>
                    <div style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <p style={{ margin: 0, fontSize: 13, color: 'var(--text-3)', lineHeight: 1.65 }}>
                        {item.purpose}
                      </p>
                      <p style={{
                        margin: 0, fontSize: 11.5,
                        fontFamily: 'var(--font-mono)', color: 'var(--text-4)',
                        letterSpacing: '0.04em',
                      }}>
                        Duration: {item.duration}
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>
          </section>

          {/* Analytics */}
          <section style={{ marginBottom: 44 }}>
            <h2 style={{
              fontSize: 13, fontWeight: 600, color: 'var(--text-1)',
              fontFamily: 'var(--font-body)', margin: '0 0 14px', paddingBottom: 8,
              borderBottom: '1px solid var(--border-dim)',
            }}>
              Analytics
            </h2>
            <p>
              Quorum does not currently use any third-party analytics, advertising trackers,
              or cross-site tracking technologies. The analytics toggle in your consent preferences
              is reserved for potential future use and is off by default.
            </p>
          </section>

          {/* Managing preferences */}
          <section style={{ marginBottom: 44 }}>
            <h2 style={{
              fontSize: 13, fontWeight: 600, color: 'var(--text-1)',
              fontFamily: 'var(--font-body)', margin: '0 0 14px', paddingBottom: 8,
              borderBottom: '1px solid var(--border-dim)',
            }}>
              Managing your preferences
            </h2>
            <p>
              You can update your consent choices at any time via the{' '}
              <Link href="/settings/privacy" style={{ color: 'var(--gold)', textDecoration: 'none' }}>
                Privacy Center
              </Link>
              {' '}in app Settings. Changing your functional cookie preference will not delete
              existing local data — you can clear browser local storage manually via your
              browser&apos;s developer tools if you wish to remove all stored data immediately.
            </p>
            <p>
              Revoking functional consent means new session IDs and device identifiers will
              no longer be written to your device. Previously created sessions remain accessible
              via their direct URL.
            </p>
          </section>

        </div>
      </div>
    </main>
  )
}

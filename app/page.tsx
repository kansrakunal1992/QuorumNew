// app/security/page.tsx
// ── Sprint 3 (S3-04) — Security & Trust ──────────────────────────────────────
// Only technically provable, implemented facts are listed.
// No aspirational claims (SOC 2, pen tests, MFA, scheduled key rotation are NOT listed).
// Server component — static.
// ─────────────────────────────────────────────────────────────────────────────

import Link from 'next/link'

export const metadata = {
  title: 'Security & Trust — Quorum',
  description: 'What Quorum does today to protect your decision data.',
}

const IMPLEMENTED: { label: string; detail: string }[] = [
  {
    label: 'AES-256-GCM field encryption at rest',
    detail:
      'Decision text and AI analysis stored in the database are encrypted at the field level using AES-256-GCM before storage. Encrypted fields are decrypted only at read time within the application.',
  },
  {
    label: 'Passwordless magic link authentication',
    detail:
      'Quorum uses time-limited magic links sent to your email for authentication. No passwords are stored. Authentication is handled via Supabase Auth with PKCE flow.',
  },
  {
    label: 'HTTPS / TLS in transit',
    detail:
      'All data between your browser and Quorum servers is transmitted over HTTPS using TLS. The application is served from Railway with TLS termination enforced.',
  },
  {
    label: 'Row-level security (RLS) on the database',
    detail:
      'Supabase PostgreSQL row-level security policies are enforced across all user-scoped tables. Authenticated users can only read and write rows associated with their own account.',
  },
  {
    label: 'US-based hosting infrastructure',
    detail:
      'The Quorum application runs on Railway (US) and the database is hosted on Supabase (US). No user data is stored in jurisdictions with inadequate data protection standards.',
  },
  {
    label: 'No advertising, no data selling',
    detail:
      'Quorum does not serve advertising, does not sell user data, and does not share decision content with any third party except the AI processing service used to generate analysis.',
  },
  {
    label: 'AI processing with no training use',
    detail:
      'Your decision text is processed by an AI service solely to generate your Council analysis. The AI provider does not use your submissions to train its models.',
  },
  {
    label: 'Encryption key rotation tooling',
    detail:
      'A rotation script (scripts/rotate-encryption-key.ts) re-encrypts all database columns from an old AES-256-GCM key to a new one without downtime. Rotation is performed manually on a deliberate schedule to ensure human oversight of a sensitive cryptographic operation.',
  },
  {
    label: 'Vulnerability disclosure programme',
    detail:
      'A machine-readable disclosure policy is published at /.well-known/security.txt per RFC 9116. Report issues to security@quorumvault.org. We acknowledge valid reports within 5 business days and target remediation of critical issues within 30 days.',
  },
]

const NOT_YET: string[] = [
  'SOC 2 Type II certification',
  'Independent penetration testing',
  'Multi-factor authentication (MFA)',
  'Automated scheduled key rotation',
  'Dedicated security operations centre',
]

export default function SecurityPage() {
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
            Security & Trust
          </h1>
          <p style={{
            fontFamily: 'var(--font-mono)', fontSize: 11,
            color: 'var(--text-4)', letterSpacing: '0.06em', margin: 0,
          }}>
            Effective 5 June 2026 · Current state — no aspirational claims
          </p>
        </div>

        <hr style={{ border: 'none', borderTop: '1px solid var(--border-dim)', marginBottom: 40 }} />

        <div style={{ fontSize: 14, color: 'var(--text-2)', lineHeight: 1.85, fontFamily: 'var(--font-body)' }}>

          <p style={{
            fontSize: 15, color: 'var(--text-2)', lineHeight: 1.8, marginBottom: 40,
            borderLeft: '2px solid var(--gold-dim)', paddingLeft: 16,
          }}>
            This page lists only what is technically implemented today. We do not list
            aspirational measures or certifications we have not yet completed.
          </p>

          {/* What we do */}
          <section style={{ marginBottom: 44 }}>
            <h2 style={{
              fontSize: 13, fontWeight: 600, color: 'var(--text-1)',
              fontFamily: 'var(--font-body)', margin: '0 0 16px', paddingBottom: 8,
              borderBottom: '1px solid var(--border-dim)',
            }}>
              What we do today
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {IMPLEMENTED.map((item, i) => (
                <div key={i} style={{
                  display: 'flex', gap: 14, alignItems: 'flex-start',
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border-dim)',
                  borderRadius: 10, padding: '14px 16px',
                }}>
                  <span style={{
                    flexShrink: 0, marginTop: 2,
                    width: 18, height: 18, borderRadius: '50%',
                    background: 'rgba(74,222,128,0.12)',
                    border: '1px solid rgba(74,222,128,0.3)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 10, color: 'var(--green-text)',
                  }}>
                    ✓
                  </span>
                  <div>
                    <p style={{
                      margin: '0 0 4px', fontSize: 13, fontWeight: 600,
                      color: 'var(--text-1)',
                    }}>
                      {item.label}
                    </p>
                    <p style={{ margin: 0, fontSize: 13, color: 'var(--text-3)', lineHeight: 1.65 }}>
                      {item.detail}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* What we don't yet have */}
          <section style={{ marginBottom: 44 }}>
            <h2 style={{
              fontSize: 13, fontWeight: 600, color: 'var(--text-1)',
              fontFamily: 'var(--font-body)', margin: '0 0 16px', paddingBottom: 8,
              borderBottom: '1px solid var(--border-dim)',
            }}>
              What we do not yet have
            </h2>
            <p style={{ marginBottom: 14 }}>
              We believe transparency about our current limitations is more valuable
              than unverifiable security claims. The following are not yet in place:
            </p>
            <div style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border-dim)',
              borderRadius: 10, overflow: 'hidden',
            }}>
              {NOT_YET.map((item, i) => (
                <div key={i} style={{
                  display: 'flex', gap: 12, alignItems: 'center',
                  padding: '11px 16px',
                  borderTop: i > 0 ? '1px solid var(--border-dim)' : 'none',
                }}>
                  <span style={{
                    flexShrink: 0,
                    width: 16, height: 16, borderRadius: '50%',
                    background: 'rgba(100,100,100,0.12)',
                    border: '1px solid var(--border-mid)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 10, color: 'var(--text-4)',
                  }}>
                    –
                  </span>
                  <span style={{ fontSize: 13, color: 'var(--text-4)' }}>{item}</span>
                </div>
              ))}
            </div>
          </section>

          {/* Reporting */}
          <section style={{ marginBottom: 44 }}>
            <h2 style={{
              fontSize: 13, fontWeight: 600, color: 'var(--text-1)',
              fontFamily: 'var(--font-body)', margin: '0 0 14px', paddingBottom: 8,
              borderBottom: '1px solid var(--border-dim)',
            }}>
              Reporting a security concern
            </h2>
            <p>
              If you discover a potential security issue, please report it via the{' '}
              <Link href="/settings/privacy" style={{ color: 'var(--gold)', textDecoration: 'none' }}>
                Privacy Center
              </Link>
              {' '}in app Settings. We will acknowledge all valid reports within 5 business days
              and aim to remediate critical issues within 30 days.
            </p>
          </section>

          {/* Data rights */}
          <section>
            <h2 style={{
              fontSize: 13, fontWeight: 600, color: 'var(--text-1)',
              fontFamily: 'var(--font-body)', margin: '0 0 14px', paddingBottom: 8,
              borderBottom: '1px solid var(--border-dim)',
            }}>
              Your data rights
            </h2>
            <p>
              You can export or delete your data at any time via the{' '}
              <Link href="/settings/privacy" style={{ color: 'var(--gold)', textDecoration: 'none' }}>
                Privacy Center
              </Link>
              . For full details on how we handle your data, see the{' '}
              <Link href="/privacy" style={{ color: 'var(--gold)', textDecoration: 'none' }}>
                Privacy Policy
              </Link>.
            </p>
          </section>

        </div>
      </div>
    </main>
  )
}

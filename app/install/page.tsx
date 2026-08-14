// app/install/page.tsx
// ── Install Quorum to your home screen ───────────────────────────────────────
// Standalone help page linked from the "Can I use Quorum on my phone?" FAQ
// entry. Steps match what's actually configured: manifest.json (name
// "Quorum", display: standalone) + apple-mobile-web-app meta tags in
// app/layout.tsx — this is a real installable PWA, not an aspirational claim.
// Server component — static.
// ─────────────────────────────────────────────────────────────────────────────

import Link from 'next/link'

export const metadata = {
  title: 'Install Quorum — Quorum',
  description: 'Add Quorum to your home screen on Android or iPhone. No app store required.',
}

export default function InstallPage() {
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
            Guide
          </p>
          <h1 style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'clamp(28px, 4vw, 42px)',
            fontWeight: 400, letterSpacing: '-0.02em',
            color: 'var(--text-1)', margin: '0 0 12px', lineHeight: 1.15,
          }}>
            Install Quorum on your phone
          </h1>
          <p style={{
            fontFamily: 'var(--font-mono)', fontSize: 11,
            color: 'var(--text-4)', letterSpacing: '0.06em', margin: 0,
          }}>
            No app store, no download — a couple of taps from your browser.
          </p>
        </div>

        <hr style={{ border: 'none', borderTop: '1px solid var(--border-dim)', marginBottom: 40 }} />

        <div style={{ fontSize: 14, color: 'var(--text-2)', lineHeight: 1.85, fontFamily: 'var(--font-body)' }}>

          <p style={{
            fontSize: 15, color: 'var(--text-2)', lineHeight: 1.8, marginBottom: 40,
            borderLeft: '2px solid var(--gold-dim)', paddingLeft: 16,
          }}>
            Quorum is a web app you can add to your home screen like any other
            app. It opens full-screen, works from an icon like everything else
            on your phone, and there\u2019s nothing to install from an app store.
          </p>

          <PlatformSteps
            title="iPhone (Safari)"
            steps={[
              'Open app.quorumvault.org in Safari.',
              'Tap the Share icon (the square with an arrow pointing up) in the toolbar.',
              'Scroll down and tap "Add to Home Screen."',
              'Confirm the name (\u201cQuorum\u201d) and tap "Add."',
            ]}
            note="Must be done in Safari \u2014 Chrome and other iPhone browsers can't add to the home screen due to Apple's restrictions."
          />

          <PlatformSteps
            title="Android (Chrome)"
            steps={[
              'Open app.quorumvault.org in Chrome.',
              'Tap the three-dot menu in the top-right corner.',
              'Tap "Add to Home screen" (sometimes shown as "Install app").',
              'Confirm the name and tap "Add" or "Install."',
            ]}
            note="On some Android phones, Chrome will show an install prompt automatically after your first visit \u2014 you can tap that instead of using the menu."
          />

          <section style={{ marginTop: 8 }}>
            <h2 style={{
              fontSize: 13, fontWeight: 600, color: 'var(--text-1)',
              fontFamily: 'var(--font-body)', letterSpacing: '0.01em',
              margin: '0 0 14px', paddingBottom: 8,
              borderBottom: '1px solid var(--border-dim)',
            }}>
              What you get
            </h2>
            <p>
              Once installed, Quorum opens in its own window without your
              browser\u2019s address bar or tabs \u2014 it feels like a native app.
              Your sessions, sign-in, and history are the same as the website;
              installing doesn\u2019t create a separate copy of your data.
            </p>
          </section>

        </div>
      </div>
    </main>
  )
}

function PlatformSteps({ title, steps, note }: { title: string; steps: string[]; note: string }) {
  return (
    <section style={{ marginBottom: 36 }}>
      <h2 style={{
        fontSize: 13, fontWeight: 600, color: 'var(--text-1)',
        fontFamily: 'var(--font-body)', letterSpacing: '0.01em',
        margin: '0 0 14px', paddingBottom: 8,
        borderBottom: '1px solid var(--border-dim)',
      }}>
        {title}
      </h2>
      <ol style={{ paddingLeft: 20, margin: '0 0 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {steps.map((step, i) => (
          <li key={i} style={{ color: 'var(--text-2)', lineHeight: 1.7, fontSize: 13.5 }}>{step}</li>
        ))}
      </ol>
      <p style={{ fontSize: 12, color: 'var(--text-4)', lineHeight: 1.6, margin: 0 }}>
        {note}
      </p>
    </section>
  )
}

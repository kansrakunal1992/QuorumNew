// components/AppFooter.tsx
// ── Sprint 2 (S2-04) — App-wide Footer ───────────────────────────────────────
//
// Server component — no interactivity needed.
// Rendered in layout.tsx so it appears on every page.
// Legal pages plus other standalone info/help pages (e.g. the install
// guide) that are worth surfacing everywhere.
// ─────────────────────────────────────────────────────────────────────────────

import Link from 'next/link'

const FOOTER_LINKS = [
  { href: '/methodology', label: 'How Quorum Works' },
  { href: '/install',  label: 'Install on your phone' },
  { href: '/privacy',  label: 'Privacy Policy' },
  { href: '/cookies',  label: 'Cookie Policy'  },
  { href: '/terms',    label: 'Terms'          },
  { href: '/security', label: 'Security & Trust' },
]

export default function AppFooter() {
  return (
    <footer style={{
      borderTop: '1px solid var(--border-dim)',
      padding: '16px 24px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      flexWrap: 'wrap',
      gap: 12,
      background: 'var(--bg-card)',
    }}>
      {/* Legal navigation — using div not nav to avoid any accidental position conflicts */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        {FOOTER_LINKS.map((link, i) => (
          <span key={link.href} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {i > 0 && (
              <span style={{
                color: 'var(--border-mid)',
                fontSize: 11,
                userSelect: 'none',
              }}>·</span>
            )}
            <Link
              href={link.href}
              style={{
                fontSize: 11.5,
                color: 'var(--text-4)',
                textDecoration: 'none',
                fontFamily: 'var(--font-body)',
                transition: 'color 0.15s',
              }}
            >
              {link.label}
            </Link>
          </span>
        ))}
      </div>

      <p style={{
        fontSize: 11,
        color: 'var(--text-4)',
        margin: 0,
        fontFamily: 'var(--font-body)',
      }}>
        © 2026 Quorum
      </p>
    </footer>
  )
}

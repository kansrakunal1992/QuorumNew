'use client'
// components/SettingsNav.tsx
// ── Shared Settings tab nav ───────────────────────────────────────────────────
// Previously copy-pasted independently inside app/settings/privacy/page.tsx
// and app/settings/security/page.tsx (two implementations of the same tab
// strip, only one letter apart in each). Extracted into one component so
// adding a tab — like Personalization here — is a one-place change instead
// of three, and so the three settings pages can never visually drift apart.
//
// Personalization placed first (not appended at the end) — it's the newest
// addition and the one most people will actually want to find, so it should
// be the first thing seen when arriving at /settings from anywhere, not
// something a user has to already know to scroll/click past Privacy and
// Security to discover.

import Link from 'next/link'

export default function SettingsNav({ active }: { active: 'personalization' | 'privacy' | 'security' }) {
  return (
    <div style={{
      display: 'flex', gap: 4,
      background: 'var(--bg-card)',
      border: '1px solid var(--border-dim)',
      borderRadius: 10, padding: 4,
    }}>
      {([
        { href: '/settings/personalization', label: 'Personalization', key: 'personalization' },
        { href: '/settings/privacy',         label: 'Privacy Center',  key: 'privacy'  },
        { href: '/settings/security',        label: 'Security Center', key: 'security' },
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

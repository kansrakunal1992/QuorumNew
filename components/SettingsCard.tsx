'use client'
// components/SettingsCard.tsx
// Previously copy-pasted independently in app/settings/privacy/page.tsx and
// app/settings/security/page.tsx — see components/SettingsNav.tsx for the
// full rationale for extracting both at once.

export default function SettingsCard({ title, children }: { title: string; children: React.ReactNode }) {
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

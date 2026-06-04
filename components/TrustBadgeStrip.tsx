// components/TrustBadgeStrip.tsx
// ── Sprint 2 (S2-03) — Decision Page Trust Badge Strip ───────────────────────
//
// Shown on the record page (/record/[id]) as a compact row of provable claims.
// Only claims that are technically true are displayed:
//   - Encrypted at rest: only shown if DB_ENCRYPTION_KEY is set (passed as prop)
//   - Visible only to you: always true (URL-scoped access)
//   - AI processing: always generic — no provider name exposed to users
//
// Not 'use client' — purely presentational, no interactivity.
// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  encryptionEnabled?: boolean
}

export default function TrustBadgeStrip({ encryptionEnabled }: Props) {
  const badges = [
    ...(encryptionEnabled
      ? [{ icon: '🔒', text: 'Encrypted at rest' }]
      : []),
    { icon: '👤', text: 'Visible only to you' },
    { icon: '🤖', text: 'Analysed by AI · not used for training' },
  ]

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: 8,
      padding: '8px 0 14px',
    }}>
      {badges.map((badge, i) => (
        <span key={i} style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          padding: '4px 10px',
          borderRadius: 100,
          border: '1px solid var(--border-dim)',
          background: 'var(--bg-card)',
          fontSize: 11,
          color: 'var(--text-4)',
          fontFamily: 'var(--font-mono)',
          letterSpacing: '0.03em',
          whiteSpace: 'nowrap',
        }}>
          <span style={{ fontSize: 10 }}>{badge.icon}</span>
          {badge.text}
        </span>
      ))}
    </div>
  )
}

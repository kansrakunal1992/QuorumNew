// components/TrustBadgeStrip.tsx
// ── Sprint 2 (S2-03) — Decision Page Trust Badge Strip ───────────────────────
//
// Shown on the record page (/record/[id]) as a compact row of provable claims.
// Only claims that are technically true are displayed:
//   - Encrypted at rest: only shown if DB_ENCRYPTION_KEY is set (passed as prop)
//   - Visible only to you: always true (URL-scoped access)
//   - AI processing: always generic — no provider name exposed to users
//
// Item #33/#34 (audit §0): icons were literal emoji (🔒 👤 🤖), the one spot
// in the app still using OS-rendered glyphs instead of the app's own SVG
// icon language — inconsistent, and renders noticeably more casual on
// Android's Noto Emoji set than the rest of this "boardroom, not consumer
// app" screen. Replaced with 10px outline SVGs, stroke=currentColor, same
// weight/style as the rest of the app's custom icon set.
//
// Not 'use client' — purely presentational, no interactivity.
// ─────────────────────────────────────────────────────────────────────────────

const IconLock = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>
  </svg>
)
const IconEye = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/>
  </svg>
)
const IconProcessed = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="6" y="6" width="12" height="12" rx="2"/>
    <path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/>
  </svg>
)

interface Props {
  encryptionEnabled?: boolean
}

export default function TrustBadgeStrip({ encryptionEnabled }: Props) {
  const badges = [
    ...(encryptionEnabled
      ? [{ icon: <IconLock />, text: 'Encrypted at rest' }]
      : []),
    { icon: <IconEye />, text: 'Visible only to you' },
    { icon: <IconProcessed />, text: 'Analysed by AI · not used for training' },
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
          {badge.icon}
          {badge.text}
        </span>
      ))}
    </div>
  )
}

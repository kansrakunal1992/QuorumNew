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
  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>
  </svg>
)
const IconEye = () => (
  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/>
  </svg>
)
const IconProcessed = () => (
  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="6" y="6" width="12" height="12" rx="2"/>
    <path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/>
  </svg>
)

// Item #33/#34 (audit §0b, second pass): each claim was its own bordered/
// backgrounded pill — three small card-shells in a row directly above the
// Decision Hero, adding to the same stack (Decision Hero → Validation →
// Outcome Tracker) already being quieted elsewhere on this page. Collapsed
// to one unbordered caption line, same icons, same claims, "·" separators —
// still a disclosure row, no longer competing with the decision itself.
//
// Declutter pass: this strip used to sit alongside a separate "Not a
// chatbot" / "Your data" copy block and two more links ("Full FAQ ↓", "See
// exactly what we encrypt →") on the homepage — five lines of prose plus
// this strip, all making variations of the same trust claim before a user
// had even started typing. That's gone from the callers now; the one thing
// worth keeping discoverable — the security page — is folded into this
// strip itself via securityHref, so "Encrypted at rest" IS the link instead
// of needing a separate line to point at it.
//
// Second declutter pass: copy shortened per badge ("Encrypted at rest" →
// "Encrypted", "Visible only to you" → "Private", "Analysed by AI · not
// used for training" → "Not used for training") and the strip sized down
// (9px icons, 10px text, tighter gaps, forced single line via nowrap) so
// the full row reliably fits on one line at mobile widths too, not just
// desktop. Full phrasing is one tap away for anyone who wants it — via
// securityHref on the Encrypted badge, or the caller's own copy where one
// exists (e.g. onboarding).

import Link from 'next/link'

interface Props {
  encryptionEnabled?: boolean
  /** When provided, the "Encrypted" badge becomes a link to this href
   *  (typically /security) instead of plain text — the strip's own claim
   *  doubles as the way to verify it, so no separate "see what we encrypt"
   *  link is needed elsewhere on the page. Omit to render plain text (e.g.
   *  contexts where a security page isn't reachable/relevant). */
  securityHref?: string
}

export default function TrustBadgeStrip({ encryptionEnabled, securityHref }: Props) {
  const encryptedBadgeText = securityHref ? (
    <Link
      href={securityHref}
      style={{ color: 'inherit', textDecoration: 'none', borderBottom: '1px solid var(--border-mid)' }}
    >
      Encrypted
    </Link>
  ) : 'Encrypted'

  const badges = [
    ...(encryptionEnabled
      ? [{ icon: <IconLock />, text: encryptedBadgeText }]
      : []),
    { icon: <IconEye />, text: 'Private' },
    { icon: <IconProcessed />, text: 'Not used for training' },
  ]

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      flexWrap: 'nowrap',
      columnGap: 9,
      padding: '4px 0 12px',
      fontSize: 10,
      color: 'var(--text-4)',
      fontFamily: 'var(--font-mono)',
      letterSpacing: '0.02em',
      overflowX: 'auto',
    }}>
      {badges.map((badge, i) => (
        <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
          {badge.icon}
          {badge.text}
          {i < badges.length - 1 && (
            <span style={{ marginLeft: 6, color: 'var(--border-mid)' }}>·</span>
          )}
        </span>
      ))}
    </div>
  )
}

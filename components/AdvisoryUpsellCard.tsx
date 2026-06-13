'use client'

// components/AdvisoryUpsellCard.tsx
// ── Mirror Advisory upsell card (Phase 4/5) ──────────────────────────────────
//
// Rendered in place of Advisory-only content for 'mirror' tier users.
// Reuses the visual language of the existing teaser/status cards (gold top
// rule, var(--bg-card)) — deliberately NOT a "locked" badge or blur. The point
// is to name what exists and where it lives, not to hide that something is
// missing.
// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  title:       string
  description: string
}

export default function AdvisoryUpsellCard({ title, description }: Props) {
  return (
    <div style={{
      background:   'linear-gradient(180deg, rgba(255,255,255,0.015) 0%, transparent 50%), var(--bg-card)',
      border:       '1px solid var(--border-dim)',
      borderRadius: 12,
      padding:      '16px 18px',
      position:     'relative',
      overflow:     'hidden',
    }}>
      <div style={{
        position: 'absolute', top: 0, left: 0,
        width: '100%', height: 2,
        background: 'linear-gradient(90deg, var(--gold-dim) 0%, transparent 60%)',
      }} />
      <p style={{
        fontSize: 10, fontWeight: 700, color: 'var(--gold)',
        textTransform: 'uppercase', letterSpacing: '0.1em',
        margin: '0 0 6px',
      }}>
        {title}
      </p>
      <p style={{ fontSize: 12.5, color: 'var(--text-4)', margin: 0, lineHeight: 1.6 }}>
        {description}
      </p>
    </div>
  )
}

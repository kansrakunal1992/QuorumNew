// components/SocialProofCard.tsx
// ── SocialProofCard ────────────────────────────────────────────────────────
// Anonymised decision-record case study. Copy sourced from the marketing
// site's "From the decision record" section (website/index.html) — same
// first-party content, reused here so a Mirror-locked visitor sees it
// without ever needing to leave the app and visit the marketing site.
// Self-contained and prop-free so it can be dropped onto any page later
// (home page, record page) without wiring.

export default function SocialProofCard() {
  return (
    <div style={{
      width:        '100%',
      background:   'var(--bg-card)',
      border:       '1px solid var(--border-dim)',
      borderRadius: 12,
      padding:      '20px 22px',
    }}>
      <p style={{
        fontSize: 10, fontWeight: 700, letterSpacing: '0.1em',
        textTransform: 'uppercase', color: 'var(--text-4)', margin: '0 0 10px',
      }}>
        Decision record · Consulting · Delhi NCR
      </p>
      <p style={{ fontSize: 12.5, color: 'var(--text-3)', lineHeight: 1.6, margin: '0 0 16px', fontStyle: 'italic' }}>
        &ldquo;We were ready to raise salaries across the board to retain talent for a scaling
        phase. Quorum held the decision — the Examiner flagged that we hadn&apos;t resolved
        whether the demand curve we were scaling for was seasonal or structural. Six weeks
        later, we had our answer, and a variable compensation model that aligned with firm
        performance instead of a fixed cost we couldn&apos;t reverse.&rdquo;
      </p>
      <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--gold)' }}>6 wks</div>
          <div style={{ fontSize: 10.5, color: 'var(--text-4)', lineHeight: 1.4, maxWidth: 140 }}>
            Decision held on an unresolved structural question
          </div>
        </div>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--gold)' }}>6 → 8</div>
          <div style={{ fontSize: 10.5, color: 'var(--text-4)', lineHeight: 1.4, maxWidth: 140 }}>
            Confidence score, before vs. after resolution
          </div>
        </div>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--gold)' }}>FOMO</div>
          <div style={{ fontSize: 10.5, color: 'var(--text-4)', lineHeight: 1.4, maxWidth: 140 }}>
            Bias Mirror flagged during this decision
          </div>
        </div>
      </div>
    </div>
  )
}

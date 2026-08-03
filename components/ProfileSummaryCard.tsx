'use client'
// components/ProfileSummaryCard.tsx
// ── Decision-Maker Profile summary/edit card ──────────────────────────────────
// Previously defined inline inside app/mirror/page.tsx (only reachable from
// UnlockedView). Extracted so it has one implementation used in three places:
//   - Mirror page (Locked / Teaser / Unlocked views — all three now show it)
//   - Settings → Personalization (new canonical home for reviewing/editing it)
// One component means the profile summary always looks and behaves
// identically no matter where the user encounters it.

import type { UserProfile } from '@/lib/types'

export default function ProfileSummaryCard({ userProfile, onEditProfile }: {
  userProfile: UserProfile | null
  onEditProfile: () => void
}) {
  return (
    <div id="msec-profile" style={{
      marginBottom: 28,
      padding: '18px 20px',
      borderRadius: 12,
      border: '1px solid var(--border-dim)',
      borderLeft: '3px solid var(--gold-dim)',
      background: 'var(--bg-card)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', letterSpacing: '0.08em', textTransform: 'uppercase', margin: 0 }}>
          Your Decision-Maker Profile
        </p>
        <button
          type="button"
          onClick={() => onEditProfile()}
          style={{
            fontSize: 11, fontWeight: 600, color: 'var(--gold)',
            background: 'none', border: '1px solid var(--gold-dim)',
            borderRadius: 6, padding: '4px 10px', cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          {userProfile ? 'Edit' : 'Set up →'}
        </button>
      </div>
      {userProfile && (userProfile.archetype || userProfile.primary_fears || userProfile.life_stage || userProfile.risk_stance || userProfile.mbti_type) ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
          {userProfile.archetype && (
            <span style={{ fontSize: 11, padding: '4px 10px', borderRadius: 20, border: '1px solid var(--gold-dim)', color: 'var(--gold)', background: 'rgba(201,168,76,0.08)' }}>
              {String(userProfile.archetype).charAt(0).toUpperCase() + String(userProfile.archetype).slice(1)}
            </span>
          )}
          {userProfile.life_stage && (
            <span style={{ fontSize: 11, padding: '4px 10px', borderRadius: 20, border: '1px solid var(--border-dim)', color: 'var(--text-3)' }}>
              {String(userProfile.life_stage).charAt(0).toUpperCase() + String(userProfile.life_stage).slice(1)}
            </span>
          )}
          {userProfile.risk_stance && (
            <span style={{ fontSize: 11, padding: '4px 10px', borderRadius: 20, border: '1px solid var(--border-dim)', color: 'var(--text-3)' }}>
              {String(userProfile.risk_stance).charAt(0).toUpperCase() + String(userProfile.risk_stance).slice(1)} risk
            </span>
          )}
          {userProfile.mbti_type && (
            <span style={{ fontSize: 11, padding: '4px 10px', borderRadius: 20, border: '1px solid var(--border-dim)', color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>
              {String(userProfile.mbti_type)}
            </span>
          )}
          {(userProfile.primary_fears as string[] | null)?.map((f: string) => (
            <span key={f} style={{ fontSize: 11, padding: '4px 10px', borderRadius: 20, border: '1px solid rgba(136,64,196,0.3)', color: '#b070e0', background: 'rgba(136,64,196,0.06)' }}>
              {f}
            </span>
          ))}
        </div>
      ) : (
        <p style={{ fontSize: 12.5, color: 'var(--text-4)', lineHeight: 1.55, margin: 0 }}>
          Your profile tells the Council who is bringing each decision — archetype, fears, life stage, risk stance.
          The more complete it is, the more precisely the Council orients to you.
        </p>
      )}
    </div>
  )
}

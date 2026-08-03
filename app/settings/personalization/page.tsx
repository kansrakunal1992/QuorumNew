'use client'
// app/settings/personalization/page.tsx
// ── Settings → Personalization ────────────────────────────────────────────────
// New canonical home for "everything the app knows about you," consolidating
// what was previously scattered across:
//   - Profile (archetype/fears/life stage/risk stance) — first-visit overlay
//     only, buried "Edit" link on Mirror (Elite-only, didn't pre-fill)
//   - Council Style (style_cue) — set once via a banner on Mirror after 5
//     sessions, then had NO display or edit surface anywhere afterward
//   - Imported Context — spread across 4 separate mounts (Mirror welcome,
//     Mirror paywall, Mirror unlocked, Settings → Privacy)
// This page doesn't change how any of the three are used downstream (prompt
// content, persona ordering, extraction) — it only gives them one place to
// be reviewed and changed, discoverable via the Personalization tab (now
// first) in SettingsNav from any Settings page.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import AuthPanel from '@/components/AuthPanel'
import SettingsNav from '@/components/SettingsNav'
import SettingsCard from '@/components/SettingsCard'
import ProfileSummaryCard from '@/components/ProfileSummaryCard'
import ProfileCaptureOverlay from '@/components/ProfileCaptureOverlay'
import ContextIngestionPanel from '@/components/ContextIngestionPanel'
import StyleCalibration from '@/components/StyleCalibration'
import type { UserProfile, StyleCue } from '@/lib/types'

const STYLE_LABELS: Record<StyleCue, { persona: string; description: string }> = {
  direct:      { persona: 'Contrarian',                 description: 'Leads with direct pushback on your read of the situation.' },
  challenge:   { persona: 'Contrarian & Risk Architect', description: 'Leads by challenging your read and mapping the downside.' },
  pattern:     { persona: 'Pattern Analyst',             description: 'Leads by naming the historical pattern your decision fits.' },
  risk:        { persona: 'Risk Architect',              description: 'Leads by mapping out how this could go wrong.' },
  stakeholder: { persona: 'Stakeholder Mirror',          description: 'Leads by surfacing who else is affected.' },
  long:        { persona: 'Elder',                       description: 'Leads by slowing you down on long-term implications.' },
}

export default function PersonalizationSettingsPage() {
  const [sessionEmail,   setSessionEmail]   = useState<string | null>(null)
  const [sessionChecked, setSessionChecked] = useState(false)
  const [authToken,      setAuthToken]      = useState<string | null>(null)
  const [mirrorUnlocked, setMirrorUnlocked] = useState(false)

  const [userProfile,    setUserProfile]    = useState<UserProfile | null>(null)
  const [showProfileEdit, setShowProfileEdit] = useState(false)

  const [styleCue,        setStyleCue]        = useState<StyleCue | null>(null)
  const [styleCueLoaded,  setStyleCueLoaded]  = useState(false)
  const [showStyleChange, setShowStyleChange] = useState(false)

  const loadAll = useCallback(async (token: string) => {
    fetch('/api/profile', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : null)
      .then((d: { profile: UserProfile | null } | null) => setUserProfile(d?.profile ?? null))
      .catch(() => setUserProfile(null))

    fetch('/api/mirror/status', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : null)
      .then((d: { gateState?: string } | null) => setMirrorUnlocked(d?.gateState === 'unlocked'))
      .catch(() => setMirrorUnlocked(false))
  }, [])

  const loadStyleCue = useCallback((token: string) => {
    setStyleCueLoaded(false)
    fetch('/api/mirror/preferences', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : null)
      .then((d: { style_cue: StyleCue | null } | null) => setStyleCue(d?.style_cue ?? null))
      .catch(() => setStyleCue(null))
      .finally(() => setStyleCueLoaded(true))
  }, [])

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSessionEmail(session?.user?.email ?? null)
      setAuthToken(session?.access_token ?? null)
      setSessionChecked(true)
      if (session?.access_token) loadAll(session.access_token)
    })
  }, [loadAll])

  useEffect(() => {
    if (authToken && mirrorUnlocked) loadStyleCue(authToken)
  }, [authToken, mirrorUnlocked, loadStyleCue])

  return (
    <main style={{
      minHeight: '100vh',
      background: 'var(--bg-void)',
      padding: '48px 20px 96px',
    }}>
      <div style={{ maxWidth: 640, margin: '0 auto' }}>

        {/* Back */}
        <a href="/" style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          fontSize: 11, color: 'var(--text-4)',
          fontFamily: 'var(--font-mono)', letterSpacing: '0.08em',
          textDecoration: 'none', marginBottom: 32,
        }}>
          ← Back to Quorum
        </a>

        {/* Page title */}
        <div style={{ marginBottom: 28 }}>
          <p style={{
            fontFamily: 'var(--font-mono)', fontSize: 10,
            letterSpacing: '0.18em', textTransform: 'uppercase',
            color: 'var(--text-4)', margin: '0 0 10px',
          }}>
            Settings
          </p>
          <h1 style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'clamp(24px, 3.5vw, 34px)',
            fontWeight: 400, letterSpacing: '-0.02em',
            color: 'var(--text-1)', margin: 0, lineHeight: 1.2,
          }}>
            Personalization
          </h1>
          <p style={{ fontSize: 13, color: 'var(--text-4)', lineHeight: 1.6, margin: '10px 0 0' }}>
            Everything Quorum knows about you — how it's used, and how to change it. One place instead of three.
          </p>
        </div>

        <SettingsNav active="personalization" />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 24 }}>

          {!sessionChecked ? (
            <SettingsCard title="Your Decision-Maker Profile">
              <p style={{ fontSize: 13, color: 'var(--text-4)', fontFamily: 'var(--font-mono)' }}>Loading…</p>
            </SettingsCard>
          ) : !sessionEmail ? (
            <SettingsCard title="Sign in to manage your personalization">
              <p style={{ fontSize: 12.5, color: 'var(--text-4)', lineHeight: 1.6, margin: '0 0 14px' }}>
                Your profile, Council style, and imported context are all tied to your account.
              </p>
              <AuthPanel
                userEmail={null}
                onAuthenticated={email => {
                  setSessionEmail(email)
                  const supabase = createClient()
                  supabase.auth.getSession().then(({ data: { session } }) => {
                    setAuthToken(session?.access_token ?? null)
                    if (session?.access_token) loadAll(session.access_token)
                  })
                }}
              />
            </SettingsCard>
          ) : (
            <>
              {/* ── Profile — available to every plan, matches the Mirror page fix ── */}
              <SettingsCard title="Your Decision-Maker Profile">
                <p style={{ fontSize: 12.5, color: 'var(--text-4)', lineHeight: 1.6, margin: '0 0 14px' }}>
                  Archetype, fears, life stage, and risk stance — how the Council orients to who's bringing the decision.
                </p>
                <ProfileSummaryCard
                  userProfile={userProfile}
                  onEditProfile={() => setShowProfileEdit(true)}
                />
              </SettingsCard>

              {/* ── Council Style — Elite only, matches the existing style_cue gate ── */}
              <SettingsCard title="Council Style">
                {!mirrorUnlocked ? (
                  <p style={{ fontSize: 12.5, color: 'var(--text-4)', lineHeight: 1.6, margin: 0 }}>
                    Available on Quorum Elite, after your 5th decision. Adjusts which advisor leads your council — not what they say.
                  </p>
                ) : !styleCueLoaded ? (
                  <p style={{ fontSize: 13, color: 'var(--text-4)', fontFamily: 'var(--font-mono)', margin: 0 }}>Loading…</p>
                ) : showStyleChange ? (
                  <StyleCalibration
                    authToken={authToken ?? ''}
                    onComplete={cue => { setStyleCue(cue); setShowStyleChange(false) }}
                    onDismiss={() => setShowStyleChange(false)}
                  />
                ) : styleCue ? (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                    <div>
                      <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-1)', margin: '0 0 3px' }}>
                        Currently leading with: {STYLE_LABELS[styleCue].persona}
                      </p>
                      <p style={{ fontSize: 12.5, color: 'var(--text-4)', margin: 0, lineHeight: 1.5 }}>
                        {STYLE_LABELS[styleCue].description}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowStyleChange(true)}
                      style={{
                        fontSize: 11, fontWeight: 600, color: 'var(--gold)',
                        background: 'none', border: '1px solid var(--gold-dim)',
                        borderRadius: 6, padding: '4px 10px', cursor: 'pointer',
                        fontFamily: 'inherit', whiteSpace: 'nowrap',
                      }}
                    >
                      Change
                    </button>
                  </div>
                ) : (
                  <div>
                    <p style={{ fontSize: 12.5, color: 'var(--text-4)', lineHeight: 1.6, margin: '0 0 14px' }}>
                      Not set yet — Quorum picks council ordering from your decisions alone until you set this.
                    </p>
                    <button
                      type="button"
                      onClick={() => setShowStyleChange(true)}
                      style={{
                        fontSize: 11, fontWeight: 600, color: 'var(--gold)',
                        background: 'none', border: '1px solid var(--gold-dim)',
                        borderRadius: 6, padding: '4px 10px', cursor: 'pointer',
                        fontFamily: 'inherit',
                      }}
                    >
                      Set up →
                    </button>
                  </div>
                )}
              </SettingsCard>

              {/* ── Imported Context (Elite) — canonical home; self-gates its own
                  free-tier teaser internally, same component used elsewhere ── */}
              <ContextIngestionPanel authToken={authToken ?? ''} />
            </>
          )}
        </div>
      </div>

      {showProfileEdit && (
        <ProfileCaptureOverlay
          authToken={authToken}
          deviceId={null}
          initialProfile={userProfile}
          onDone={() => {
            setShowProfileEdit(false)
            if (authToken) {
              fetch('/api/profile', { headers: { Authorization: `Bearer ${authToken}` } })
                .then(r => r.ok ? r.json() : null)
                .then((d: { profile: UserProfile | null } | null) => setUserProfile(d?.profile ?? null))
                .catch(() => null)
            }
          }}
        />
      )}
    </main>
  )
}

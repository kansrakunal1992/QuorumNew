'use client'
// components/ProfileCaptureOverlay.tsx
// SB-1: First-visit profile capture overlay.
// Shows when user_profile IS NULL and 'quorum_profile_overlay_shown' is not in localStorage.
// All fields optional. Saves to /api/profile on submit.
// Fires for new users AND existing users who haven't filled in a profile.

import { useState, useEffect } from 'react'

// ── Types ─────────────────────────────────────────────────────────────────────

type Archetype   = 'builder' | 'steward' | 'achiever' | 'connector' | 'protector' | 'challenger'
type PrimaryFear = 'wrong' | 'judgment' | 'loss' | 'missed' | 'safe' | 'irreversible'
type LifeStage   = 'building' | 'scaling' | 'transition' | 'legacy'
type RiskStance  = 'conservative' | 'balanced' | 'bold'

interface Props {
  authToken: string | null
  deviceId:  string | null
  onDone:    () => void   // called on save OR dismiss
}

// ── Config data ───────────────────────────────────────────────────────────────

const ARCHETYPES: { key: Archetype; label: string; desc: string }[] = [
  { key: 'builder',    label: 'The Builder',    desc: "Creating something that doesn't exist yet" },
  { key: 'steward',    label: 'The Steward',    desc: 'Protecting and growing what I\'ve been trusted with' },
  { key: 'achiever',   label: 'The Achiever',   desc: 'Optimising for outcomes and keeping score' },
  { key: 'connector',  label: 'The Connector',  desc: 'Decisions through relationships and what they signal' },
  { key: 'protector',  label: 'The Protector',  desc: 'Guard against loss before pursuing gain' },
  { key: 'challenger', label: 'The Challenger', desc: 'Tests assumptions and questions default paths' },
]

const FEARS: { key: PrimaryFear; label: string }[] = [
  { key: 'wrong',        label: 'Getting it wrong' },
  { key: 'judgment',     label: 'What others will think' },
  { key: 'loss',         label: 'Losing what I\'ve built' },
  { key: 'missed',       label: 'Missing the better path' },
  { key: 'safe',         label: 'Playing it too safe' },
  { key: 'irreversible', label: 'The irreversible mistake' },
]

const LIFE_STAGES: { key: LifeStage; label: string; sub: string }[] = [
  { key: 'building',    label: 'Building',    sub: 'Early growth, proving the model' },
  { key: 'scaling',     label: 'Scaling',     sub: 'Established, protecting and expanding' },
  { key: 'transition',  label: 'Transition',  sub: 'Major shift underway' },
  { key: 'legacy',      label: 'Legacy',      sub: 'Preserving, transferring, completing' },
]

const RISK_STANCES: { key: RiskStance; label: string; sub: string }[] = [
  { key: 'conservative', label: 'Conservative', sub: 'Protect before pursue' },
  { key: 'balanced',     label: 'Balanced',     sub: 'Weigh both sides' },
  { key: 'bold',         label: 'Bold',         sub: 'Bias toward action' },
]

const VALID_MBTI = [
  'INTJ','INTP','ENTJ','ENTP','INFJ','INFP','ENFJ','ENFP',
  'ISTJ','ISFJ','ESTJ','ESFJ','ISTP','ISFP','ESTP','ESFP',
]

// ── Component ─────────────────────────────────────────────────────────────────

export default function ProfileCaptureOverlay({ authToken, deviceId, onDone }: Props) {
  const [archetype,    setArchetype]    = useState<Archetype | null>(null)
  const [fears,        setFears]        = useState<PrimaryFear[]>([])
  const [mbti,         setMbti]         = useState('')
  const [mbtiValid,    setMbtiValid]    = useState<boolean | null>(null)
  const [lifeStage,    setLifeStage]    = useState<LifeStage | null>(null)
  const [riskStance,   setRiskStance]   = useState<RiskStance | null>(null)
  const [saving,       setSaving]       = useState(false)
  const [visible,      setVisible]      = useState(false)

  // Fade in
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 40)
    return () => clearTimeout(t)
  }, [])

  const toggleFear = (f: PrimaryFear) => {
    setFears(prev =>
      prev.includes(f)
        ? prev.filter(x => x !== f)
        : prev.length < 2 ? [...prev, f] : prev
    )
  }

  const handleMbtiChange = (v: string) => {
    const upper = v.toUpperCase()
    setMbti(upper)
    if (upper.length === 0) setMbtiValid(null)
    else setMbtiValid(VALID_MBTI.includes(upper))
  }

  const anyFilled = !!(archetype || fears.length || (mbtiValid === true) || lifeStage || riskStance)

  const dismiss = () => {
    try { localStorage.setItem('quorum_profile_overlay_shown', 'true') } catch {}
    setVisible(false)
    setTimeout(onDone, 220)
  }

  const handleSave = async () => {
    if (!authToken) {
      // Not authed — still dismiss; they can fill in from Mirror later
      dismiss()
      return
    }
    setSaving(true)
    try {
      await fetch('/api/profile', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          archetype:     archetype ?? null,
          primary_fears: fears.length ? fears : null,
          mbti_type:     mbtiValid ? mbti : null,
          life_stage:    lifeStage ?? null,
          risk_stance:   riskStance ?? null,
        }),
      })
    } catch { /* silent — profile save is best-effort */ }
    finally {
      try { localStorage.setItem('quorum_profile_overlay_shown', 'true') } catch {}
      setSaving(false)
      setVisible(false)
      setTimeout(onDone, 220)
    }
  }

  const selBtn = (active: boolean, accent: string = 'var(--gold)') => ({
    padding: '10px 13px',
    borderRadius: 9,
    border: `1px solid ${active ? accent : 'var(--border-dim)'}`,
    background: active ? `color-mix(in srgb, ${accent} 12%, transparent)` : 'transparent',
    textAlign: 'left' as const,
    cursor: 'pointer',
    fontFamily: 'inherit',
    transition: 'all 0.13s',
    width: '100%',
  })

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9000,
        background: 'rgba(0,0,0,0.72)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '16px',
        opacity: visible ? 1 : 0,
        transition: 'opacity 0.22s ease',
      }}
      onClick={e => { if (e.target === e.currentTarget) dismiss() }}
    >
      <div
        style={{
          background: 'var(--bg-raised)',
          border: '1px solid var(--border-dim)',
          borderRadius: 16,
          padding: '28px 26px 24px',
          width: '100%',
          maxWidth: 480,
          maxHeight: '92vh',
          overflowY: 'auto',
          transform: visible ? 'translateY(0)' : 'translateY(12px)',
          transition: 'transform 0.22s ease',
        }}
      >
        {/* Header */}
        <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--gold)', letterSpacing: '0.08em', marginBottom: 6, textTransform: 'uppercase' }}>
          Before you begin
        </p>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-1)', margin: '0 0 6px', lineHeight: 1.3 }}>
          Tell Quorum who&apos;s bringing this decision
        </h2>
        <p style={{ fontSize: 13, color: 'var(--text-3)', lineHeight: 1.55, margin: '0 0 24px' }}>
          The more the Council knows about you, the less it has to infer. All fields optional — skip anything that doesn&apos;t feel right yet.
        </p>

        {/* ── ARCHETYPE ──────────────────────────────────────────────────── */}
        <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-3)', letterSpacing: '0.06em', marginBottom: 10, textTransform: 'uppercase' }}>
          How do you see yourself as a decision-maker?
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7, marginBottom: 22 }}>
          {ARCHETYPES.map(a => (
            <button key={a.key} type="button" onClick={() => setArchetype(a.key === archetype ? null : a.key)} style={selBtn(archetype === a.key)}>
              <p style={{ fontSize: 12, fontWeight: 600, color: archetype === a.key ? 'var(--gold)' : 'var(--text-2)', marginBottom: 2 }}>
                {a.label}
              </p>
              <p style={{ fontSize: 10.5, color: 'var(--text-4)', lineHeight: 1.35 }}>
                {a.desc}
              </p>
            </button>
          ))}
        </div>

        {/* ── PRIMARY FEARS ──────────────────────────────────────────────── */}
        <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-3)', letterSpacing: '0.06em', marginBottom: 4, textTransform: 'uppercase' }}>
          What fears tend to show up in high-stakes decisions?
        </p>
        <p style={{ fontSize: 11, color: 'var(--text-4)', marginBottom: 10 }}>Pick up to 2.</p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7, marginBottom: 22 }}>
          {FEARS.map(f => {
            const selected = fears.includes(f.key)
            const disabled = !selected && fears.length >= 2
            return (
              <button
                key={f.key} type="button"
                onClick={() => !disabled && toggleFear(f.key)}
                style={{
                  ...selBtn(selected, '#8840c4'),
                  opacity: disabled ? 0.4 : 1,
                  cursor: disabled ? 'default' : 'pointer',
                }}
              >
                <p style={{ fontSize: 12, fontWeight: selected ? 600 : 400, color: selected ? '#b070e0' : 'var(--text-3)' }}>
                  {f.label}
                </p>
              </button>
            )
          })}
        </div>

        {/* ── LIFE STAGE ─────────────────────────────────────────────────── */}
        <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-3)', letterSpacing: '0.06em', marginBottom: 10, textTransform: 'uppercase' }}>
          Where are you right now?
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7, marginBottom: 22 }}>
          {LIFE_STAGES.map(s => (
            <button key={s.key} type="button" onClick={() => setLifeStage(s.key === lifeStage ? null : s.key)} style={selBtn(lifeStage === s.key, 'var(--green-text)')}>
              <p style={{ fontSize: 12, fontWeight: 600, color: lifeStage === s.key ? 'var(--green-text)' : 'var(--text-2)', marginBottom: 2 }}>
                {s.label}
              </p>
              <p style={{ fontSize: 10.5, color: 'var(--text-4)', lineHeight: 1.35 }}>{s.sub}</p>
            </button>
          ))}
        </div>

        {/* ── RISK STANCE ────────────────────────────────────────────────── */}
        <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-3)', letterSpacing: '0.06em', marginBottom: 10, textTransform: 'uppercase' }}>
          Your natural stance toward risk
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 7, marginBottom: 22 }}>
          {RISK_STANCES.map(r => (
            <button key={r.key} type="button" onClick={() => setRiskStance(r.key === riskStance ? null : r.key)} style={{ ...selBtn(riskStance === r.key, '#c04040'), textAlign: 'center' as const }}>
              <p style={{ fontSize: 12, fontWeight: 600, color: riskStance === r.key ? '#e06060' : 'var(--text-2)', marginBottom: 2 }}>
                {r.label}
              </p>
              <p style={{ fontSize: 10, color: 'var(--text-4)', lineHeight: 1.35 }}>{r.sub}</p>
            </button>
          ))}
        </div>

        {/* ── MBTI ───────────────────────────────────────────────────────── */}
        <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-3)', letterSpacing: '0.06em', marginBottom: 10, textTransform: 'uppercase' }}>
          MBTI type <span style={{ fontWeight: 400, textTransform: 'none', fontSize: 10.5 }}>— optional, if you know it</span>
        </p>
        <div style={{ position: 'relative', marginBottom: 26 }}>
          <input
            type="text"
            placeholder="e.g. INTJ"
            value={mbti}
            onChange={e => handleMbtiChange(e.target.value)}
            maxLength={4}
            style={{
              width: '100%',
              background: 'var(--bg)',
              border: `1px solid ${mbtiValid === false ? 'var(--error)' : mbtiValid === true ? 'var(--green-border)' : 'var(--border-dim)'}`,
              borderRadius: 8,
              padding: '10px 38px 10px 12px',
              fontSize: 14,
              fontFamily: 'var(--font-mono)',
              color: 'var(--text-1)',
              letterSpacing: '0.1em',
              boxSizing: 'border-box',
              outline: 'none',
            }}
          />
          {mbtiValid === true && (
            <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 14, color: 'var(--green-text)' }}>✓</span>
          )}
          {mbtiValid === false && (
            <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 13, color: 'var(--error)' }}>✗</span>
          )}
        </div>

        {/* ── CTA ────────────────────────────────────────────────────────── */}
        {!authToken && anyFilled && (
          <p style={{ fontSize: 12, color: 'var(--text-4)', marginBottom: 10, textAlign: 'center', lineHeight: 1.5 }}>
            Sign in to save your profile permanently. It will be waiting when you return.
          </p>
        )}
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="btn-primary"
          style={{ width: '100%', fontSize: 15, padding: '13px', marginBottom: 12 }}
        >
          {saving ? 'Saving…' : anyFilled ? "Let's go →" : "Skip for now →"}
        </button>
        <button
          type="button"
          onClick={dismiss}
          style={{
            width: '100%', background: 'none', border: 'none',
            fontSize: 12, color: 'var(--text-4)', cursor: 'pointer',
            fontFamily: 'inherit', padding: '4px',
          }}
        >
          Set up later from Mirror
        </button>
      </div>
    </div>
  )
}

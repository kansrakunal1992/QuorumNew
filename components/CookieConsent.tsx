'use client'
// components/CookieConsent.tsx
// ── Sprint 2 (S2-01) — In-App Cookie Consent Banner ──────────────────────────
//
// Shows on first app visit, after a short delay.
// Gates functional localStorage writes (device ID, session history) behind consent.
// Choices are stored in quorum_cookie_consent (strictly necessary — always allowed).
// Three paths: Accept All · Reject Non-Essential · Manage Preferences.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect } from 'react'

const CONSENT_KEY = 'quorum_cookie_consent'

interface ConsentState {
  necessary: true
  functional: boolean
  analytics: boolean
  ts: number
}

function readConsent(): ConsentState | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(CONSENT_KEY)
    return raw ? (JSON.parse(raw) as ConsentState) : null
  } catch { return null }
}

function writeConsent(s: ConsentState): void {
  try { localStorage.setItem(CONSENT_KEY, JSON.stringify(s)) } catch {}
}

export default function CookieConsent() {
  const [visible,    setVisible]    = useState(false)
  const [showPrefs,  setShowPrefs]  = useState(false)
  const [functional, setFunctional] = useState(true)
  const [analytics,  setAnalytics]  = useState(false)

  useEffect(() => {
    if (!readConsent()) {
      const t = setTimeout(() => setVisible(true), 900)
      return () => clearTimeout(t)
    }
  }, [])

  if (!visible) return null

  const accept = () => {
    writeConsent({ necessary: true, functional: true, analytics: false, ts: Date.now() })
    setVisible(false)
    setShowPrefs(false)
  }

  const reject = () => {
    writeConsent({ necessary: true, functional: false, analytics: false, ts: Date.now() })
    setVisible(false)
    setShowPrefs(false)
  }

  const savePrefs = () => {
    writeConsent({ necessary: true, functional, analytics, ts: Date.now() })
    setVisible(false)
    setShowPrefs(false)
  }

  return (
    <>
      {/* ── Preferences Modal ─────────────────────────────────────────────── */}
      {showPrefs && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9100,
          background: 'rgba(0,0,0,0.72)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 16,
        }}>
          <div style={{
            width: '100%', maxWidth: 420,
            background: 'var(--bg-card)',
            border: '1px solid var(--border-mid)',
            borderRadius: 16,
            boxShadow: '0 20px 60px rgba(0,0,0,0.55)',
            overflow: 'hidden',
          }}>
            {/* Header */}
            <div style={{
              padding: '18px 22px 14px',
              borderBottom: '1px solid var(--border-dim)',
              background: 'var(--bg-card-alt)',
            }}>
              <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-1)', margin: '0 0 4px' }}>
                Cookie Preferences
              </p>
              <p style={{ fontSize: 11.5, color: 'var(--text-4)', margin: 0, lineHeight: 1.55 }}>
                Manage how Quorum stores data on this device.
              </p>
            </div>

            {/* Toggles */}
            <div style={{ padding: '16px 22px', display: 'flex', flexDirection: 'column', gap: 16 }}>
              <ToggleRow
                label="Strictly Necessary"
                description="Theme preference and your consent choice. Required for the app to function — cannot be disabled."
                checked={true}
                locked
              />
              <ToggleRow
                label="Functional"
                description="Device ID and session history — allows your decision history to persist across visits and devices."
                checked={functional}
                onChange={setFunctional}
              />
              <ToggleRow
                label="Analytics"
                description="Aggregate usage signals to improve the product. No third-party ad networks or cross-site tracking."
                checked={analytics}
                onChange={setAnalytics}
              />
            </div>

            {/* Actions */}
            <div style={{
              padding: '12px 22px 18px',
              borderTop: '1px solid var(--border-dim)',
              display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap',
            }}>
              <button
                onClick={() => setShowPrefs(false)}
                style={{
                  padding: '8px 18px', borderRadius: 8,
                  border: '1px solid var(--border-mid)',
                  background: 'none', color: 'var(--text-3)',
                  fontSize: 12.5, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
                  transition: 'opacity 0.15s',
                }}
              >
                Back
              </button>
              <button
                onClick={savePrefs}
                style={{
                  padding: '8px 20px', borderRadius: 8,
                  border: '1px solid var(--gold-dim)',
                  background: 'rgba(201,168,76,0.12)', color: 'var(--gold)',
                  fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                  transition: 'opacity 0.15s',
                }}
              >
                Save preferences
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Consent Banner ────────────────────────────────────────────────── */}
      {!showPrefs && (
        <div style={{
          position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 9000,
          background: 'var(--bg-card)',
          borderTop: '1px solid var(--border-mid)',
          padding: '14px 24px',
          display: 'flex', alignItems: 'center',
          flexWrap: 'wrap', gap: 14,
          boxShadow: '0 -6px 32px rgba(0,0,0,0.38)',
          animation: 'qcbSlideIn 0.36s cubic-bezier(0.22,1,0.36,1) both',
        }}>
          <style>{`
            @keyframes qcbSlideIn {
              from { transform: translateY(100%); opacity: 0; }
              to   { transform: translateY(0);    opacity: 1; }
            }
          `}</style>

          <div style={{ flex: 1, minWidth: 220 }}>
            <p style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-1)', margin: '0 0 3px' }}>
              Quorum uses cookies
            </p>
            <p style={{ fontSize: 11.5, color: 'var(--text-4)', lineHeight: 1.55, margin: 0 }}>
              Strictly necessary cookies keep the app functional. Optional functional cookies
              remember your decision history across visits.{' '}
              <a
                href="/cookies"
                style={{ color: 'var(--text-3)', textDecoration: 'underline', textUnderlineOffset: 2 }}
              >
                Cookie Policy
              </a>
            </p>
          </div>

          <div style={{ display: 'flex', gap: 8, flexShrink: 0, flexWrap: 'wrap' }}>
            <button
              onClick={() => setShowPrefs(true)}
              style={{
                padding: '7px 14px', borderRadius: 7,
                border: '1px solid var(--border-mid)',
                background: 'none', color: 'var(--text-3)',
                fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
                whiteSpace: 'nowrap', transition: 'opacity 0.15s',
              }}
            >
              Manage
            </button>
            <button
              onClick={reject}
              style={{
                padding: '7px 14px', borderRadius: 7,
                border: '1px solid var(--border-mid)',
                background: 'none', color: 'var(--text-3)',
                fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
                whiteSpace: 'nowrap', transition: 'opacity 0.15s',
              }}
            >
              Reject non-essential
            </button>
            <button
              onClick={accept}
              style={{
                padding: '7px 16px', borderRadius: 7,
                border: '1px solid var(--gold-dim)',
                background: 'rgba(201,168,76,0.12)', color: 'var(--gold)',
                fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                whiteSpace: 'nowrap', transition: 'opacity 0.15s',
              }}
            >
              Accept all
            </button>
          </div>
        </div>
      )}
    </>
  )
}

// ── Toggle row sub-component ─────────────────────────────────────────────────

function ToggleRow({
  label, description, checked, onChange, locked,
}: {
  label: string
  description: string
  checked: boolean
  onChange?: (v: boolean) => void
  locked?: boolean
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
      <div style={{ flex: 1 }}>
        <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-2)', margin: '0 0 2px' }}>
          {label}
        </p>
        <p style={{ fontSize: 11.5, color: 'var(--text-4)', lineHeight: 1.5, margin: 0 }}>
          {description}
        </p>
      </div>
      <button
        onClick={() => !locked && onChange?.(!checked)}
        aria-checked={checked}
        role="switch"
        aria-label={label}
        style={{
          flexShrink: 0,
          width: 38, height: 22, borderRadius: 11,
          background: checked ? 'var(--gold)' : 'var(--border-mid)',
          border: 'none',
          cursor: locked ? 'not-allowed' : 'pointer',
          position: 'relative',
          transition: 'background 0.22s',
          opacity: locked ? 0.5 : 1,
          marginTop: 2,
          padding: 0,
        }}
      >
        <span style={{
          position: 'absolute', top: 3,
          left: checked ? 19 : 3,
          width: 16, height: 16, borderRadius: '50%',
          background: '#fff',
          transition: 'left 0.22s',
          boxShadow: '0 1px 3px rgba(0,0,0,0.30)',
          display: 'block',
        }} />
      </button>
    </div>
  )
}

'use client'
// app/settings/notifications/page.tsx
// -- Phase 4 (retention work) -- Notification preferences ----------------------
// One place to control how Quorum brings decisions back to you. Until now the
// only control was the one-click unsubscribe link inside each email.
//
//  - "How should Quorum bring decisions back to you?" -- the same three choices
//    as the card shown after the second decision (lib/habit-prefs.ts).
//  - Per-kind switches for the other emails. Switch ON = you receive them.
//
// Changes save immediately. Review-date reminders are not listed: each one is
// tied to a date you chose for a specific decision, not to a general setting.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase'
import SettingsNav from '@/components/SettingsNav'
import SettingsCard from '@/components/SettingsCard'
import { CADENCES } from '@/lib/habit-prefs'

interface Prefs {
  brief_cadence:              string | null
  daily_nudge_opted_out:      boolean
  validation_nudge_opted_out: boolean
  weekly_brief_opted_out:     boolean
  pattern_notice_opted_out:   boolean
}

const CADENCE_HELP: Record<string, string> = {
  weekly:     "A short note on Sundays: anything you're weighing, plus what you've parked.",
  when_stuck: "No weekly note. Quorum still checks in if a decision stalls or you've been away for a while.",
  big_only:   "No weekly note and no \u201Cyou've been away\u201D nudges. Reminders for review dates you set still arrive.",
}

const SWITCHES: { key: keyof Pick<Prefs, 'pattern_notice_opted_out' | 'validation_nudge_opted_out' | 'daily_nudge_opted_out'>; title: string; help: string }[] = [
  { key: 'pattern_notice_opted_out',   title: 'When Quorum notices something',  help: 'A short email when a new pattern shows up across your decisions.' },
  { key: 'validation_nudge_opted_out', title: 'Check-ins on past decisions',     help: 'A prompt to log how a decision turned out.' },
  { key: 'daily_nudge_opted_out',      title: "Nudges when you've been away",    help: 'A gentle note if you have not logged a decision for a while.' },
]

export default function NotificationSettingsPage() {
  const [token,   setToken]   = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [prefs,   setPrefs]   = useState<Prefs | null>(null)
  const [status,  setStatus]  = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const { data: { session } } = await createClient().auth.getSession()
        const t = session?.access_token ?? null
        if (cancelled) return
        setToken(t)
        if (t) {
          const res = await fetch('/api/preferences/notifications', { headers: { Authorization: `Bearer ${t}` } })
          if (res.ok && !cancelled) setPrefs(await res.json())
        }
      } catch { /* shows the signed-out / error state */ }
      finally { if (!cancelled) setLoading(false) }
    })()
    return () => { cancelled = true }
  }, [])

  async function save(patch: Partial<Prefs>) {
    if (!token || !prefs) return
    const before = prefs
    setPrefs({ ...prefs, ...patch, ...(patch.brief_cadence === 'weekly' ? { weekly_brief_opted_out: false } : {}) })
    setStatus('saving')
    try {
      const res = await fetch('/api/preferences/notifications', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    JSON.stringify(patch),
      })
      if (!res.ok) throw new Error(String(res.status))
      setStatus('saved')
    } catch {
      setPrefs(before)
      setStatus('error')
    }
  }

  const row: React.CSSProperties = { display: 'flex', alignItems: 'flex-start', gap: 12, padding: '12px 0', borderTop: '1px solid var(--border-dim)', cursor: 'pointer' }

  return (
    <main style={{ minHeight: '100dvh', padding: '48px 20px 80px', background: 'var(--bg-void)' }}>
      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        <Link href="/" style={{ display: 'inline-flex', gap: 6, fontSize: 11, color: 'var(--text-4)', fontFamily: 'var(--font-mono)', letterSpacing: '0.08em', textDecoration: 'none', marginBottom: 32 }}>
          &larr; Back to Quorum
        </Link>

        <div style={{ marginBottom: 28 }}>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--text-4)', margin: '0 0 10px' }}>Settings</p>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(24px, 3.5vw, 34px)', fontWeight: 400, letterSpacing: '-0.02em', color: 'var(--text-1)', margin: 0, lineHeight: 1.2 }}>
            Notifications
          </h1>
        </div>

        <SettingsNav active="notifications" />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 24 }}>
          {loading ? (
            <p style={{ fontSize: 13, color: 'var(--text-4)', fontFamily: 'var(--font-mono)' }}>Loading...</p>
          ) : !token || !prefs ? (
            <SettingsCard title="Sign in to manage notifications">
              <p style={{ fontSize: 13.5, color: 'var(--text-3)', lineHeight: 1.6, margin: '0 0 14px' }}>
                Notifications go to the email on your Quorum record, so you need to be connected to change them.
              </p>
              <Link href="/mirror" style={{ fontSize: 13, color: 'var(--gold)', textDecoration: 'none' }}>Connect your email &rarr;</Link>
            </SettingsCard>
          ) : (
            <>
              <SettingsCard title="How should Quorum bring decisions back to you?">
                {CADENCES.map((c, i) => {
                  const selected = prefs.brief_cadence === c.id && !(c.id === 'weekly' && prefs.weekly_brief_opted_out)
                  return (
                    <label key={c.id} style={{ ...row, borderTop: i === 0 ? 'none' : row.borderTop, paddingTop: i === 0 ? 0 : 12 }}>
                      <input
                        type="radio"
                        name="cadence"
                        checked={selected}
                        onChange={() => save({ brief_cadence: c.id })}
                        style={{ marginTop: 4, accentColor: 'var(--gold)' }}
                      />
                      <span>
                        <span style={{ display: 'block', fontSize: 14, color: 'var(--text-1)' }}>{c.label}</span>
                        <span style={{ display: 'block', fontSize: 12.5, color: 'var(--text-4)', lineHeight: 1.5, marginTop: 2 }}>{CADENCE_HELP[c.id]}</span>
                      </span>
                    </label>
                  )
                })}
                {prefs.weekly_brief_opted_out && (
                  <p style={{ fontSize: 12, color: 'var(--text-4)', margin: '12px 0 0' }}>
                    You unsubscribed from the weekly note. Choosing Weekly turns it back on.
                  </p>
                )}
              </SettingsCard>

              <SettingsCard title="Other emails">
                {SWITCHES.map((s, i) => {
                  const on = !prefs[s.key]
                  return (
                    <label key={s.key} style={{ ...row, borderTop: i === 0 ? 'none' : row.borderTop, paddingTop: i === 0 ? 0 : 12 }}>
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => save({ [s.key]: on } as Partial<Prefs>)}
                        style={{ marginTop: 4, accentColor: 'var(--gold)' }}
                      />
                      <span>
                        <span style={{ display: 'block', fontSize: 14, color: 'var(--text-1)' }}>{s.title}</span>
                        <span style={{ display: 'block', fontSize: 12.5, color: 'var(--text-4)', lineHeight: 1.5, marginTop: 2 }}>{s.help}</span>
                      </span>
                    </label>
                  )
                })}
              </SettingsCard>

              <p style={{ fontSize: 12, color: 'var(--text-4)', margin: 0, minHeight: 18 }} role="status">
                {status === 'saving' ? 'Saving\u2026' : status === 'saved' ? 'Saved.' : status === 'error' ? 'Could not save. Try again.' : ''}
              </p>
            </>
          )}
        </div>
      </div>
    </main>
  )
}

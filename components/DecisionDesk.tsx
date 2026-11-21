'use client'

// components/DecisionDesk.tsx
// ── v15 Phase 2: the Decision Desk ───────────────────────────────────────────
//
// The recurring home for anyone with decisions on this device or account. It lives inside the natural-intake front door
// (components/ChatIntake.tsx) so "bring a decision" is always one box away; it is NOT a separate dashboard route.
//
// Two exports, because the "bring a decision" box sits BETWEEN them:
//   DeskTop   the one-line state of things, plus any check-ins that are due. Due check-ins come first because they are the
//             reason Quorum asked the person to set a date, and the one thing here that needs them today.
//   DeskBody  examined-but-undecided, saved-but-not-examined, waiting-for-a-check-in, one honest cross-decision line, and
//             how much evidence the record has so far.
//
// What this deliberately is not: a task board. No priorities, no columns, no overdue-red, no streaks, no counts of "things to
// do". Dates shown are only the review dates the person chose. Everything is derived by lib/desk.ts from fields that already
// exist; the only network call is the existing cross-decision line (counts-only, no decision text).
//
// Parked items (the Watchlist) and the full record (JudgmentRecordStrip, with delete and share) stay where they were on the
// front door, directly below this.

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { deskHeadline, formatWhen, recordStage } from '@/lib/desk'
import type { DeskItem, DeskModel } from '@/lib/desk'
import { track } from '@/lib/track'

const MAX_PER_SECTION = 3

const cardStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
  padding: '12px 14px', minHeight: 56, boxSizing: 'border-box', width: '100%',
  background: 'var(--bg-card)', border: '1px solid var(--border-dim)', borderRadius: 12,
  textDecoration: 'none', color: 'inherit', textAlign: 'left',
}

const sectionLabel: React.CSSProperties = {
  fontSize: 12.5, color: 'var(--text-3)', margin: '0 0 8px', letterSpacing: '0.01em',
}

function snippet(text: string, n = 110): string {
  const t = (text || '').trim().replace(/\s+/g, ' ')
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t
}

/** "Check-in today", "Check-in was due 3 days ago", "Check-in in 5 days", "Check-in on 3 Dec". */
function checkInLabel(item: DeskItem): string {
  const d = item.dueInDays
  if (d === null) return 'Decided'
  if (d < 0) return `Check-in was due ${formatWhen(d, item.session.commitment_review_date)}`
  return `Check-in ${formatWhen(d, item.session.commitment_review_date)}`
}

type Section = 'due' | 'open' | 'unexamined' | 'waiting'

function rowCopy(item: DeskItem, section: Section): { meta: string; cta: string; href: string } {
  const id = item.session.id
  switch (section) {
    case 'due':        return { meta: checkInLabel(item),            cta: 'How did it go?', href: `/record/${id}#outcome` }
    case 'open':       return { meta: 'Examined · not decided yet',  cta: 'Decide',         href: `/session/${id}` }
    case 'unexamined': return { meta: 'Saved · not examined yet',    cta: 'Examine it',     href: `/session/${id}` }
    case 'waiting':    return { meta: checkInLabel(item),            cta: 'Open',           href: `/record/${id}` }
  }
}

function DeskRow({ item, section }: { item: DeskItem; section: Section }) {
  const { meta, cta, href } = rowCopy(item, section)
  return (
    <Link
      href={href}
      style={cardStyle}
      onClick={() => track('desk_card_clicked', { section, action: 'open' }, { sessionId: item.session.id })}
    >
      <span style={{ minWidth: 0, flex: 1 }}>
        <span style={{ display: 'block', fontSize: 14.5, lineHeight: 1.4, color: 'var(--text-1)' }}>
          {snippet(item.session.decision_text)}
        </span>
        <span style={{ display: 'block', fontSize: 12, color: 'var(--text-3)', marginTop: 3 }}>{meta}</span>
      </span>
      <span style={{ fontSize: 12.5, color: 'var(--gold)', whiteSpace: 'nowrap', fontWeight: 600 }}>{cta}</span>
    </Link>
  )
}

function RowGroup({ title, items, section }: { title: string; items: DeskItem[]; section: Section }) {
  if (items.length === 0) return null
  const shown = items.slice(0, MAX_PER_SECTION)
  const rest = items.length - shown.length
  return (
    <div style={{ width: '100%' }}>
      <p style={sectionLabel}>{title}</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {shown.map(it => <DeskRow key={it.session.id} item={it} section={section} />)}
      </div>
      {rest > 0 && (
        <p style={{ fontSize: 11.5, color: 'var(--text-4)', margin: '8px 0 0' }}>
          and {rest} more in your record below
        </p>
      )}
    </div>
  )
}

// ── Top: headline + due check-ins ────────────────────────────────────────────
export function DeskTop({ model }: { model: DeskModel }) {
  const tracked = useRef(false)
  useEffect(() => {
    if (tracked.current) return
    tracked.current = true
    track('desk_viewed', {
      due_count: model.due.length, open_count: model.open.length, waiting_count: model.waiting.length,
      unexamined_count: model.unexamined.length, total_count: model.total,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div style={{ width: '100%', maxWidth: 440, textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, letterSpacing: '0.05em', color: 'var(--text-4)', margin: '0 0 8px' }}>
          Your desk
        </p>
        <h1 style={{
          fontFamily: 'var(--font-display)', fontWeight: 400, fontSize: 'clamp(22px, 5.6vw, 28px)',
          lineHeight: 1.3, color: 'var(--text-1)', margin: 0,
        }}>
          {deskHeadline(model)}
        </h1>
      </div>
      <RowGroup title="Ready for a check-in" items={model.due} section="due" />
    </div>
  )
}

// ── One cross-decision line, honestly labelled ───────────────────────────────
function Noticed({ latestId, total }: { latestId: string | null; total: number }) {
  const [obs, setObs] = useState<{ line: string; kind: string } | null>(null)

  useEffect(() => {
    if (!latestId || total < 2) return
    let cancelled = false
    fetch(`/api/session/${latestId}/cross-decision`)
      .then(r => r.json())
      .then(d => {
        if (cancelled || !d?.line) return
        setObs({ line: String(d.line), kind: String(d.kind ?? 'none') })
        track('observation_seen', { kind: d.kind, n: d.decisionCount ?? total, surface: 'desk' })
      })
      .catch(() => { /* nothing to show is fine */ })
    return () => { cancelled = true }
  }, [latestId, total])

  if (!obs) return null
  return (
    <div style={{ ...cardStyle, display: 'block', borderColor: 'var(--gold-dim)' }}>
      <p style={{ fontSize: 11, letterSpacing: '0.06em', color: 'var(--text-4)', margin: '0 0 6px' }}>
        {total < 5 ? 'Quorum noticed · early' : 'Quorum noticed'}
      </p>
      <p style={{ fontSize: 14.5, lineHeight: 1.5, color: 'var(--text-1)', margin: 0 }}>{obs.line}</p>
      <p style={{ fontSize: 11.5, color: 'var(--text-4)', margin: '8px 0 0' }}>
        {total < 5
          ? 'A count across your decisions, not yet a pattern.'
          : 'A count across your decisions.'}
      </p>
    </div>
  )
}

// ── Body: everything else on the desk ────────────────────────────────────────
export function DeskBody({ model, mirrorUnlocked, signedIn = true }: { model: DeskModel; mirrorUnlocked: boolean; signedIn?: boolean }) {
  const latestId = [...model.due, ...model.open, ...model.unexamined, ...model.waiting, ...model.closed]
    .sort((a, b) => (a.session.created_at < b.session.created_at ? 1 : -1))[0]?.session.id ?? null
  const stage = recordStage(model.total)

  return (
    <div style={{ width: '100%', maxWidth: 440, textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 18, marginTop: 8 }}>
      <RowGroup title="Examined, not decided" items={model.open} section="open" />
      <RowGroup title="Saved, not examined" items={model.unexamined} section="unexamined" />
      <RowGroup title="Waiting for a check-in" items={model.waiting} section="waiting" />

      <Noticed latestId={latestId} total={model.total} />

      <div style={{ ...cardStyle, display: 'block' }}>
        <p style={{ fontSize: 11, letterSpacing: '0.06em', color: 'var(--text-4)', margin: '0 0 6px' }}>
          Your record · {stage.label}
        </p>
        <p style={{ fontSize: 13.5, lineHeight: 1.55, color: 'var(--text-2)', margin: '0 0 10px' }}>{stage.line}</p>
        {/* v15: the Desk works without an account for anyone this browser can recognise. Say where it lives; the optional
            sign-in panel further down is how it follows them to another device. Never a requirement to see this screen. */}
        {!signedIn && (
          <p style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--text-4)', margin: '0 0 10px' }}>
            Your decisions are saved on this device. Sign in if you want them on other devices too.
          </p>
        )}
        <Link
          href="/mirror"
          onClick={() => track('nav_clicked', { to: 'mirror', surface: 'desk' })}
          style={{ fontSize: 13, color: 'var(--gold)', textDecoration: 'none', fontWeight: 600, display: 'inline-block', minHeight: 32, lineHeight: '32px' }}
        >
          {mirrorUnlocked ? 'Open your Mirror' : 'See how the Mirror works'}
        </Link>
      </div>
    </div>
  )
}

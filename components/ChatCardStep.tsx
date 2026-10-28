'use client'
// components/ChatCardStep.tsx
// -- Natural Intake (v9, widened in v11) -- one chat step, up to THREE related card groups ----
//
// A step is ONE assistant message. The first card group answers the question in the bubble above it. When the server
// pairs it with related, still-essential questions ("companions"), each opens in place once the one before it is
// answered -- progressive disclosure, not a form: the person only ever sees one group at a time, answered groups
// collapse to one line they can reopen, and everything is sent as ONE reply (one round trip instead of up to three).
// A step with no companion behaves exactly like a single ChatCardGroup.
//
// Mobile: a single column, collapsed answers are one tappable line, focus moves to the new question and a polite live
// region announces it.

import { useEffect, useRef, useState } from 'react'
import type { ChatCardGroup as CardGroupSpec } from '@/lib/types'
import ChatCardGroup from '@/components/ChatCardGroup'
import { serializeSelection } from '@/lib/chat-intake-cards'
import type { CardSelection } from '@/lib/chat-intake-cards'

interface Props {
  primary:         CardGroupSpec
  companion:       CardGroupSpec | null
  /** v11: a third group, opened after the second. */
  companion2?:     CardGroupSpec | null
  /** Called ONCE with everything the person entered for this step (a missing group is null). */
  onSubmit:        (primarySel: CardSelection, companionSel: CardSelection | null, companion2Sel: CardSelection | null) => void
  onFreeTextOpen?: (group: CardGroupSpec) => void
  onTap?:          () => void
  /** Called when a further group opens (analytics: counts only). */
  onCompanionShown?: (group: CardGroupSpec) => void
  /** Restores entries after a failed send. */
  initialPrimary?:    CardSelection | null
  initialCompanion?:  CardSelection | null
  initialCompanion2?: CardSelection | null
}

export default function ChatCardStep({
  primary, companion, companion2 = null, onSubmit, onFreeTextOpen, onTap, onCompanionShown,
  initialPrimary, initialCompanion, initialCompanion2,
}: Props) {
  const groups: CardGroupSpec[] = [primary, companion, companion2].filter((g): g is CardGroupSpec => !!g)
  const last = groups.length - 1
  const initials = [initialPrimary, initialCompanion, initialCompanion2].slice(0, groups.length)

  // After a failed send every group but the last was answered; the last shows again with its own selection restored.
  const restored = last > 0 && initials.every(Boolean)
  const [sels, setSels] = useState<(CardSelection | null)[]>(() => groups.map((_, i) => (restored && i < last ? initials[i] ?? null : null)))
  const [reached, setReached] = useState<number>(restored ? last : 0)       // highest group that has been opened (stays mounted)
  const [announce, setAnnounce] = useState('')
  const headingRef = useRef<HTMLDivElement>(null)

  // The group being asked right now: the first one not yet answered.
  const firstOpen = sels.findIndex(s => !s)
  const current   = firstOpen === -1 ? last : firstOpen

  // Announce (and report, counts only) each further group the FIRST time it opens.
  const announcedUpTo = useRef(restored ? last : 0)
  useEffect(() => {
    setReached(r => Math.max(r, current))
    if (current > announcedUpTo.current) {
      announcedUpTo.current = current
      const g = groups[current]
      if (!g) return
      setAnnounce(`Next question: ${g.title}`)
      onCompanionShown?.(g)
      setTimeout(() => headingRef.current?.focus(), 0)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current])

  if (groups.length === 1) {
    return <ChatCardGroup group={primary} initial={initialPrimary} onTap={onTap} onFreeTextOpen={() => onFreeTextOpen?.(primary)} onSubmit={sel => onSubmit(sel, null, null)} />
  }

  function submitAt(i: number, sel: CardSelection) {
    const next = sels.map((s, j) => (j === i ? sel : s))
    setSels(next)
    // Answering the LAST group with every earlier one answered sends the whole step.
    if (i === last && next.slice(0, last).every(Boolean)) onSubmit(next[0] as CardSelection, next[1] ?? null, next[2] ?? null)
  }

  // Every group stays MOUNTED once opened and is only hidden: tapping "Change" on an earlier answer must bring it back with
  // every selection and typed word intact, and must not wipe what was already entered in a later group.
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignSelf: 'stretch', maxWidth: '100%' }}>
      {groups.map((g, i) => {
        const sel = sels[i]
        const isCurrent = i === current
        const summary = sel ? serializeSelection(g, sel) : ''
        const mounted = i <= Math.max(reached, current)
        return (
          <div key={g.questionId + ':' + i} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {sel && i < last && (
              <button
                type="button"
                onClick={() => setSels(prev => prev.map((s, j) => (j === i ? null : s)))}
                aria-label={`Your answer so far: ${summary}. Change it.`}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', width: '100%', minHeight: 44,
                  padding: '9px 14px', borderRadius: 14, border: '1px solid var(--border-mid)', background: 'var(--bg-card)',
                  color: 'var(--text-2)', fontSize: 14.5, cursor: 'pointer',
                }}
              >
                <span aria-hidden="true" style={{ fontWeight: 700, color: 'var(--gold)' }}>{'\u2713'}</span>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{summary}</span>
                <span style={{ fontSize: 13, color: 'var(--text-3)', textDecoration: 'underline' }}>Change</span>
              </button>
            )}
            {mounted && (
              <div ref={i === current && i > 0 ? headingRef : undefined} tabIndex={i === current && i > 0 ? -1 : undefined} hidden={!isCurrent} style={{ outline: 'none' }}>
                <ChatCardGroup
                  group={g}
                  showTitle={i > 0}
                  initial={i === last ? initials[i] : i === 0 ? initialPrimary : undefined}
                  onTap={onTap}
                  onFreeTextOpen={() => onFreeTextOpen?.(g)}
                  onSubmit={s => submitAt(i, s)}
                />
              </div>
            )}
          </div>
        )
      })}
      <div aria-live="polite" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>{announce}</div>
    </div>
  )
}

'use client'
// components/ChatCardStep.tsx
// ── Natural Intake (v9) — one chat step, up to two related card groups ───────
//
// A step is ONE assistant message. The first card group answers the question in
// the bubble above it. When the server pairs it with a related, still-essential
// question (a "companion"), that group opens in place once the first is answered —
// progressive disclosure, not a form: the person never sees two groups at once,
// the first collapses to one line they can reopen, and everything is sent as ONE
// reply. A step with no companion behaves exactly like a single ChatCardGroup.
//
// Mobile: a single column, the collapsed first answer is one tappable line, focus
// moves to the new question and a polite live region announces it.

import { useEffect, useRef, useState } from 'react'
import type { ChatCardGroup as CardGroupSpec } from '@/lib/types'
import ChatCardGroup from '@/components/ChatCardGroup'
import { serializeSelection } from '@/lib/chat-intake-cards'
import type { CardSelection } from '@/lib/chat-intake-cards'

interface Props {
  primary:         CardGroupSpec
  companion:       CardGroupSpec | null
  /** Called ONCE with everything the person entered for this step. */
  onSubmit:        (primarySel: CardSelection, companionSel: CardSelection | null) => void
  onFreeTextOpen?: (group: CardGroupSpec) => void
  onTap?:          () => void
  /** Called when the second group opens (analytics: counts only). */
  onCompanionShown?: (group: CardGroupSpec) => void
  /** Restores entries after a failed send. */
  initialPrimary?:   CardSelection | null
  initialCompanion?: CardSelection | null
}

export default function ChatCardStep({ primary, companion, onSubmit, onFreeTextOpen, onTap, onCompanionShown, initialPrimary, initialCompanion }: Props) {
  const [firstSel, setFirstSel] = useState<CardSelection | null>(initialCompanion && initialPrimary ? initialPrimary : null)
  const [secondMounted, setSecondMounted] = useState<boolean>(!!(initialCompanion && initialPrimary))
  const [announce, setAnnounce] = useState('')
  const headingRef = useRef<HTMLDivElement>(null)
  const open2 = !!companion && !!firstSel

  useEffect(() => {
    if (!open2 || !companion) return
    setSecondMounted(true)
    setAnnounce(`Next question: ${companion.title}`)
    onCompanionShown?.(companion)
    setTimeout(() => headingRef.current?.focus(), 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open2])

  if (!companion) {
    return <ChatCardGroup group={primary} initial={initialPrimary} onTap={onTap} onFreeTextOpen={() => onFreeTextOpen?.(primary)} onSubmit={sel => onSubmit(sel, null)} />
  }

  const summary = firstSel ? serializeSelection(primary, firstSel) : ''
  // Both groups stay MOUNTED once opened and are only hidden: tapping "Change" on the first answer must bring it back with
  // every selection and typed word intact, and must not wipe what was already entered in the second group.
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignSelf: 'stretch', maxWidth: '100%' }}>
      <div hidden={!!firstSel}>
        <ChatCardGroup group={primary} initial={initialPrimary} onTap={onTap} onFreeTextOpen={() => onFreeTextOpen?.(primary)} onSubmit={sel => setFirstSel(sel)} />
      </div>
      {firstSel && (
        <button
          type="button"
          onClick={() => setFirstSel(null)}
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
      {secondMounted && (
        <div ref={headingRef} tabIndex={-1} hidden={!firstSel} style={{ outline: 'none' }}>
          <ChatCardGroup
            group={companion}
            showTitle
            initial={initialCompanion}
            onTap={onTap}
            onFreeTextOpen={() => onFreeTextOpen?.(companion)}
            onSubmit={sel => { if (firstSel) onSubmit(firstSel, sel) }}
          />
        </div>
      )}
      <div aria-live="polite" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>{announce}</div>
    </div>
  )
}

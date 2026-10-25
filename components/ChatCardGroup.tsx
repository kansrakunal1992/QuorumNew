'use client'
// components/ChatCardGroup.tsx
// ── Natural Intake (v8) — selectable answer cards INSIDE the chat ────────────
//
// Rendered under Quorum's latest question when the server sent a card group
// (lib/chat-intake-cards.ts). It is a normal chat affordance, not a form: the
// question is already in the chat bubble above, the cards are the quick way to
// answer it, and typing in the message box below always still works.
//
// What a person can do here:
//   • tap one card (single-select) or several (multi-select, with the group's
//     minimum / maximum), or none;
//   • add context in their own words — in this group, no separate screen;
//   • say "None of these fit" (then their own words are the answer), "Not sure",
//     "Prefer not to say" (sensitive questions only) or "Skip for now"
//     (non-essential questions only).
//
// Accessibility: native radio / checkbox inputs inside a labelled fieldset (so
// screen readers announce the kind of control and the group's name), the rule
// is announced via aria-describedby, the count via a polite live region, errors
// via role="alert". Selection is shown by a check mark and a heavier border —
// never by colour alone. Cards wrap to one column on narrow screens (usable at
// 320 px and at 200 % zoom) and the free-text box uses 16 px type so mobile
// browsers don't zoom on focus. Typed text survives the keyboard closing
// because it lives in component state, not in the DOM node.

import { useId, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { ChatCardGroup } from '@/lib/types'
import {
  NONE_FIT_LABEL, NONE_FIT_TEXT_LABEL, NOT_SURE_LABEL, PREFER_NOT_LABEL, SKIP_LABEL,
  validateSelection,
} from '@/lib/chat-intake-cards'
import type { CardSelection, CardSpecial } from '@/lib/chat-intake-cards'

interface Props {
  group:           ChatCardGroup
  onSubmit:        (sel: CardSelection) => void
  /** Fired once per open of the free-text box (analytics only — never receives the text). */
  onFreeTextOpen?: () => void
  /** Restores what the person had entered if sending failed (so a network blip never costs them their typing). */
  initial?:        CardSelection | null
  /** v9: show the question as a visible heading (used for the second group of a combined step, whose question is not in the chat bubble). */
  showTitle?:      boolean
  /** v9: fired on every card tap / special button (analytics counts effort — never what was tapped). */
  onTap?:          () => void
}

const visuallyHidden: CSSProperties = {
  position: 'absolute', width: 1, height: 1, margin: -1, padding: 0, overflow: 'hidden',
  clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0,
}

export default function ChatCardGroup({ group, onSubmit, onFreeTextOpen, initial, showTitle, onTap }: Props) {
  const uid = useId()
  const single = group.maxSelections === 1
  const [selected, setSelected]   = useState<string[]>(initial?.special ? [] : (initial?.selectedIds ?? []))
  const [special, setSpecial]     = useState<CardSpecial>(initial?.special === 'none_fit' ? 'none_fit' : null)
  const [text, setText]           = useState(initial?.freeText ?? '')
  const [textOpen, setTextOpen]   = useState(!!initial?.freeText)
  const [error, setError]         = useState<string | null>(null)
  const [focusId, setFocusId]     = useState<string | null>(null)
  const textRef = useRef<HTMLTextAreaElement>(null)
  const pointerRef = useRef(false)

  const current: CardSelection = useMemo(() => ({ selectedIds: selected, freeText: text, special }), [selected, text, special])
  const check = useMemo(() => validateSelection(group, current), [group, current])
  const exclusiveIds = useMemo(() => new Set(group.options.filter(o => o.exclusive).map(o => o.id)), [group.options])

  function openText(focus: boolean) {
    if (!textOpen) { setTextOpen(true); onFreeTextOpen?.() }
    if (focus) setTimeout(() => textRef.current?.focus(), 0)
  }

  function toggle(id: string, pointer: boolean) {
    setError(null)
    onTap?.()
    const has = selected.includes(id)
    let next: string[]
    if (has) next = selected.filter(x => x !== id)
    else if (single) next = [id]
    else if (exclusiveIds.has(id)) next = [id]
    else {
      const base = selected.filter(x => !exclusiveIds.has(x))
      if (group.maxSelections !== null && base.length >= group.maxSelections) {
        setError(`You can choose up to ${group.maxSelections}. Untick one to change it.`)
        return
      }
      next = [...base, id]
    }
    setSpecial(null)
    setSelected(next)
    // A single-select tap with nothing else typed is a complete answer — same speed as a plain chip.
    // Pointer only (event.detail > 0): arrow-keying through radios must not submit.
    if (single && !has && pointer && !text.trim() && !textOpen) {
      onSubmit({ selectedIds: next, freeText: '', special: null })
    }
  }

  function pickNoneFit() {
    setError(null)
    if (special === 'none_fit') { setSpecial(null); return }
    onTap?.()
    setSelected([]); setSpecial('none_fit'); openText(true)
  }

  function immediate(kind: Exclude<CardSpecial, 'none_fit' | null>) {
    onTap?.()
    onSubmit({ selectedIds: [], freeText: '', special: kind })
  }

  function submit() {
    if (!check.ok) { setError(check.error ?? 'Pick one, or add a few words of your own.'); return }
    onSubmit(current)
  }

  const count = selected.length
  const status = special === 'none_fit'
    ? 'None of these fit. Tell me in your own words.'
    : `${count} selected.${group.minSelections > 1 && count < group.minSelections ? ` Choose at least ${group.minSelections}.` : ''}`

  const card = (isSel: boolean, isFocus: boolean): CSSProperties => ({
    display: 'flex', alignItems: 'center', gap: 10, minHeight: 48, padding: '11px 14px',
    borderRadius: 14, cursor: 'pointer', textAlign: 'left', fontSize: 15, lineHeight: 1.35,
    border: isSel ? '2px solid var(--gold)' : '1px solid var(--border-mid)',
    // 2px vs 1px border: keep the box size steady so cards don't jump when ticked.
    margin: isSel ? 0 : 1,
    background: isSel ? 'var(--gold-dim)' : 'var(--bg-card)',
    color: isSel ? 'var(--text-1)' : 'var(--text-2)',
    outline: isFocus ? '2px solid var(--gold)' : 'none', outlineOffset: 2,
    position: 'relative',
  })
  const mark = (isSel: boolean): CSSProperties => ({
    flex: '0 0 auto', width: 20, height: 20, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    borderRadius: single ? 999 : 6, fontSize: 13, fontWeight: 700, lineHeight: 1,
    border: isSel ? '2px solid var(--gold)' : '1.5px solid var(--border-mid)',
    background: isSel ? 'var(--gold)' : 'transparent',
    color: isSel ? 'var(--bg-card)' : 'transparent',
  })
  const pill = (on = false): CSSProperties => ({
    padding: '9px 14px', minHeight: 40, borderRadius: 999, fontSize: 14.5, lineHeight: 1.3, cursor: 'pointer',
    border: on ? '2px solid var(--gold)' : '1px dashed var(--border-mid)',
    background: on ? 'var(--gold-dim)' : 'var(--bg-card)',
    color: on ? 'var(--text-1)' : 'var(--text-3)',
  })

  const hintId = `${uid}-hint`, statusId = `${uid}-status`, textId = `${uid}-text`, countId = `${uid}-count`, errId = `${uid}-err`

  return (
    <fieldset
      aria-describedby={`${hintId} ${error ? errId : ''}`.trim()}
      style={{ border: 'none', margin: 0, padding: 0, minWidth: 0, alignSelf: 'stretch', maxWidth: '100%', display: 'flex', flexDirection: 'column', gap: 10 }}
    >
      <legend style={showTitle ? { fontSize: 15, fontWeight: 500, color: 'var(--text-1)', padding: 0, marginBottom: 2 } : visuallyHidden}>{group.title}</legend>
      <p id={hintId} style={{ margin: 0, fontSize: 13.5, color: 'var(--text-3)' }}>{group.instruction}</p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 230px), 1fr))', gap: 8 }}>
        {group.options.map(o => {
          const isSel = selected.includes(o.id)
          const id = `${uid}-${o.id}`
          return (
            <label key={o.id} htmlFor={id} style={card(isSel, focusId === id)}>
              <input
                id={id}
                type={single ? 'radio' : 'checkbox'}
                name={`${uid}-group`}
                checked={isSel}
                // Native change handling (no preventDefault — it desyncs controlled inputs and screen readers).
                // The click fires first and tells us whether it was a pointer (detail > 0) or the keyboard.
                onClick={e => { pointerRef.current = e.detail > 0 }}
                onChange={() => toggle(o.id, pointerRef.current)}
                onFocus={() => setFocusId(id)}
                onBlur={() => setFocusId(f => (f === id ? null : f))}
                style={visuallyHidden}
              />
              <span aria-hidden="true" style={mark(isSel)}>{'\u2713'}</span>
              <span>{o.label}{o.description ? <span style={{ display: 'block', fontSize: 13, color: 'var(--text-3)' }}>{o.description}</span> : null}</span>
            </label>
          )
        })}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {group.allowNoneOfThese && (
          <button type="button" aria-pressed={special === 'none_fit'} onClick={pickNoneFit} style={pill(special === 'none_fit')}>{NONE_FIT_LABEL}</button>
        )}
        {group.allowNotSure && (
          <button type="button" onClick={() => immediate('not_sure')} style={pill()}>{NOT_SURE_LABEL}</button>
        )}
        {group.allowPreferNotToSay && (
          <button type="button" onClick={() => immediate('prefer_not')} style={pill()}>{PREFER_NOT_LABEL}</button>
        )}
        {group.allowSkip && (
          <button type="button" onClick={() => immediate('skip')} style={pill()}>{SKIP_LABEL}</button>
        )}
      </div>

      <div>
        <button
          type="button"
          aria-expanded={textOpen}
          aria-controls={textId}
          onClick={() => (textOpen ? setTextOpen(false) : openText(true))}
          style={{ background: 'none', border: 'none', padding: '4px 0', fontSize: 14, color: 'var(--text-2)', cursor: 'pointer', textDecoration: 'underline', minHeight: 32 }}
        >
          {textOpen ? 'Hide your own words' : `+ ${group.freeTextLabel}`}
        </button>
        {/* Hidden, not unmounted, so what was typed is never lost by closing the box. */}
        <div id={textId} hidden={!textOpen} style={{ marginTop: 6 }}>
          <label htmlFor={`${textId}-input`} style={{ display: 'block', fontSize: 13.5, color: 'var(--text-2)', marginBottom: 4 }}>
            {special === 'none_fit' ? NONE_FIT_TEXT_LABEL : 'Add context or tell Quorum in your own words (optional)'}
          </label>
          <textarea
            id={`${textId}-input`}
            ref={textRef}
            value={text}
            maxLength={group.freeTextMaxLength}
            rows={3}
            placeholder={group.freeTextPlaceholder}
            aria-describedby={countId}
            onChange={e => { setText(e.target.value); setError(null) }}
            style={{
              width: '100%', boxSizing: 'border-box', resize: 'vertical', padding: '10px 12px', borderRadius: 12,
              border: '1px solid var(--border-mid)', background: 'var(--bg-card)', color: 'var(--text-1)',
              fontSize: 16, lineHeight: 1.4, fontFamily: 'inherit',
            }}
          />
          <div id={countId} style={{ fontSize: 12, color: 'var(--text-4)', textAlign: 'right' }}>
            {text.length} / {group.freeTextMaxLength} characters
          </div>
        </div>
      </div>

      <div id={statusId} aria-live="polite" style={{ fontSize: 13, color: 'var(--text-3)' }}>{status}</div>
      {error && <div id={errId} role="alert" style={{ fontSize: 13.5, color: 'var(--text-1)' }}>{error}</div>}

      <button
        type="button"
        onClick={submit}
        aria-disabled={!check.ok}
        style={{
          alignSelf: 'flex-start', padding: '11px 22px', minHeight: 44, borderRadius: 999, fontSize: 15, fontWeight: 600,
          border: '1px solid var(--gold)', cursor: 'pointer',
          background: check.ok ? 'var(--gold)' : 'var(--bg-card)',
          color: check.ok ? 'var(--bg-card)' : 'var(--text-3)',
        }}
      >
        Continue
      </button>
    </fieldset>
  )
}

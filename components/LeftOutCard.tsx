'use client'

// components/LeftOutCard.tsx
// ── v17 Phase 6: "something we didn't ask" ───────────────────────────────────
//
// To keep the intake short, Quorum can leave some questions to the Council (the fast path does this on purpose; any chat that
// reaches its ceiling does it too). The Council is told those were "not asked". Until now the person was not, and could not go
// back and answer them. This card lists exactly those questions, once the Council has spoken, and lets them add any that matter.
//
// What happens on submit is NOT new machinery: the answers go to the existing in-session "new information" pipeline
// (SessionView.handleShareContext), the same one the Challenge box uses. All six advisors re-read with the new facts and a new
// synthesis version is produced, in this same session. No second decision is created, so the Desk and Mirror do not count one
// decision twice.
//
// Rules: entirely optional ("Not now"); shows only questions the intake genuinely did not ask (never ones the person answered,
// skipped, or said did not apply); renders nothing when there are none or the request fails; one submission per page view.

import { useEffect, useRef, useState } from 'react'
import { composeLeftOutText } from '@/lib/left-out'
import type { LeftOutItem } from '@/lib/left-out'
import { track } from '@/lib/track'

interface Props {
  sessionId: string
  /** Receives the composed new-information text. SessionView wires this to handleShareContext('synthesis', text). */
  onSubmit:  (text: string) => void
  /** True while an earlier update is still running, so a second one is not started on top of it. */
  busy?:     boolean
}

const card: React.CSSProperties = {
  background: 'var(--bg-card)', border: '1px solid var(--border-dim)', borderRadius: 12, padding: '16px', textAlign: 'left',
}

export default function LeftOutCard({ sessionId, onSubmit, busy = false }: Props) {
  const [items, setItems]       = useState<LeftOutItem[] | null>(null)
  const [flow, setFlow]         = useState<string | null>(null)
  const [answers, setAnswers]   = useState<Record<string, string>>({})
  const [state, setState]       = useState<'open' | 'sent' | 'dismissed'>('open')
  const shown = useRef(false)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/session/${sessionId}/left-out`)
      .then(r => r.json())
      .then(d => { if (!cancelled) { setItems(Array.isArray(d?.items) ? d.items : []); setFlow(typeof d?.flowVersion === 'string' ? d.flowVersion : null) } })
      .catch(() => { if (!cancelled) setItems([]) })
    return () => { cancelled = true }
  }, [sessionId])

  useEffect(() => {
    if (!items || items.length === 0 || shown.current) return
    shown.current = true
    track('left_out_shown', { items_count: items.length, flow_version: flow ?? null, surface: 'council' }, { sessionId })
  }, [items, flow, sessionId])

  if (!items || items.length === 0 || state === 'dismissed') return null

  if (state === 'sent') {
    return (
      <div style={card} role="status">
        <p style={{ fontSize: 14.5, lineHeight: 1.5, color: 'var(--text-1)', margin: 0 }}>
          Sent. The Council is re-reading with this, and its read will update.
        </p>
      </div>
    )
  }

  const answered = items.filter(it => (answers[it.key] ?? '').trim().length >= 2)
  const text = composeLeftOutText(items, answers)

  return (
    <section aria-label="Something we did not ask" style={card} data-tour-id="council-left-out">
      <p style={{ fontSize: 12.5, color: 'var(--text-3)', margin: '0 0 6px' }}>Something we didn’t ask</p>
      <p style={{ fontSize: 14, lineHeight: 1.55, color: 'var(--text-2)', margin: '0 0 14px' }}>
        To keep this short, Quorum left a few things for the Council to work around. If any of them matter, add them and all six
        advisors will re-read with them. Entirely optional.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {items.map(it => (
          <div key={it.key}>
            <label htmlFor={`lo-${it.key}`} style={{ display: 'block', fontSize: 13.5, lineHeight: 1.45, color: 'var(--text-1)', marginBottom: 6 }}>
              <strong style={{ fontWeight: 600 }}>{it.label}.</strong> {it.ask}
            </label>
            {it.chips && it.chips.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
                {it.chips.map(c => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setAnswers(a => ({ ...a, [it.key]: c }))}
                    style={{
                      minHeight: 40, padding: '0 12px', borderRadius: 999, fontFamily: 'inherit', fontSize: 12.5, cursor: 'pointer',
                      background: (answers[it.key] ?? '') === c ? 'var(--bg-elevated, var(--bg-card))' : 'transparent',
                      border: `1px solid ${(answers[it.key] ?? '') === c ? 'var(--gold)' : 'var(--border-mid)'}`, color: 'var(--text-2)',
                    }}
                  >
                    {c}
                  </button>
                ))}
              </div>
            )}
            <textarea
              id={`lo-${it.key}`}
              rows={2}
              value={answers[it.key] ?? ''}
              onChange={e => setAnswers(a => ({ ...a, [it.key]: e.target.value }))}
              placeholder="Your answer (or leave blank)"
              maxLength={600}
              style={{
                width: '100%', boxSizing: 'border-box', resize: 'vertical', minHeight: 56, padding: '10px 12px', fontFamily: 'inherit',
                fontSize: 14, lineHeight: 1.5, color: 'var(--text-1)', background: 'var(--bg-input, transparent)',
                border: '1px solid var(--border-mid)', borderRadius: 10,
              }}
            />
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 16, alignItems: 'center' }}>
        <button
          type="button"
          className="btn-primary"
          disabled={answered.length === 0 || busy}
          onClick={() => {
            if (!text) return
            track('left_out_submitted', { answered_count: answered.length, items_count: items.length, flow_version: flow ?? null }, { sessionId })
            onSubmit(text)
            setState('sent')
          }}
          style={{ minHeight: 44, padding: '0 18px', fontSize: 13.5 }}
        >
          {busy ? 'Council is still updating…' : 'Add these and update the Council'}
        </button>
        <button
          type="button"
          className="btn-ghost"
          onClick={() => { track('left_out_dismissed', { items_count: items.length, flow_version: flow ?? null }, { sessionId }); setState('dismissed') }}
          style={{ minHeight: 44, fontSize: 13 }}
        >
          Not now
        </button>
      </div>
    </section>
  )
}

'use client'

// ── PatternSurfaceCard ────────────────────────────────────────────────────────
// Chunk 4a — Proactive pattern surfacing on home screen.
// Shows the top-firing structural pattern from the user's record.
// Decision links show actual decision text, not UUIDs.
// Includes one actionable line per pattern.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect } from 'react'

interface RulePattern {
  rule_id:     string
  label:       string
  description: string
  type:        'REDIRECT' | 'GATE' | 'FLAG'
  fire_count:  number
  pct:         number
  session_ids: string[]
}

interface SessionPreview {
  id:            string
  decision_text: string
}

interface Props {
  authToken:    string | null
  sessionCount: number
}

const PATTERN_THRESHOLD   = 5
const DECISIONS_PREVIEW   = 2   // show 2, rest behind "Show more"

const RULE_NARRATIVE: Record<string, (count: number, total: number) => string> = {
  R1:  (c, t) => `In ${c} of your ${t} decisions, you were waiting for a prior question to resolve before you could decide. The prior question was never named.`,
  R2:  (c, t) => `${c} of your ${t} decisions carried strong identity stakes. In each case, the values question came before the analysis — you moved to analysis first.`,
  R3:  (c, t) => `You brought ${c} decisions to the Council where the information needed to decide didn't exist yet. The decisions were treated as ready.`,
  R4:  (c, t) => `In ${c} of your ${t} decisions, the downside was structurally irreversible while the upside was not. The asymmetry was present; it was not the deciding factor.`,
  R5:  (c, t) => `${c} of your ${t} decisions carried high emotional intensity without genuine time pressure. The urgency was real to you. The structure didn't support it.`,
  R6:  (c, t) => `${c} decisions involved multiple stakeholders with unresolved alignment. The decisions proceeded without that alignment established first.`,
  R7:  (c, t) => `In ${c} of your ${t} decisions, a specific piece of missing information would have materially changed the answer. The information was not gathered before deciding.`,
  R8:  (c, t) => `${c} of your ${t} decisions contained a deep conflict between two values you hold. The conflict was visible. It was not resolved — the decision was made anyway.`,
  R9:  (c, t) => `${c} decisions were structurally irreversible, made under emotional pressure, with no genuine time constraint. All three conditions were present each time.`,
  R10: (c, t) => `In ${c} of your ${t} decisions, the complexity and ambiguity were both high. You brought these to the Council without first structuring what you were trying to solve.`,
  R12: (c, t) => `${c} decisions required alignment with a partner or co-decision-maker. In each case, the decision was analysed before that alignment was sought.`,
}

// What the user should actually do differently next time
const RULE_ACTIONABLE: Record<string, string> = {
  R1:  'Before your next decision of this type, name the upstream question explicitly and resolve it first — or decide whether you can proceed without it.',
  R2:  'When identity is at stake, run a values clarification before the Council — ask yourself what you would decide if the analysis were irrelevant.',
  R3:  'Name what information would change your answer. If it exists and you can get it, get it before the Council runs.',
  R4:  'Map the downside explicitly before the Council runs — if it is irreversible, the asymmetry deserves to be the deciding factor, not just a footnote.',
  R5:  'Before the next high-pressure decision, ask: does anything external actually force this now? If the honest answer is no, the urgency is structural, not real.',
  R6:  'Identify who else owns this decision before you analyse it. Alignment is not a courtesy — it changes the answer.',
  R7:  'Write down the one piece of information that would change your decision. Gather it before you return to the Council.',
  R8:  'Name the two values in conflict and decide which one takes precedence in this category — before the next decision of this type arrives.',
  R9:  'When all three conditions are present — irreversibility, emotional pressure, no genuine deadline — pause. The convergence is a signal, not a reason to move.',
  R10: 'Before running the Council on a complex decision, spend ten minutes structuring what exactly you are trying to decide. The Council works better with a precise question.',
  R12: 'Have the alignment conversation before you analyse the options. What your partner believes is part of the decision, not an input to it.',
}

export default function PatternSurfaceCard({ authToken, sessionCount }: Props) {
  const [pattern,        setPattern]        = useState<RulePattern | null>(null)
  const [total,          setTotal]          = useState(0)
  const [sessionPreviews,setSessionPreviews]= useState<SessionPreview[]>([])
  const [loading,        setLoading]        = useState(true)
  const [expanded,       setExpanded]       = useState(false)
  const [showAll,        setShowAll]        = useState(false)

  useEffect(() => {
    if (!authToken || sessionCount < PATTERN_THRESHOLD) { setLoading(false); return }
    const headers: Record<string, string> = { Authorization: `Bearer ${authToken}` }

    fetch('/api/mirror/patterns', { headers })
      .then(r => r.json())
      .then(async data => {
        if (!data.threshold_met || !data.patterns?.length) return
        const p: RulePattern = data.patterns[0]
        setPattern(p)
        setTotal(data.session_count ?? sessionCount)

        // Fetch decision text for source sessions
        if (p.session_ids?.length > 0) {
          const ids = p.session_ids.slice(0, 6)
          const res = await fetch('/api/history', {
            method:  'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body:    JSON.stringify({ ids }),
          })
          const hist = await res.json()
          const previews: SessionPreview[] = (hist.sessions ?? []).map((s: { id: string; decision_text: string }) => ({
            id:            s.id,
            decision_text: s.decision_text,
          }))
          setSessionPreviews(previews)
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [authToken, sessionCount])

  if (loading || !pattern) return null

  const narrative   = RULE_NARRATIVE[pattern.rule_id]?.(pattern.fire_count, total)
  const actionable  = RULE_ACTIONABLE[pattern.rule_id]
  if (!narrative) return null

  const typeColor: Record<string, string> = {
    FLAG:     'var(--gold)',
    REDIRECT: '#3a78c4',
    GATE:     '#38a468',
  }
  const color = typeColor[pattern.type] ?? 'var(--gold)'

  const visiblePreviews = showAll ? sessionPreviews : sessionPreviews.slice(0, DECISIONS_PREVIEW)
  const hiddenCount     = sessionPreviews.length - DECISIONS_PREVIEW

  return (
    <div style={{
      background:   'var(--bg-card)',
      border:       '1px solid var(--border-mid)',
      borderLeft:   `2px solid ${color}`,
      borderRadius: 12,
      padding:      '16px 20px',
      marginBottom: 12,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
        <div>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, letterSpacing: '0.14em', textTransform: 'uppercase', color, margin: '0 0 4px', opacity: 0.9 }}>
            Pattern surfaced from your record
          </p>
          <p style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 400, color: 'var(--text-1)', margin: 0, lineHeight: 1.4 }}>
            {pattern.label}
          </p>
        </div>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-4)', background: 'var(--bg-inset)', border: '1px solid var(--border-dim)', borderRadius: 20, padding: '2px 10px', whiteSpace: 'nowrap', flexShrink: 0, letterSpacing: '0.06em' }}>
          {pattern.fire_count} of {total}
        </span>
      </div>

      {/* Narrative */}
      <p style={{ fontSize: 12.5, color: 'var(--text-3)', lineHeight: 1.65, margin: '0 0 10px' }}>
        {narrative}
      </p>

      {/* Actionable */}
      {actionable && (
        <div style={{ background: 'var(--bg-inset)', border: '1px solid var(--border-dim)', borderRadius: 8, padding: '10px 14px', marginBottom: 10 }}>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-4)', margin: '0 0 5px' }}>
            What to do next time
          </p>
          <p style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.6, margin: 0 }}>
            {actionable}
          </p>
        </div>
      )}

      {/* Expand toggle */}
      <button
        onClick={() => setExpanded(e => !e)}
        style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-4)', letterSpacing: '0.08em', opacity: 0.65, transition: 'opacity 0.2s' }}
        onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
        onMouseLeave={e => (e.currentTarget.style.opacity = '0.65')}
      >
        {expanded ? 'Hide decisions ↑' : 'See source decisions ↓'}
      </button>

      {/* Source decisions */}
      {expanded && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border-dim)' }}>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-4)', margin: '0 0 8px' }}>
            Decisions where this fired
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {visiblePreviews.map(s => (
              <a
                key={s.id}
                href={`/record/${s.id}`}
                style={{ fontSize: 12, color: 'var(--text-3)', textDecoration: 'none', lineHeight: 1.5, display: 'flex', alignItems: 'flex-start', gap: 8, transition: 'color 0.15s' }}
                onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-1)')}
                onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-3)')}
              >
                <span style={{ color: 'var(--text-4)', flexShrink: 0, marginTop: 1 }}>→</span>
                <span>{s.decision_text.length > 80 ? s.decision_text.slice(0, 80) + '…' : s.decision_text}</span>
              </a>
            ))}
          </div>

          {hiddenCount > 0 && !showAll && (
            <button
              onClick={e => { e.stopPropagation(); setShowAll(true) }}
              style={{ marginTop: 8, background: 'none', border: '1px solid var(--border-dim)', borderRadius: 8, padding: '6px 14px', fontSize: 11, color: 'var(--text-4)', cursor: 'pointer', fontFamily: 'inherit', transition: 'border-color 0.2s, color 0.2s' }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--border-mid)'; e.currentTarget.style.color = 'var(--text-3)' }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-dim)'; e.currentTarget.style.color = 'var(--text-4)' }}
            >
              Show {hiddenCount} more
            </button>
          )}
        </div>
      )}
    </div>
  )
}

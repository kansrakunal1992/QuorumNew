'use client'

// ── RecordReceipt ─────────────────────────────────────────────────────────────
// Shown below SynthesisCard once synthesis is complete.
// Confirms the decision was added to the judgment record.
// Surfaces 2–3 structural dimensions from the ontology (already computed).
// No charts, no bars — narrative confirmation only.
// Mirror mention only if mirrorActive (user has subscription).

interface Props {
  sessionCount:  number          // total decisions in the user's record
  decisionType?: string          // from ontology: e.g. "Capital allocation"
  irreversibility?: string       // from ontology: high / medium / low
  stakesLevel?: string           // from ontology: e.g. "partially reversible"
  urgencySource?: string         // from ontology: "external" | "self-created" | etc.
  mirrorActive?: boolean         // only show Mirror mention if user has access
}

const IRREVERSIBILITY_LABEL: Record<string, string> = {
  high:   'High irreversibility',
  medium: 'Medium irreversibility',
  low:    'Low irreversibility',
}

const URGENCY_LABEL: Record<string, string> = {
  external:      'Urgency: externally imposed',
  'self-created':'Urgency: self-created',
  unclear:       'Urgency: unclear source',
}

export default function RecordReceipt({
  sessionCount,
  decisionType,
  irreversibility,
  urgencySource,
  mirrorActive = false,
}: Props) {
  const dimensions: string[] = []
  if (irreversibility && IRREVERSIBILITY_LABEL[irreversibility]) {
    dimensions.push(IRREVERSIBILITY_LABEL[irreversibility])
  }
  if (urgencySource && URGENCY_LABEL[urgencySource]) {
    dimensions.push(URGENCY_LABEL[urgencySource])
  }

  return (
    <div
      style={{
        marginTop:    20,
        background:   'var(--bg-card)',
        border:       '1px solid var(--border-dim)',
        borderLeft:   '2px solid var(--green-border)',
        borderRadius: 12,
        padding:      '14px 18px',
      }}
    >
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{
          fontSize:      11,
          fontWeight:    700,
          color:         'var(--green-text)',
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
        }}>
          Decision record #{sessionCount} added
        </span>
        {decisionType && (
          <span style={{
            fontSize:     10,
            color:        'var(--text-4)',
            background:   'var(--bg-inset)',
            border:       '1px solid var(--border-dim)',
            borderRadius: 20,
            padding:      '2px 10px',
            fontFamily:   'var(--font-mono)',
            letterSpacing:'0.04em',
            whiteSpace:   'nowrap',
          }}>
            {decisionType}
          </span>
        )}
      </div>

      {/* Structural dimensions */}
      {dimensions.length > 0 && (
        <p style={{
          fontSize:   11.5,
          color:      'var(--text-3)',
          lineHeight: 1.55,
          margin:     '0 0 6px',
        }}>
          {dimensions.join(' · ')}
        </p>
      )}

      {/* Footer line */}
      <p style={{ fontSize: 10.5, color: 'var(--text-4)', margin: 0, fontStyle: 'italic' }}>
        Added to your judgment record
        {mirrorActive ? ' · Mirror updated' : ''}
      </p>
    </div>
  )
}

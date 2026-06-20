// components/BiasNoteCard.tsx
// Sprint: Item A — first-session bias feedback
//
// Surfaces a single, plain-English bias note for the decision the user just
// brought — server-rendered, no Mirror subscription required, works from
// session 1. This closes the "dead zone" between the moment of peak
// engagement (right after synthesis) and the next time bias feedback would
// otherwise surface (homepage teaser pill, next visit, or Mirror unlock).
//
// Deliberately scoped:
//   - Shows at most ONE bias note (the strongest signal for this session)
//   - Only surfaces signal_type === 'distorting' detections — neutral/adaptive
//     classifications are not shown here; they aren't a "watch out" moment
//   - No detection_count threshold — this is per-session feedback, not a
//     longitudinal "confirmed pattern" claim (that's Mirror's job)
//   - Purely presentational; all data is computed server-side in
//     app/record/[id]/page.tsx and passed in as a prop

interface Props {
  note: {
    label:     string
    reasoning: string
  } | null
}

export default function BiasNoteCard({ note }: Props) {
  if (!note) return null

  return (
    <div style={{
      borderRadius: 12,
      padding:      '13px 18px',
      background:   'var(--bg-card)',
      border:       '1px solid var(--border-subtle)',
      display:      'flex',
      gap:          12,
      alignItems:   'flex-start',
    }}>
      {/* Amber dot — consistent with EarlyEchoCard's gold pulse, distinct color
          so the two don't read as the same signal type */}
      <div style={{
        width:        7,
        height:       7,
        borderRadius: '50%',
        background:   '#c98a4c',
        marginTop:    5,
        flexShrink:   0,
        boxShadow:    '0 0 0 3px rgba(201,138,76,0.12)',
      }} />
      <div>
        <p style={{
          fontSize:   12.5,
          fontWeight: 600,
          color:      'var(--text-2)',
          margin:     '0 0 3px',
          lineHeight: 1.4,
        }}>
          {note.label} was flagged in this analysis.
        </p>
        <p style={{
          fontSize:   12,
          color:      'var(--text-4)',
          margin:     0,
          lineHeight: 1.55,
        }}>
          {note.reasoning}
        </p>
      </div>
    </div>
  )
}

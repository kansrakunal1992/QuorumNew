'use client'
// components/NotEnoughParticipantsYet.tsx
// Institutional Sprint 5 (task 4) — shown wherever a benchmark hasn't
// cleared K_FLOOR yet. Exact counts, per the answered question (accepting
// the small-number trade-off explained in lib/unlock-progress.ts's header).

interface Props {
  progress: { bucket: 'high' | 'low'; current: number; needed: number }[]
}

export default function NotEnoughParticipantsYet({ progress }: Props) {
  if (!progress.length) return null

  return (
    <div style={{
      display: 'inline-flex', flexDirection: 'column', gap: 3,
      padding: '6px 10px', borderRadius: 8,
      border: '1px dashed var(--border-mid)', background: 'transparent',
    }}>
      {progress.map(p => (
        <span key={p.bucket} style={{ fontSize: 10.5, color: 'var(--text-4)', fontFamily: 'var(--font-mono)' }}>
          {p.current} of {p.needed} needed ({p.bucket})
        </span>
      ))}
    </div>
  )
}

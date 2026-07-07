'use client'
import { useRouter } from 'next/navigation'

interface Props {
  label?: string
  className?: string
  style?: React.CSSProperties
}

export default function BackButton({
  label = '← Back to Council',
  className = 'btn-ghost',
  style = { padding: '10px 20px', fontSize: 13 },
}: Props) {
  const router = useRouter()
  return (
    <button
      onClick={() => {
        // Bug fix: router.back() can replay Next.js's client-side Router Cache for
        // the target route (up to ~30s stale by default via
        // experimental.staleTimes.dynamic, sometimes longer). SessionView fully
        // unmounts/remounts across this route boundary, so it re-derives its state
        // from whatever session/messages payload the cache hands back — if that
        // snapshot predates synthesis finishing, SynthesisCard sees no cached
        // synthesis to reuse and reruns it for real, even though it's already
        // saved. router.refresh() forces a fresh server fetch for this route
        // immediately, so the DB's current state (synthesis included) is what
        // actually renders.
        router.back()
        router.refresh()
      }}
      className={className}
      style={style}
    >
      {label}
    </button>
  )
}

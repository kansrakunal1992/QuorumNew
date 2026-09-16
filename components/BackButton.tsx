'use client'
import { useRouter } from 'next/navigation'

interface Props {
  label?: string
  className?: string
  style?: React.CSSProperties
  /** Bug fix: without this, every BackButton uses router.back() — browser-
   *  history navigation, which goes to whatever route the user happened to
   *  arrive from, not a fixed destination. On the record page specifically,
   *  that was landing back on the session page's initial instinct-capture
   *  step (SessionView remounts fresh there, per the comment below, so
   *  there's no "resume where I left off" to land on) instead of home —
   *  confusing since nothing about clicking "Back" on a saved record
   *  implies "go relive the start of that session." When href is provided,
   *  this navigates straight there instead of using history at all. Default
   *  (no href) is unchanged — still router.back() + refresh(), which is the
   *  right behavior for "back to Council" from within an active session. */
  href?: string
}

export default function BackButton({
  label = '← Back to Council',
  className = 'btn-ghost',
  style = { padding: '10px 20px', fontSize: 13 },
  href,
}: Props) {
  const router = useRouter()
  return (
    <button
      onClick={() => {
        if (href) {
          router.push(href)
          return
        }
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

/**
 * QUORUM — "Quorum's Read" client-safe exports (PR7)
 *
 * BUILD FIX: this file exists because of a real deploy failure. The
 * original lib/quorum-read.ts had `createCompletion` (from lib/ai-client.ts,
 * which carries a build-time `import 'server-only'` guard) at module scope
 * alongside TensionPrediction/readinessLabel. Next.js bundles an entire
 * module — not just the specific export you imported — into whatever
 * references it, so QuorumReadCard.tsx (a 'use client' component) importing
 * ONLY `readinessLabel` and the `TensionPrediction` type from that file was
 * enough to pull the whole module graph, including lib/ai-client.ts, into
 * the client bundle → build fails with "You're importing a component that
 * needs server-only."
 *
 * Fix: anything a client component needs lives here, with zero import chain
 * back to lib/ai-client.ts (or anything else server-only). Everything that
 * actually needs `createCompletion` — buildStructuralSummary, and the
 * deterministic predictTension() logic that runs alongside it — stays in
 * lib/quorum-read.ts, which only the API route
 * (app/api/session/[id]/quorum-read/route.ts) imports. QuorumReadCard.tsx
 * must import from THIS file, never from lib/quorum-read.ts directly.
 */

import type { PersonaKey } from '@/lib/types'
import type { Readiness }  from '@/lib/readiness'

export interface TensionPrediction {
  advisorA: PersonaKey
  advisorB: PersonaKey
  axis:     string   // short phrase, e.g. "reversibility vs. upside"
}

export function readinessLabel(readiness: Readiness): { emoji: string; text: string } {
  switch (readiness) {
    case 'READY':              return { emoji: '🟢', text: 'Ready' }
    case 'READY_WITH_CAVEATS': return { emoji: '🟡', text: 'Ready, with one open question' }
    case 'NOT_READY':          return { emoji: '🔴', text: 'Not ready yet' }
  }
}

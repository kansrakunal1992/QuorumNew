// app/api/version/route.ts
// ─────────────────────────────────────────────────────────────────────────────
// GET /api/version
//
// Returns a version identifier for the currently running server process.
// Used by components/UpdateBanner.tsx to detect when a new deploy has gone
// live while the user still has an old tab/PWA window open.
//
// VERSION SOURCE (in order of preference):
//   1. RAILWAY_GIT_COMMIT_SHA — set automatically by Railway, changes on every
//      deploy (new commit = new SHA). Identical across all replicas of the
//      same deploy, so multi-replica rolling deploys don't cause false positives.
//   2. RAILWAY_DEPLOYMENT_ID — fallback, also Railway-injected.
//   3. Date.now() at module load — fallback for local dev / non-Railway hosts.
//      Computed ONCE per process start, so a server restart still bumps it.
//
// No env vars need to be set manually — Railway provides these automatically.
//
// Cache-Control: no-store — this must NEVER be cached by the browser or any
// intermediary, or version checks would always return a stale value.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'

// Computed once at module load — stable for the life of this server process.
const BUILD_VERSION =
  process.env.RAILWAY_GIT_COMMIT_SHA ??
  process.env.RAILWAY_DEPLOYMENT_ID ??
  String(Date.now())

export async function GET() {
  return NextResponse.json(
    { version: BUILD_VERSION },
    {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    },
  )
}

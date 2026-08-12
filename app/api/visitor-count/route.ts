// app/api/visitor-count/route.ts
// ─────────────────────────────────────────────────────────────────────────────
// GET  /api/visitor-count  — read-only, returns the current count. Used by
//                            components/VisitorCounter.tsx for every visit
//                            after the very first one on a given browser.
// POST /api/visitor-count  — atomically increments by 1 and returns the new
//                            count. Called exactly once per browser, ever
//                            (client-side localStorage guard — see
//                            VisitorCounter.tsx), on that browser's first-ever
//                            load.
//
// Backed by supabase/add_visitor_counter.sql — a single-row, service-role-only
// table seeded at 150. No auth required: this is a public, low-stakes
// cosmetic number (same trust level as a GitHub star count), not sensitive
// data, so unlike every other route in this app there's deliberately no
// Bearer-token check here.
//
// Fails soft everywhere: if the table isn't migrated yet or Supabase has a
// transient hiccup, this returns the seed value rather than throwing — a
// wrong/missing social-proof number should never break page load.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'

const FALLBACK_COUNT = 150

const NO_STORE = { 'Cache-Control': 'no-store, no-cache, must-revalidate' }

export async function GET() {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('site_visitor_counter')
    .select('count')
    .eq('id', 1)
    .single()

  if (error || typeof data?.count !== 'number') {
    return NextResponse.json({ count: FALLBACK_COUNT }, { headers: NO_STORE })
  }

  return NextResponse.json({ count: data.count }, { headers: NO_STORE })
}

export async function POST() {
  const supabase = createServiceClient()
  const { data, error } = await supabase.rpc('increment_visitor_counter')

  if (error || typeof data !== 'number') {
    console.error('[visitor-count] increment failed:', error)
    return NextResponse.json({ count: FALLBACK_COUNT }, { headers: NO_STORE })
  }

  return NextResponse.json({ count: data }, { headers: NO_STORE })
}

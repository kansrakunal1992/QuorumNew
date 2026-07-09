// lib/aggregate-benchmark.ts
// Institutional Sprint 4 (task 4) — auto-tiering.
//
// This function IS the auto-tiering mechanism (plan Section 1.4): check the
// institution-scoped view; if it has a row for this dimension, that
// institution's own population cleared K_FLOOR for it — show that. If not,
// fall back to the platform-wide view. If neither has a row, show the
// honest "not enough participants yet" state (Section 1.8), not a blank
// space. There is no separate "if headcount > N" branch anywhere in this
// file or elsewhere — a 50-person institution and a 5,000-person one run
// through this exact same function.
//
// Explicitly out of scope this sprint (per plan Section 6): actually
// rendering any of this in the UI — that's Sprint 5. This file's job is
// just to return the right data, correctly scoped and labeled, for
// Sprint 5 to consume.

import { createServiceClient } from '@/lib/supabase'
import { K_FLOOR } from '@/lib/k-floor'

type ServiceClient = ReturnType<typeof createServiceClient>

export interface BenchmarkBucket {
  bucket:   'high' | 'low'
  avgDelta: number
  n:        number
}

export type BenchmarkScope =
  | { type: 'institution'; label: string; n: number }
  | { type: 'platform';    label: string; n: number }
  | { type: 'rollup';      label: string; n: number; contributingChildren: number }
  | { type: 'insufficient' }

export interface DimensionBenchmark {
  dim:      string
  gap:      number
  isSignal: boolean
  buckets:  BenchmarkBucket[]   // 0-2 entries — a bucket only appears if it individually cleared K_FLOOR
  scope:    BenchmarkScope
}

interface BenchmarkRow {
  dim:            string
  high_avg_delta: number | null
  high_n:         number | null
  low_avg_delta:  number | null
  low_n:          number | null
  gap:            number | null
  is_signal:      boolean | null
}

function rowToBenchmark(row: BenchmarkRow, scope: BenchmarkScope): DimensionBenchmark {
  const buckets: BenchmarkBucket[] = []
  if (row.high_n != null && row.high_avg_delta != null) {
    buckets.push({ bucket: 'high', avgDelta: row.high_avg_delta, n: row.high_n })
  }
  if (row.low_n != null && row.low_avg_delta != null) {
    buckets.push({ bucket: 'low', avgDelta: row.low_avg_delta, n: row.low_n })
  }
  return {
    dim:      row.dim,
    gap:      row.gap ?? 0,
    isSignal: row.is_signal ?? false,
    buckets,
    scope,
  }
}

// The single entry point Sprint 5's UI calls per benchmark-bearing number
// (plan Section 1.8: "every benchmark-bearing number carries its own scope
// tag inline"). institutionId is the user's currently *active* institution
// context (Sprint 5's mode switcher owns picking which one) — pass null for
// a user with no active institution, which goes straight to the platform
// fallback.
export async function getBenchmarkForDimension(
  dim: string,
  institutionId: string | null,
): Promise<DimensionBenchmark> {
  const supabase = createServiceClient()

  if (institutionId) {
    const institutionResult = await queryInstitutionView(supabase, institutionId, dim)
    if (institutionResult) return institutionResult
  }

  const platformResult = await queryPlatformView(supabase, dim)
  if (platformResult) return platformResult

  return {
    dim, gap: 0, isSignal: false, buckets: [],
    scope: { type: 'insufficient' },
  }
}

async function queryInstitutionView(
  supabase: ServiceClient, institutionId: string, dim: string,
): Promise<DimensionBenchmark | null> {
  const { data, error } = await supabase
    .from('institutional_benchmark_segments')
    .select('*')
    .eq('institution_id', institutionId)
    .eq('dim', dim)
    .maybeSingle()

  if (error) {
    console.error('[aggregate-benchmark] institution view query failed:', error.message)
    return null
  }
  if (!data) return null

  const { data: institution } = await supabase
    .from('institutions')
    .select('name')
    .eq('id', institutionId)
    .maybeSingle()

  const n = (data.high_n ?? 0) + (data.low_n ?? 0)
  return rowToBenchmark(data, { type: 'institution', label: institution?.name ?? 'Your institution', n })
}

async function queryPlatformView(supabase: ServiceClient, dim: string): Promise<DimensionBenchmark | null> {
  const { data, error } = await supabase
    .from('institutional_platform_benchmark_segments')
    .select('*')
    .eq('dim', dim)
    .maybeSingle()

  if (error) {
    console.error('[aggregate-benchmark] platform view query failed:', error.message)
    return null
  }
  if (!data) return null

  const n = (data.high_n ?? 0) + (data.low_n ?? 0)
  return rowToBenchmark(data, { type: 'platform', label: 'Platform', n })
}

// Cross-institution rollup (task 5) — a separate entry point rather than a
// third rung in getBenchmarkForDimension's fallback chain, because it's a
// different question ("what does my conglomerate look like across its
// portfolio companies") not a fallback for when an institution's own view
// comes up empty. Callers are parent-institution admin dashboards
// specifically (Sprint 5), not the general per-user benchmark path.
export async function getRollupBenchmarkForDimension(
  parentInstitutionId: string, dim: string,
): Promise<DimensionBenchmark> {
  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('institutional_rollup_benchmark_segments')
    .select('*')
    .eq('parent_institution_id', parentInstitutionId)
    .eq('dim', dim)
    .maybeSingle()

  if (error) {
    console.error('[aggregate-benchmark] rollup view query failed:', error.message)
  }
  if (!data) {
    return { dim, gap: 0, isSignal: false, buckets: [], scope: { type: 'insufficient' } }
  }

  const { data: parent } = await supabase
    .from('institutions')
    .select('name')
    .eq('id', parentInstitutionId)
    .maybeSingle()

  const n = (data.high_n ?? 0) + (data.low_n ?? 0)
  return rowToBenchmark(data, {
    type: 'rollup',
    label: parent?.name ?? 'Your organization',
    n,
    contributingChildren: data.contributing_children ?? 0,
  })
}

// Re-exported for consumers (Sprint 5's "4 of 20 needed" style copy) that
// want the floor number without importing lib/k-floor.ts separately.
export { K_FLOOR }

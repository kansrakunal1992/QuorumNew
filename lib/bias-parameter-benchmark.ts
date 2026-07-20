// lib/bias-parameter-benchmark.ts
// Institutional Sprint 6 — auto-tiering for bias-parameter aggregates
// (PatternTile's vocabulary), mirroring lib/aggregate-benchmark.ts's
// pattern for the 14-dim calibration views exactly: institution view first,
// platform fallback, insufficient otherwise. Kept as a separate file rather
// than folded into aggregate-benchmark.ts, since the two read from
// genuinely different view families (calibration-delta HIGH/LOW buckets vs.
// bias-parameter detection rates) with different row shapes — mirroring,
// not sharing, the tiering logic.

import { createServiceClient } from '@/lib/supabase'

type ServiceClient = ReturnType<typeof createServiceClient>

export type BiasParameterScope =
  | { type: 'institution' | 'platform'; label: string; n: number }
  | { type: 'insufficient' }

export interface BiasParameterBenchmark {
  biasParameter: string
  memberCount: number | null
  avgConfidenceWeight: number | null
  scope: BiasParameterScope
}

export async function getBiasParameterBenchmark(
  biasParameter: string,
  institutionId: string | null,
): Promise<BiasParameterBenchmark> {
  const supabase = createServiceClient()

  if (institutionId) {
    const institutionResult = await queryInstitutionView(supabase, institutionId, biasParameter)
    if (institutionResult) return institutionResult
  }

  const platformResult = await queryPlatformView(supabase, biasParameter)
  if (platformResult) return platformResult

  return {
    biasParameter, memberCount: null, avgConfidenceWeight: null,
    scope: { type: 'insufficient' },
  }
}

async function queryInstitutionView(
  supabase: ServiceClient, institutionId: string, biasParameter: string,
): Promise<BiasParameterBenchmark | null> {
  // Tech debt fix (aggregate_reader wiring — see supabase/institutional_
  // tech_debt_fixes.sql Part 6): routed through a SECURITY DEFINER function
  // owned by the restricted aggregate_reader role, same pattern and same
  // rationale as lib/aggregate-benchmark.ts's two equivalent functions.
  const { data: rows, error } = await supabase
    .rpc('aggregate_read_institution_bias_parameter', { p_institution_id: institutionId, p_bias_parameter: biasParameter })

  if (error) {
    console.error('[bias-parameter-benchmark] institution view query failed:', error.message)
    return null
  }
  const data = rows?.[0]
  if (!data) return null

  const { data: institution } = await supabase
    .from('institutions')
    .select('name')
    .eq('id', institutionId)
    .maybeSingle()

  return {
    biasParameter,
    memberCount: data.member_count,
    avgConfidenceWeight: data.avg_confidence_weight,
    scope: { type: 'institution', label: institution?.name ?? 'Your institution', n: data.member_count },
  }
}

async function queryPlatformView(
  supabase: ServiceClient, biasParameter: string,
): Promise<BiasParameterBenchmark | null> {
  // Tech debt fix — see queryInstitutionView above for the full rationale.
  const { data: rows, error } = await supabase
    .rpc('aggregate_read_platform_bias_parameter', { p_bias_parameter: biasParameter })

  if (error) {
    console.error('[bias-parameter-benchmark] platform view query failed:', error.message)
    return null
  }
  const data = rows?.[0]
  if (!data) return null

  return {
    biasParameter,
    memberCount: data.member_count,
    avgConfidenceWeight: data.avg_confidence_weight,
    scope: { type: 'platform', label: 'Platform', n: data.member_count },
  }
}

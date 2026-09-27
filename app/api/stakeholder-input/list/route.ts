/**
 * QUORUM — Stakeholder Input List Route (Phase 2, v2)
 * Feeds the "what people said" list in components/StakeholderOutreach.tsx,
 * and is available for SessionView.tsx or the Decision Brief to surface the
 * same data later (not wired into either in this drop — see
 * docs/CHANGELOG_v2.md).
 */

import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { decrypt, decryptJson } from '@/lib/encryption'
import { isNaturalIntakeEnabled } from '@/lib/feature-flags'
import type { ExtractedStakeholderClaims } from '@/lib/stakeholder-extract'

export async function GET(req: Request) {
  if (!isNaturalIntakeEnabled()) {
    return NextResponse.json({ error: 'Not enabled' }, { status: 404 })
  }

  const { searchParams } = new URL(req.url)
  const sessionId = searchParams.get('sessionId')
  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId is required' }, { status: 400 })
  }

  const supabase = createServiceClient()
  const { data: rows } = await supabase
    .from('stakeholder_inputs')
    .select('id, channel, provenance, source_text, source_timestamp, source_link, extracted_claims, created_at, stakeholders ( name )')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true })

  const inputs = (rows ?? []).map((r: any) => ({
    id:              r.id,
    channel:         r.channel,
    provenance:      r.provenance,
    sourceText:      decrypt(r.source_text),
    sourceTimestamp:  r.source_timestamp,
    sourceLink:       r.source_link,
    extracted:        decryptJson<ExtractedStakeholderClaims>(r.extracted_claims),
    createdAt:        r.created_at,
    stakeholderName:  decrypt(Array.isArray(r.stakeholders) ? r.stakeholders[0]?.name : r.stakeholders?.name),
  }))

  return NextResponse.json({ inputs })
}

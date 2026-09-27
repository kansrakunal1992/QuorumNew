import 'server-only'

// lib/stakeholder-extract.ts
// ── Stakeholder input extraction (Phase 2, v2) ────────────────────────────────
//
// Turns a person's raw message into the structured shape plan section 15
// calls for: claims, concerns, evidence, a recommendation if they gave one,
// and any real ambiguity — kept as a JSON blob on stakeholder_inputs.
// extracted_claims (encrypted), always alongside the untouched source_text.
// Every string this returns should be traceable back to source_text — this
// is an extraction, never Quorum's own opinion about what they meant (that
// distinction lives in the separate, user-authored user_interpretation
// column, not here).

import { createCompletion } from '@/lib/ai-client'

export interface ExtractedStakeholderClaims {
  claims:          string[]
  concerns:        string[]
  evidence:        string[]
  recommendation:  string | null
  ambiguity:       string | null
}

const EXTRACT_PROMPT = (personName: string, decisionContext: string, sourceText: string) => `Someone named ${personName} said the following about a decision. Extract only what they actually said — no interpretation, no filling in gaps, no guessing at what they "really meant."

THE DECISION THIS RELATES TO:
${decisionContext.slice(0, 1500)}

WHAT ${personName.toUpperCase()} SAID:
${sourceText.slice(0, 3000)}

Extract:
- claims: factual statements they made (things they asserted are true)
- concerns: worries or objections they raised
- evidence: specific facts, numbers, or examples they cited in support of anything
- recommendation: what they explicitly recommended doing, if they said so outright — null if they didn't give one
- ambiguity: one sentence noting anything genuinely unclear or that could be read more than one way — null if their message was clear

Every item must be traceable to something they actually wrote. Do not add anything they didn't say.

Return ONLY a JSON object:
{ "claims": string[], "concerns": string[], "evidence": string[], "recommendation": string|null, "ambiguity": string|null }`.trim()

const EMPTY: ExtractedStakeholderClaims = { claims: [], concerns: [], evidence: [], recommendation: null, ambiguity: null }

export async function extractStakeholderClaims(
  personName:      string,
  decisionContext: string,
  sourceText:      string,
): Promise<ExtractedStakeholderClaims> {
  if (!sourceText?.trim()) return EMPTY

  try {
    const raw    = await createCompletion(EXTRACT_PROMPT(personName, decisionContext, sourceText), 400, { provider: 'deepseek' })
    const clean  = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim()
    const parsed = JSON.parse(clean)

    return {
      claims:         Array.isArray(parsed?.claims) ? parsed.claims : [],
      concerns:       Array.isArray(parsed?.concerns) ? parsed.concerns : [],
      evidence:       Array.isArray(parsed?.evidence) ? parsed.evidence : [],
      recommendation: typeof parsed?.recommendation === 'string' ? parsed.recommendation : null,
      ambiguity:      typeof parsed?.ambiguity === 'string' ? parsed.ambiguity : null,
    }
  } catch (err) {
    console.error('[StakeholderExtract] failed:', err)
    return EMPTY
  }
}

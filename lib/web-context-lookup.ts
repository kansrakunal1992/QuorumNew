/**
 * QUORUM — Local/Regulatory/Market Context Lookup (PR2)
 *
 * ...(see file history for full origin note)...
 *
 * MODEL ROUTING (added on request — see PR2 tier-gating note below):
 * This is the one AI call in the app that needs Anthropic's web_search tool
 * specifically — DeepSeek/Mistral/OpenAI-compatible endpoints already wired
 * in lib/ai-client.ts don't expose an equivalent tool through the same
 * client, so this deliberately does NOT go through resolveProvider()'s
 * fast/premium role system the rest of the app uses. Two consequences,
 * both intentional:
 *   1. It always resolves to Claude (via createWebSearchCompletion in
 *      lib/ai-client.ts), regardless of the fast/premium role split.
 *   2. Because of (1), it is gated to Elite/Private tier ONLY — see the
 *      tier check in app/api/examiner/route.ts's POST handler, which skips
 *      calling this module entirely for Free-tier sessions rather than
 *      silently running an Anthropic call against the Free-tier cost
 *      budget (~$0.005/session per the unit-economics review — a live
 *      web-search Claude call would blow that on its own). Free-tier users
 *      still get their user_stated_text captured and stored; they just
 *      don't get the web-retrieved enrichment layer. This mirrors how
 *      Private tier's self-hosted endpoints are already gated by
 *      capability rather than faked with a fallback.
 */

import { createWebSearchCompletion } from '@/lib/ai-client'
import { createServiceClient }       from '@/lib/supabase'
import { encrypt }                   from '@/lib/encryption'

const SYSTEM_PROMPT = `You are a research assistant supporting a private decision-advisory system. Your job is narrow: find CURRENT, SOURCED information relevant to the local, regulatory, market, or geopolitical context of a specific real-world decision — nothing else.

RULES:
- Use web search. Do not answer from memory alone for anything time-sensitive (regulations, market conditions, prices, political developments).
- Every factual claim must be attributable to a specific search result. If you cannot find a source for something, do not include it.
- If nothing relevant turns up, say so plainly: "No specific current information found." Do not speculate or fill the gap with general knowledge dressed up as current fact.
- You are not making a recommendation and must not offer one. You are gathering context, not advising.
- Maximum 150 words. Plain prose, no headers, no bullet list longer than 4 items.
- Do not invent named regulators, laws, or figures. If the user's context is vague about jurisdiction, say what you'd need to know to search more precisely instead of guessing.`

function buildPrompt(decisionText: string, userStatedContext: string | null): string {
  const contextLine = userStatedContext?.trim()
    ? `THE USER SPECIFICALLY FLAGGED: "${userStatedContext.trim().slice(0, 500)}"`
    : `The user did not specify particular local/regulatory factors — infer the most likely relevant jurisdiction and domain from the decision itself, and search for that.`

  return `DECISION BRIEF: "${decisionText.slice(0, 600)}"

${contextLine}

Find current, sourced information about local, regulatory, market, or geopolitical conditions that could materially affect this decision.`.trim()
}

export interface LocalContextLookupResult {
  status:  'complete' | 'failed'
  summary: string
  citations: Array<{ url: string; title: string | null }>
}

/**
 * Runs the lookup and persists the result to examiner_local_context.
 * Never throws — errors are caught, logged, and written as status='failed'
 * so the row doesn't sit at 'pending' forever (see PR3's readiness.ts,
 * which never reads lookup_status — this table is enrichment-only and is
 * NOT part of the critical/important readiness gate by design; see this
 * file's header doc comment for why).
 */
export async function runLocalContextLookup(
  sessionId:         string,
  decisionText:      string,
  userStatedContext: string | null,
): Promise<void> {
  const supabase = createServiceClient()

  try {
    const result = await createWebSearchCompletion(
      buildPrompt(decisionText, userStatedContext),
      600,
      { systemPrompt: SYSTEM_PROMPT, maxUses: 3 },
    )

    if (!result.text || !result.usedSearch) {
      await supabase
        .from('examiner_local_context')
        .update({
          lookup_status: 'complete',
          retrieved_summary: encrypt('No specific current information found.'),
          retrieved_citations: [],
          updated_at: new Date().toISOString(),
        })
        .eq('session_id', sessionId)
      return
    }

    await supabase
      .from('examiner_local_context')
      .update({
        lookup_status:       'complete',
        retrieved_summary:   encrypt(result.text),
        retrieved_citations: result.citations,
        updated_at:          new Date().toISOString(),
      })
      .eq('session_id', sessionId)
  } catch (err) {
    console.error(`[LocalContextLookup] failed for session ${sessionId}:`, err)
    await supabase
      .from('examiner_local_context')
      .update({ lookup_status: 'failed', updated_at: new Date().toISOString() })
      .eq('session_id', sessionId)
      .then(() => {}, () => {})   // best-effort even on this cleanup write
  }
}

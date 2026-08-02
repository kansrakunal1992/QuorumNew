import 'server-only'
// lib/context-extractor.ts
// ── Context Ingestion — extraction ───────────────────────────────────────────
//
// Same shape as lib/ontology-tagger.ts: one createCompletion() call, strict
// JSON-only system prompt, fenced-code-block-stripping parse guard.
//
// The `rawText` parameter here is never written to a database, a log line,
// or a file — it exists only as a local variable for the duration of
// extractMemoryFacts(), and the caller (app/api/context-ingestion/route.ts)
// lets it fall out of scope the instant this function returns. That's the
// entire "raw conversation discarded" guarantee: not a delete step, but the
// absence of a write step in the first place.
// ─────────────────────────────────────────────────────────────────────────────

import { createCompletion } from '@/lib/ai-client'
import type { MemoryFactCandidate, MemoryFactCategory, UserMemoryFact } from '@/lib/types'

const CATEGORIES: MemoryFactCategory[] = [
  'goal', 'value', 'constraint', 'decision_pattern',
  'communication_style', 'relationship', 'long_term_context', 'other',
]

const MAX_CANDIDATES = 15   // held firm per product decision — signal quality drops past this

const EXTRACTION_SYSTEM = `You distill a person's own conversation history (or self-description) into a small set of structured facts that will help an advisory system understand them faster. You are reading text the person themself wrote or exported — never content about anyone else who appears in it.

Return ONLY a JSON array (no prose, no markdown fences), each element:
{
  "category": one of ${JSON.stringify(CATEGORIES)},
  "insight_text": a single abstracted sentence, 8-25 words,
  "confidence": 0-1, how clearly the source material supports this,
  "importance": 0-1, how much this should weigh in advising this person
}

Rules:
- Return at most ${MAX_CANDIDATES} facts. Fewer, higher-quality facts beat many weak ones.
- insight_text must be an ABSTRACTED characterization, never a near-verbatim quote or specific identifying detail (no names, dates, employers, dollar figures, medical/legal specifics). Write "navigates high-stakes financial decisions cautiously", not "considering bankruptcy after the March lease default".
- Only extract facts about the account owner (the person whose export/description this is) — never about other people who appear in their conversations, even in passing (a colleague, a collaborator, a friend named in the text). If a sentence is really about what someone ELSE believes, decided, or is limited by, skip it.
- Do NOT extract facts about a product, tool, or system the person is building, discussing, or using — including this product, Quorum — as if they were facts about the person. "This tool reads the structure of a decision before it answers" describes a product's behavior, not the person's own value or judgment, even if the person said it enthusiastically or said it often. Only extract a value/pattern/goal if the sentence is about how the PERSON thinks, decides, or behaves — not about what a product does.
- Prefer DURABLE patterns likely to matter across many different future decisions over TACTICAL specifics tied to one current project. "Tests messaging against real prospects before committing to a channel" is durable; "uses WhatsApp and LinkedIn for outreach this quarter" is tactical and should usually be skipped unless nothing more durable is available. When a conversation reveals both, extract the durable pattern underneath the tactic, not the tactic itself.
- Skip anything that is really about a third party, a one-off factual question, or too generic to be useful (e.g. "likes helpful answers").
- If the source material is too thin to support any confident fact, return [].`

function buildUserPrompt(rawText: string): string {
  return `Source material (a self-description or exported conversation history):\n\n${rawText}\n\nExtract the structured facts now.`
}

function parseCandidates(raw: string): MemoryFactCandidate[] {
  try {
    const clean  = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim()
    const parsed = JSON.parse(clean)
    if (!Array.isArray(parsed)) return []

    const out: MemoryFactCandidate[] = []
    for (const item of parsed) {
      if (
        item &&
        typeof item.insight_text === 'string' && item.insight_text.trim() &&
        CATEGORIES.includes(item.category) &&
        typeof item.confidence === 'number' && item.confidence >= 0 && item.confidence <= 1 &&
        typeof item.importance === 'number' && item.importance >= 0 && item.importance <= 1
      ) {
        out.push({
          category:     item.category,
          insight_text: item.insight_text.trim(),
          confidence:   item.confidence,
          importance:   item.importance,
        })
      }
    }
    return out.slice(0, MAX_CANDIDATES)
  } catch (err) {
    console.error('[ContextExtractor] JSON parse failed:', err)
    return []
  }
}

/**
 * Extract candidate memory facts from raw source text. Never throws —
 * returns [] on any failure so the caller can surface a clean "failed,
 * retry" state rather than a 500.
 */
export async function extractMemoryFacts(rawText: string): Promise<{ candidates: MemoryFactCandidate[]; model: string | null }> {
  try {
    const raw = await createCompletion(buildUserPrompt(rawText), 3000, {
      provider:     'anthropic',
      systemPrompt: EXTRACTION_SYSTEM,
      temperature:  0.2,
    })
    return { candidates: parseCandidates(raw), model: 'anthropic' }
  } catch (err) {
    console.error('[ContextExtractor] extractMemoryFacts failed:', err)
    return { candidates: [], model: null }
  }
}

// ── Reanalyze — refines existing accepted/edited facts, never touches raw text ──
// Point 7: "re-analysis with a newer model without asking users to upload
// again, as long as the accepted facts already exist." Input here is the
// user's OWN already-distilled facts, not any raw source — there is no raw
// text left to re-run against, by design.

const REANALYZE_SYSTEM = `You are re-scoring a person's previously-extracted profile facts using your current judgment. For each fact given, return a refined confidence and importance (0-1), and the same or a corrected category from ${JSON.stringify(CATEGORIES)}. You may lightly tighten the wording (still 8-25 words, still abstracted, never adding new specifics that weren't already there) but do not introduce new facts.

Return ONLY a JSON array, same length and order as the input, each element:
{ "insight_text": string, "category": string, "confidence": 0-1, "importance": 0-1 }`

export async function reanalyzeFacts(
  facts: Pick<UserMemoryFact, 'id' | 'insight_text' | 'category'>[]
): Promise<{ revisions: Map<string, MemoryFactCandidate>; model: string | null }> {
  const revisions = new Map<string, MemoryFactCandidate>()
  if (facts.length === 0) return { revisions, model: null }

  try {
    const input = facts.map((f, i) => `${i}. [${f.category}] ${f.insight_text}`).join('\n')
    const raw = await createCompletion(input, 2000, {
      provider:     'anthropic',
      systemPrompt: REANALYZE_SYSTEM,
      temperature:  0.2,
    })
    const clean  = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim()
    const parsed = JSON.parse(clean)
    if (!Array.isArray(parsed)) return { revisions, model: null }

    parsed.forEach((item, i) => {
      const fact = facts[i]
      if (!fact) return
      if (
        item &&
        typeof item.insight_text === 'string' && item.insight_text.trim() &&
        CATEGORIES.includes(item.category) &&
        typeof item.confidence === 'number' &&
        typeof item.importance === 'number'
      ) {
        revisions.set(fact.id, {
          category:     item.category,
          insight_text: item.insight_text.trim(),
          confidence:   Math.max(0, Math.min(1, item.confidence)),
          importance:   Math.max(0, Math.min(1, item.importance)),
        })
      }
    })
    return { revisions, model: 'anthropic' }
  } catch (err) {
    console.error('[ContextExtractor] reanalyzeFacts failed:', err)
    return { revisions, model: null }
  }
}

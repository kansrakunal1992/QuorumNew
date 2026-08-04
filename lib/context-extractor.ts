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

// Shared rules, identical in both modes — only the specificity rule (#2 below) and
// the output contract differ. Kept as one template to avoid the two prompts drifting.
const BASE_RULES = `- Return at most ${MAX_CANDIDATES} facts. Fewer, higher-quality facts beat many weak ones.
- Only extract facts about the account owner (the person whose export/description this is) — never about other people who appear in their conversations, even in passing (a colleague, a collaborator, a friend named in the text). If a sentence is really about what someone ELSE believes, decided, or is limited by, skip it.
- Do NOT extract facts about a product, tool, or system the person is building, discussing, or using — including this product, Quorum — as if they were facts about the person. "This tool reads the structure of a decision before it answers" describes a product's behavior, not the person's own value or judgment, even if the person said it enthusiastically or said it often. Only extract a value/pattern/goal if the sentence is about how the PERSON thinks, decides, or behaves — not about what a product does.
- Prefer DURABLE patterns likely to matter across many different future decisions over TACTICAL specifics tied to one current project. "Tests messaging against real prospects before committing to a channel" is durable; "uses WhatsApp and LinkedIn for outreach this quarter" is tactical and should usually be skipped unless nothing more durable is available. When a conversation reveals both, extract the durable pattern underneath the tactic, not the tactic itself.
- Skip anything that is really about a third party, a one-off factual question, or too generic to be useful (e.g. "likes helpful answers").
- If the source material is too thin to support any confident fact, return [].`

const EXTRACTION_SYSTEM_ABSTRACTED = `You distill a person's own conversation history (or self-description) into a small set of structured facts that will help an advisory system understand them faster. You are reading text the person themself wrote or exported — never content about anyone else who appears in it.

Return ONLY a JSON array (no prose, no markdown fences), each element:
{
  "category": one of ${JSON.stringify(CATEGORIES)},
  "insight_text": a single abstracted sentence, 8-25 words,
  "confidence": 0-1, how clearly the source material supports this,
  "importance": 0-1, how much this should weigh in advising this person
}

Rules:
${BASE_RULES}
- insight_text must be an ABSTRACTED characterization, never a near-verbatim quote or specific identifying detail (no names, dates, employers, dollar figures, medical/legal specifics). Write "navigates high-stakes financial decisions cautiously", not "considering bankruptcy after the March lease default".`

// v3 — specific-details opt-in. Same shape, one extra output field, and rule
// #2 flipped: specifics are ALLOWED but not required — the model still
// abstracts wherever a durable pattern is the more useful thing to keep, and
// marks is_specific per-fact rather than treating the whole import as one
// undifferentiated mode. This is what lets Foundational Context later
// reference a named employer or an actual figure directly (see
// lib/foundational-context.ts) instead of only ever paraphrasing.
const EXTRACTION_SYSTEM_SPECIFIC = `You distill a person's own conversation history (or self-description) into a small set of structured facts that will help an advisory system understand them faster. You are reading text the person themself wrote or exported — never content about anyone else who appears in it.

This person has explicitly opted in to retaining concrete specifics (names, dates, employers, dollar figures) where they materially sharpen a fact — this is NOT the default mode, so use the allowance deliberately, not everywhere.

Return ONLY a JSON array (no prose, no markdown fences), each element:
{
  "category": one of ${JSON.stringify(CATEGORIES)},
  "insight_text": a single sentence, 8-25 words,
  "confidence": 0-1, how clearly the source material supports this,
  "importance": 0-1, how much this should weigh in advising this person,
  "is_specific": true if insight_text includes a concrete identifying detail (a name, employer, date, amount), false if it's an abstracted characterization
}

Rules:
${BASE_RULES}
- Default to the same ABSTRACTED style as before ("navigates high-stakes financial decisions cautiously"). Only keep a concrete detail (set is_specific: true) when the specific itself is what makes the fact useful for a real future decision — e.g. a named employer being weighed in an actual career choice, a live financial target, a dated milestone. Don't keep a name or date just because it was in the source text.
- Medical and legal specifics stay abstracted even in specific mode — diagnoses, prescriptions, case details, and similar sensitive specifics should never appear as a concrete detail regardless of this opt-in.
- A specific fact still can't be about a third party — "negotiating a package with [employer]" is fine; a colleague's name or situation is not, same as in the base rules.`

function buildUserPrompt(rawText: string): string {
  return `Source material (a self-description or exported conversation history):\n\n${rawText}\n\nExtract the structured facts now.`
}

function parseCandidates(raw: string, allowSpecificDetails: boolean): MemoryFactCandidate[] {
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
          // Defense in depth: forced false whenever the import didn't opt in,
          // regardless of what the model returns — the consent gate lives
          // here, not just in the prompt.
          is_specific:  allowSpecificDetails && item.is_specific === true,
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
 *
 * allowSpecificDetails — v3 per-import consent flag (default false upstream).
 * When false, uses the same abstraction-only prompt as before; when true,
 * switches prompts AND still re-enforces the gate in parseCandidates so a
 * model deviation can't leak a specific into an opted-out import.
 */
export async function extractMemoryFacts(
  rawText: string,
  allowSpecificDetails: boolean = false,
): Promise<{ candidates: MemoryFactCandidate[]; model: string | null }> {
  try {
    const raw = await createCompletion(buildUserPrompt(rawText), 3000, {
      provider:     'anthropic',
      systemPrompt: allowSpecificDetails ? EXTRACTION_SYSTEM_SPECIFIC : EXTRACTION_SYSTEM_ABSTRACTED,
      temperature:  0.2,
    })
    return { candidates: parseCandidates(raw, allowSpecificDetails), model: 'anthropic' }
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

// v3 — each input line is tagged [SPECIFIC] or [ABSTRACTED] so the model
// applies the right wording rule per-fact within a single batch call, rather
// than either forcing every fact into the abstraction-only rule (which would
// silently strip specifics back out on every "Refresh with latest model")
// or requiring a second API call to split the batch. is_specific itself is
// never revised here — reanalyze rescores confidence/importance/wording, it
// doesn't change what the user originally consented to.
const REANALYZE_SYSTEM = `You are re-scoring a person's previously-extracted profile facts using your current judgment. For each fact given, return a refined confidence and importance (0-1), and the same or a corrected category from ${JSON.stringify(CATEGORIES)}. You may lightly tighten the wording (still 8-25 words) but do not introduce new facts.

Each input line is prefixed [SPECIFIC] or [ABSTRACTED] — do not include this prefix in your output:
- [ABSTRACTED] facts: keep the wording abstracted, never adding new specifics that weren't already there.
- [SPECIFIC] facts: these were extracted with the person's explicit consent to retain concrete details (names, employers, dates, amounts) — preserve those details, do not abstract them away.

Return ONLY a JSON array, same length and order as the input, each element:
{ "insight_text": string, "category": string, "confidence": 0-1, "importance": 0-1 }`

export async function reanalyzeFacts(
  facts: Pick<UserMemoryFact, 'id' | 'insight_text' | 'category' | 'is_specific'>[]
): Promise<{ revisions: Map<string, MemoryFactCandidate>; model: string | null }> {
  const revisions = new Map<string, MemoryFactCandidate>()
  if (facts.length === 0) return { revisions, model: null }

  try {
    const input = facts.map((f, i) => `${i}. [${f.category}] ${f.is_specific ? '[SPECIFIC]' : '[ABSTRACTED]'} ${f.insight_text}`).join('\n')
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
          is_specific:  fact.is_specific,   // unchanged — reanalyze rescores, it doesn't revoke or grant consent
        })
      }
    })
    return { revisions, model: 'anthropic' }
  } catch (err) {
    console.error('[ContextExtractor] reanalyzeFacts failed:', err)
    return { revisions, model: null }
  }
}

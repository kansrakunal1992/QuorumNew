// app/api/voice/cleanup/route.ts
// Sprint 22a — grammar/structure cleanup of raw voice transcript
// ─────────────────────────────────────────────────────────────────────────────
// Accepts { raw_transcript: string }.
// Calls createCompletion() via ai-client.ts (respects AI_PROVIDER env var).
// Prompt is locked: structure + grammar only, zero new assumptions.
// Returns { cleaned: string }.
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server'
import { createCompletion } from '@/lib/ai-client'

const MAX_INPUT_CHARS = 3000

export async function POST(req: NextRequest) {
  let body: { raw_transcript?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 })
  }

  const raw = (body.raw_transcript ?? '').trim()
  if (!raw) return NextResponse.json({ cleaned: '' })
  if (raw.length > MAX_INPUT_CHARS) {
    return NextResponse.json({ error: 'INPUT_TOO_LONG' }, { status: 413 })
  }

  // ── Prompt design (do not loosen these rules) ─────────────────────────────
  // Word limit at TOP — models ignore end-of-prompt limits.
  // Explicit NOT instructions for every possible overreach.
  const prompt = `Maximum output: 500 words. Return only the cleaned text — no preamble, no commentary, nothing else.

Your task: Fix grammar, punctuation, filler words ("uh", "um", "like", "basically", "you know"), and sentence structure in the text below.

Rules you must follow:
- Do NOT add any information not explicitly present in the input
- Do NOT infer, assume, or extrapolate anything
- Do NOT summarise or condense — preserve all content
- Do NOT rephrase the meaning or intent
- Do NOT add headings, bullet points, or structure beyond clear sentences
- Preserve names, numbers, and specific details exactly as stated

Text to clean:
${raw}`

  let cleaned: string
  try {
    cleaned = (await createCompletion(prompt, 600)).trim()
  } catch (err) {
    console.error('[voice/cleanup] AI completion failed:', err)
    return NextResponse.json({ error: 'CLEANUP_FAILED' }, { status: 502 })
  }

  // If AI returned nothing, return the original — never leave user with blank
  return NextResponse.json({ cleaned: cleaned || raw })
}

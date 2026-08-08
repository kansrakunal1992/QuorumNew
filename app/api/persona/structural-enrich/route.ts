// app/api/persona/structural-enrich/route.ts
// ── Structural echo — retroactive enrichment (2026-08-08) ────────────────────
//
// THE PROBLEM THIS SOLVES:
// /api/structural-match depends on the current session's ontology tagging
// finishing first, then a scoring pass on top of that — a pipeline that takes
// real time. Persona initial calls fire almost immediately on session mount
// (see components/PersonaPanel.tsx's mount effect), gated only on
// canStream/panelState, with no dependency on structural-match's result.
// Structural context is only ever injected on a persona's initial call
// (app/api/persona/route.ts's structuralBlock, gated on `messages.length ===
// 0`) — pushback replies explicitly exclude it, and there's no other
// injection point. So if structuralContext arrives after a persona's initial
// call already fired — which is the common case, not an edge case — that
// persona gets zero structural echo for the rest of the session, even when a
// good match exists and the tag-emission logic would otherwise have produced
// one.
//
// THE FIX:
// Nothing about the initial-call timing changes — no latency added anywhere
// on that path. Instead, once structuralContext actually arrives (however
// late), the client (PersonaPanel.tsx) checks whether this specific
// persona's already-completed initial response lacks a <structural> tag,
// and if so calls this endpoint once. This endpoint shows the persona its
// own original response plus the now-available match and asks it to decide,
// exactly as it would have during the original call, whether the match
// genuinely applies to its specific analytical angle. If yes: a
// <structural> tag comes back and gets appended. If no, or if anything about
// this call fails: nothing changes from today's behavior — this is
// additive-only, never a replacement for or blocker on the original response.

import { NextResponse } from 'next/server'
import { createCompletion } from '@/lib/ai-client'
import { PERSONAS } from '@/lib/personas'
import { PERSONAS_WITH_STRUCTURAL_CONTEXT, getPersonaStructuralDirective } from '@/lib/structural-retrieval'
import { checkLimit, getClientIP, tooManyRequests, LIMITS } from '@/lib/rate-limit'

export async function POST(req: Request) {
  try {
    const rlResult = checkLimit(getClientIP(req), LIMITS.structuralEnrich)
    if (!rlResult.allowed) return tooManyRequests(rlResult, 'structural-enrich requests')

    const body = await req.json() as {
      sessionId?:         string
      personaKey?:        string
      originalResponse?:  string
      structuralContext?: string
    }
    const { sessionId, personaKey, originalResponse, structuralContext } = body

    if (!personaKey || !originalResponse || !structuralContext) {
      return NextResponse.json({ error: 'personaKey, originalResponse, and structuralContext are required' }, { status: 400 })
    }

    // Same eligibility list the original call-time gating already uses
    // (app/api/persona/route.ts's structuralBlock condition) — kept as the
    // single source of truth in lib/structural-retrieval.ts, not duplicated
    // here, so the two paths can never silently drift apart.
    if (!PERSONAS_WITH_STRUCTURAL_CONTEXT.has(personaKey)) {
      return NextResponse.json({ structuralTag: null, skipped: 'persona not eligible' })
    }

    // Defensive — the client already checks this before calling, but a
    // second, cheap check here means a client-side bug can't produce a
    // duplicate tag even if the guard up there is ever changed incorrectly.
    if (/<structural>[\s\S]*?<\/structural>/.test(originalResponse)) {
      return NextResponse.json({ structuralTag: null, skipped: 'already has a structural tag' })
    }

    const persona = PERSONAS[personaKey as keyof typeof PERSONAS]
    if (!persona) {
      return NextResponse.json({ error: 'Unknown personaKey' }, { status: 400 })
    }

    const directive = getPersonaStructuralDirective(personaKey)
    const strippedOriginal = originalResponse.replace(/<[^>]+>/g, '').slice(0, 1500)

    const prompt = `You are ${persona.label}, part of Quorum's advisory council. You already gave your independent assessment of a decision — reproduced below — before a structural record of the decision-maker's past decisions had finished being retrieved.

YOUR ORIGINAL RESPONSE:
${strippedOriginal}

STRUCTURAL RECORD (only just became available):
${structuralContext}

YOUR STRUCTURAL MANDATE: ${directive}

Decide now, exactly as you would have at the time: does this structural record genuinely apply to your specific analytical angle above — a real parallel or contrast you would actually have drawn, not a forced one?

If yes: write ONLY one <structural>...</structural> tag, one sentence, naming the specific observation, phrased as a citation added after the fact (e.g. "Looking back at this alongside your March decision on the lease renewal, the same avoidance-of-conflict pattern shows up here too."). Nothing else — no preamble, no repetition of your original response.

If no: output nothing at all. Do not explain why it doesn't apply. Do not fabricate a citation to have something to say.`

    const raw = await createCompletion(prompt, 120, {
      provider:    'anthropic',
      temperature: 0.4,
    })

    const match = raw.match(/<structural>[\s\S]*?<\/structural>/)
    if (!match) {
      console.log(`[StructuralEnrich] session=${sessionId ?? 'unknown'} persona=${personaKey} — model judged no applicable citation`)
      return NextResponse.json({ structuralTag: null })
    }

    console.log(`[StructuralEnrich] session=${sessionId ?? 'unknown'} persona=${personaKey} — citation added retroactively`)
    return NextResponse.json({ structuralTag: match[0] })

  } catch (err) {
    // Additive-only feature — a failure here must never surface as an error
    // to the person using the product. Log and return the same "nothing to
    // add" shape a legitimate no-match decision would return.
    console.error('[StructuralEnrich] Route error (non-fatal, swallowed):', err)
    return NextResponse.json({ structuralTag: null })
  }
}

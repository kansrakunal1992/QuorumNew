// app/api/session/[id]/observation/route.ts
// O3: Surfaces the Decision Brief's "Decision-Maker Observation" line automatically
// below the synthesis card for Mirror subscribers, without requiring them to first
// click "Generate Decision Brief". Cached on the session row after first generation
// so repeat views (and repeat page loads) don't re-bill the LLM call.
//
// Gated on Mirror access being 'unlocked' — this is a Mirror-only surface, not a
// teaser. Locked/teaser-tier users get { observation: null } and the client renders
// nothing (no upsell nudge here; SynthesisCard already carries the Mirror nudge row).

import { NextResponse }         from 'next/server'
import { createServiceClient }  from '@/lib/supabase'
import { decrypt }              from '@/lib/encryption'
import { getMirrorAccessState } from '@/lib/mirror-access'
import { createCompletion }     from '@/lib/ai-client'
import { DECISION_OBSERVATION_PROMPT } from '@/lib/personas'

interface Params { params: Promise<{ id: string }> }

const ADVISOR_KEYS = [
  'contrarian', 'risk_architect', 'pattern_analyst',
  'stakeholder_mirror', 'elder', 'competitor',
] as const

function stripHeaderTags(raw: string): string {
  return raw
    .replace(/<lens>[\s\S]*?<\/lens>/g, '')
    .replace(/<position>[\s\S]*?<\/position>/g, '')
    .replace(/<realcost>[\s\S]*?<\/realcost>/g, '')
    .replace(/<lean>[\s\S]*?<\/lean>/g, '')
    .replace(/<(?:lens|position|realcost|lean)>[\s\S]*$/, '') // guard: open tag without close
    .replace(/<\/?(?:proceed|wait|mixed)>\s*/gi, '')          // guard: stray malformed lean-value tag (see PersonaPanel.tsx)
    .replace(/^\s+/, '')
    .trim()
}

function stripSynthesisTags(raw: string): string {
  return raw
    .replace(/<verdict>[\s\S]*?<\/verdict>\n*/g, '')
    .replace(/<verdict>[\s\S]*/g, '')
    .replace(/<\/?tension>/g, '')
    .replace(/^\s+/, '')
    .trim()
}

export async function POST(_req: Request, { params }: Params) {
  try {
    const { id: sessionId } = await params
    if (!sessionId) return NextResponse.json({ observation: null })

    const supabase = createServiceClient()

    const { data: session } = await supabase
      .from('sessions')
      .select('user_id, decision_text, decision_observation')
      .eq('id', sessionId)
      .single()

    if (!session) return NextResponse.json({ observation: null })

    // Cached — return immediately, no regeneration
    if (session.decision_observation) {
      return NextResponse.json({ observation: session.decision_observation })
    }

    // Mirror subscribers only — this is not a teaser surface
    if (!session.user_id) return NextResponse.json({ observation: null })
    const mirrorState = await getMirrorAccessState(session.user_id, supabase)
    if (mirrorState !== 'unlocked') return NextResponse.json({ observation: null })

    const { data: messages } = await supabase
      .from('messages')
      .select('persona, content, created_at')
      .eq('session_id', sessionId)
      .eq('role', 'assistant')
      .in('persona', [...ADVISOR_KEYS, 'synthesis'])
      .order('created_at', { ascending: true })

    if (!messages || messages.length === 0) return NextResponse.json({ observation: null })

    // Keep only the earliest assistant row per persona (the initial analysis,
    // not later pushback/examiner-update exchanges).
    const seen = new Set<string>()
    const advisorBlocks: string[] = []
    let synthesisText = ''
    for (const msg of messages) {
      if (seen.has(msg.persona)) continue
      seen.add(msg.persona)
      const decrypted = decrypt(msg.content)
      if (!decrypted) continue
      if (msg.persona === 'synthesis') {
        synthesisText = stripSynthesisTags(decrypted)
      } else {
        advisorBlocks.push(`[${msg.persona.toUpperCase().replace(/_/g, ' ')}]\n${stripHeaderTags(decrypted).slice(0, 500)}`)
      }
    }

    if (advisorBlocks.length === 0 || !synthesisText) {
      return NextResponse.json({ observation: null })
    }

    const decisionText = decrypt(session.decision_text) ?? ''

    const userPrompt = `DECISION:\n${decisionText}\n\nADVISOR RESPONSES:\n${advisorBlocks.join('\n\n')}\n\nSYNTHESIS:\n${synthesisText}`

    const raw = await createCompletion(userPrompt, 80, {
      provider:     'anthropic',
      systemPrompt: DECISION_OBSERVATION_PROMPT,
      temperature:  0.7,
    })

    const observation = raw.trim().replace(/^["']|["']$/g, '')
    if (!observation) return NextResponse.json({ observation: null })

    await supabase
      .from('sessions')
      .update({ decision_observation: observation })
      .eq('id', sessionId)

    return NextResponse.json({ observation })
  } catch (err) {
    console.error('[Observation] Route error:', err)
    return NextResponse.json({ observation: null })
  }
}

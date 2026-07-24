import { notFound } from 'next/navigation'
import { formatDateTime, formatDate } from '@/lib/dates'
import { createServiceClient } from '@/lib/supabase'
import OutcomeTracker from '@/components/OutcomeTracker'
import BriefCTA from '@/components/BriefCTA'
import EmailCaptureCard from '@/components/EmailCaptureCard'
import EarlyEchoCard from '@/components/EarlyEchoCard'
import ValidationCard from '@/components/ValidationCard'
import Link from 'next/link'
import ReanalyzeDrawer from '@/components/ReanalyzeDrawer'
import BackButton from '@/components/BackButton'
import { PERSONAS } from '@/lib/personas'
import type { PersonaKey } from '@/lib/types'
import { decrypt } from '@/lib/encryption'
import TrustBadgeStrip from '@/components/TrustBadgeStrip'
import DecisionTimeline from '@/components/DecisionTimeline'  // RET-5 Sprint 3
import type { TimelineEntry } from '@/components/DecisionTimeline'
import { getMirrorAccessState } from '@/lib/mirror-access'    // RET-5 Sprint 3
import RecordTour from '@/components/RecordTour'              // Sprint TOUR-1
import RecordDecisionHero from '@/components/RecordDecisionHero'

// Strip <lens>, <position>, <realcost>, <lean> tags stored in DB — rendered separately
// in PersonaPanel (lean is never rendered, only used for the S3-01 tension interstitial)
// but never cleaned before persistence, so record page must strip them before display
function stripHeaderTags(raw: string): string {
  return raw
    .replace(/<lens>[\s\S]*?<\/lens>/g, '')
    .replace(/<position>[\s\S]*?<\/position>/g, '')
    .replace(/<realcost>[\s\S]*?<\/realcost>/g, '')
    .replace(/<lean>[\s\S]*?<\/lean>/g, '')
    // Bug fix: <structural> was never stripped here at all — every persona
    // response that includes a structural-echo citation (R6) was leaking
    // the raw <structural>...</structural> tag straight onto this page.
    .replace(/<structural>[\s\S]*?<\/structural>/g, '')
    .replace(/<(?:lens|position|realcost|lean|structural)>[\s\S]*$/, '') // guard: open tag without close
    .replace(/<\/?(?:proceed|wait|mixed)>\s*/gi, '')          // guard: stray malformed lean-value tag (see PersonaPanel.tsx)
    // Sprint 2 follow-on: <assumption> is content-preserving, unlike the
    // tags above — it wraps substantive prose (Contrarian/Risk Architect's
    // "hidden assumption" sentences), not a machine value or a citation
    // meant to live elsewhere. Strip only the tag markers, keep the text.
    .replace(/<\/?assumption>/g, '')
    // New machine-only tag (mind-change tracking) — full removal, same as <lean>.
    .replace(/<pushback_classification>[\s\S]*?<\/pushback_classification>/g, '')
    // Strip synthesis verdict block entirely (shown via SynthesisCard on session page)
    .replace(/<verdict>[\s\S]*?<\/verdict>\n*/g, '')
    .replace(/<verdict>[\s\S]*/g, '')          // guard: open tag without close
    // P2 fix: this file has its own independent tag-stripping copy (not shared
    // with SynthesisCard.tsx or synthesis-summary/route.ts) — it never learned
    // about the two tags added for forced-verdict-with-conditions, so they were
    // leaking through raw as visible text on this page.
    .replace(/<verdict_lean>[\s\S]*?<\/verdict(?:_lean)?>\n*/g, '')
    .replace(/<conditions>[\s\S]*?<\/conditions>\n*/g, '')
    // Sprint 1 follow-on: same leak risk as verdict_lean/conditions above —
    // this file never learned about key_question either.
    .replace(/<key_question>[\s\S]*?<\/key_question>\n*/g, '')
    // Strip tension wrapper tags but keep the sentence text inline
    .replace(/<\/?tension>/g, '')
    .replace(/^\s+/, '')
}

// Truncates to the first complete sentence — same rule as SynthesisCard.tsx (S1-03),
// guards against the model writing more than one sentence inside <verdict>.
function firstSentence(text: string): string {
  const m = text.match(/^[^.!?]*[.!?]/)
  return m ? m[0].trim() : text.trim()
}

// Decision Action Plan / Confidence to Act: 3–4 items (resp. at most 1), each
// "**lead phrase** — clause", pipe-separated (same wire format as <conditions>).
// Mirrors components/SynthesisCard.tsx's parseActionPlan exactly, so the
// static record page can render the same "What to do next" / "Before you
// act" sections the live session view shows. Falls back to { lead: '', rest: raw }
// if the model ever omits the ** markers — still renders as a plain line
// rather than disappearing.
function parseActionPlan(raw: string): { lead: string; rest: string }[] {
  return raw.split('|').map(s => s.trim()).filter(Boolean).map(item => {
    const m = item.match(/^\*\*(.+?)\*\*\s*[—-]\s*(.*)$/)
    return m ? { lead: m[1].trim(), rest: m[2].trim() } : { lead: '', rest: item }
  })
}

// Synthesis-only: pulls the <verdict> sentence, <conditions> list, <action_plan>
// items and <confidence_to_act> note out separately (rendered in dedicated
// callouts) and returns the remaining prose with all header tags removed but
// <tension> tags still in place, so renderSynthesisProse can locate and
// highlight the tension sentence inline — mirrors SynthesisCard.tsx exactly,
// so the static record page matches what was shown live on the session page.
function parseVerdictTension(raw: string): { verdict: string | null; conditions: string[]; keyQuestion: string | null; actionPlan: { lead: string; rest: string }[]; confidenceToAct: { lead: string; rest: string } | null; rest: string } {
  const vMatch  = raw.match(/<verdict>([\s\S]*?)<\/verdict>/)
  const verdict = vMatch?.[1]?.trim() ? firstSentence(vMatch[1].trim()) : null
  const cMatch  = raw.match(/<conditions>([\s\S]*?)<\/conditions>/)
  const conditions = cMatch?.[1] ? cMatch[1].split('|').map(s => s.trim()).filter(Boolean) : []
  // Sprint 1 follow-on: same primary source as the live session page
  // (components/SynthesisCard.tsx) — see that file for the full rationale.
  const kqMatch    = raw.match(/<key_question>([\s\S]*?)<\/key_question>/)
  const keyQuestion = kqMatch?.[1]?.trim() ?? null
  // Bug fix (tag-wiring guardrail gap): this file keeps its own independent copy
  // of tag-handling logic, separate from SynthesisCard.tsx, RecordExport.tsx and
  // the observation route — and it never learned about <action_plan> or
  // <confidence_to_act> at all. Since those two tags were absent from every
  // replace() below, they were never removed from "rest" (the flowing prose),
  // so they rendered as raw, visible <action_plan>/<confidence_to_act> markup
  // on this page instead of the styled sections SessionView shows. Extracting
  // them here — same shape/parser as SynthesisCard.tsx — fixes both the raw-tag
  // leak and the missing content in one pass.
  const apMatch = raw.match(/<action_plan>([\s\S]*?)<\/action_plan>/)
  const actionPlan = apMatch?.[1] ? parseActionPlan(apMatch[1]) : []
  const caMatch = raw.match(/<confidence_to_act>([\s\S]*?)<\/confidence_to_act>/)
  const confidenceToAct = caMatch?.[1] ? (parseActionPlan(caMatch[1])[0] ?? null) : null
  const rest = raw
    .replace(/<verdict>[\s\S]*?<\/verdict>\n*/g, '')
    .replace(/<verdict>[\s\S]*/g, '')   // guard: open tag without close
    // P2 fix: these two were never stripped here — the actual source of the
    // raw-tag leak the user saw, since "rest" is what gets rendered as body prose.
    .replace(/<verdict_lean>[\s\S]*?<\/verdict(?:_lean)?>\n*/g, '')
    .replace(/<conditions>[\s\S]*?<\/conditions>\n*/g, '')
    // Sprint 1 follow-on: extracted above into its own callout, same as
    // verdict/conditions — must not also remain in the flowing prose.
    .replace(/<key_question>[\s\S]*?<\/key_question>\n*/g, '')
    // Same fix as above: extracted into their own callouts, must not also
    // remain in the flowing prose. Includes a guard for the unclosed-tag case
    // (a synthesis run that got cut short before </action_plan>/</confidence_to_act>
    // arrived — see lib/ai-client.ts max_tokens note) so a truncated run degrades
    // to "missing section" rather than "raw tag markup visible on the page".
    .replace(/<action_plan>[\s\S]*?<\/action_plan>\n*/g, '')
    .replace(/<action_plan>[\s\S]*$/, '')          // guard: open tag without close
    .replace(/<confidence_to_act>[\s\S]*?<\/confidence_to_act>\n*/g, '')
    .replace(/<confidence_to_act>[\s\S]*$/, '')     // guard: open tag without close
    .replace(/<lens>[\s\S]*?<\/lens>/g, '')
    .replace(/<position>[\s\S]*?<\/position>/g, '')
    .replace(/<realcost>[\s\S]*?<\/realcost>/g, '')
    .replace(/<lean>[\s\S]*?<\/lean>/g, '')
    // Bug fix: <structural> and <assumption> were never stripped in this
    // synthesis-specific path either — same leak, different function.
    // <structural> is a citation meant to live elsewhere (full removal,
    // matching lens/position/realcost above); <assumption> wraps
    // substantive prose, so only the tag markers are removed, not the text.
    .replace(/<structural>[\s\S]*?<\/structural>/g, '')
    .replace(/<(?:lens|position|realcost|lean|structural)>[\s\S]*$/, '') // guard: open tag without close
    .replace(/<\/?(?:proceed|wait|mixed)>\s*/gi, '')          // guard: stray malformed lean-value tag
    .replace(/<\/?assumption>/g, '')
    .trimStart()
  return { verdict, conditions, keyQuestion, actionPlan, confidenceToAct, rest }
}

// ── Decision Brief markdown-lite renderer ───────────────────────────────────
// The Decision Brief persona (lib/personas.ts DECISION_BRIEF) writes "Key
// insights / Risks / Contradictions / Recommended direction / Open questions"
// as plain markdown — **bold** spans, section titles, "- " bullets — but
// nothing on this page ever parsed it. stripHeaderTags only removes machine
// tags (<lens>, <verdict>, etc.), so brief content fell through to the same
// plain whiteSpace:pre-wrap <p> used for ordinary advisor prose, leaving
// literal asterisks and dashes visible instead of headers/bold/bullets.
// Ports the same **bold**/header parsing components/RecordExport.tsx already
// does correctly for the PDF export, so this page matches it.
type BriefSegment = { text: string; bold: boolean }

function parseBriefInline(line: string): BriefSegment[] {
  const segments: BriefSegment[] = []
  const regex = /\*\*(.+?)\*\*/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = regex.exec(line)) !== null) {
    if (m.index > last) segments.push({ text: line.slice(last, m.index), bold: false })
    segments.push({ text: m[1], bold: true })
    last = regex.lastIndex
  }
  if (last < line.length) segments.push({ text: line.slice(last), bold: false })
  return segments.length ? segments : [{ text: line, bold: false }]
}

function renderBriefInline(line: string): React.ReactNode {
  return parseBriefInline(line).map((s, i) => s.bold
    ? <strong key={i} style={{ color: 'var(--text-1)', fontWeight: 600 }}>{s.text}</strong>
    : <span key={i}>{s.text}</span>)
}

// A standalone section header: either "**Header**" / "**Header**:" (the
// model's more common convention) or a short ALL-CAPS line with no markdown
// (the alternate convention it sometimes uses instead) — this page has to
// handle both since the same persona produces either depending on the run.
function briefLineHeader(trimmed: string): string | null {
  const mdMatch = trimmed.match(/^\*\*(.+?)\*\*:?\s*$/)
  if (mdMatch) return mdMatch[1]
  if (/^[A-Z][A-Z\s/&-]+$/.test(trimmed) && trimmed.length > 2 && trimmed.length < 40) return trimmed
  return null
}

function renderBriefBody(raw: string): React.ReactNode {
  const lines = stripHeaderTags(raw).split('\n')
  return (
    <>
      {lines.map((line, i) => {
        const trimmed = line.trim()
        if (!trimmed) return null
        const header = briefLineHeader(trimmed)
        if (header) {
          return (
            <p key={i} style={{
              fontFamily:    'var(--font-mono)',
              fontSize:      10.5,
              fontWeight:    700,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color:         'var(--gold)',
              margin:        i === 0 ? '0 0 8px' : '16px 0 8px',
            }}>
              {header}
            </p>
          )
        }
        const isBullet = /^[-*]\s+/.test(trimmed)
        const content  = isBullet ? trimmed.replace(/^[-*]\s+/, '') : trimmed
        return (
          <p key={i} style={{
            fontSize:    13.5,
            lineHeight:  1.75,
            color:       'var(--text-2)',
            margin:      '0 0 6px',
            paddingLeft: isBullet ? 14 : 0,
            position:    'relative',
          }}>
            {isBullet && <span style={{ position: 'absolute', left: 0 }}>–</span>}
            {renderBriefInline(content)}
          </p>
        )
      })}
    </>
  )
}

// Renders synthesis prose with the <tension> sentence highlighted inline —
// same visual treatment (background + underline) as SynthesisCard.tsx.
function renderSynthesisProse(rest: string): React.ReactNode {
  const tStart = rest.indexOf('<tension>')
  const tEnd   = rest.indexOf('</tension>')
  if (tStart === -1 || tEnd === -1 || tEnd <= tStart) {
    return <>{rest.replace(/<\/?tension>/g, '')}</>
  }
  const before  = rest.slice(0, tStart)
  const content = rest.slice(tStart + '<tension>'.length, tEnd)
  const after   = rest.slice(tEnd + '</tension>'.length)
  return (
    <>
      {before}
      <span style={{
        background:    'var(--tension-highlight-bg)',
        borderBottom:  '1px solid var(--tension-highlight-border)',
        paddingBottom: 1,
        borderRadius:  2,
      }}>{content}</span>
      {after}
    </>
  )
}

// Full synthesis message: verdict in a gold box (if present) + prose below
// with the tension sentence highlighted inline. Used for both the initial
// synthesis message and any reanalysis/pushback synthesis responses.
function renderSynthesisMessage(raw: string): React.ReactNode {
  const { verdict, conditions, keyQuestion, actionPlan, confidenceToAct, rest } = parseVerdictTension(raw)
  return (
    <>
      {verdict && (
        <div style={{
          borderLeft:   '5px solid var(--verdict-accent)',
          background:   'var(--verdict-bg)',
          borderRadius: '0 10px 10px 0',
          padding:      '14px 20px',
          marginBottom: 16,
          boxShadow:    'var(--verdict-shadow)',
        }}>
          <p style={{
            fontFamily:    'var(--font-mono)',
            fontSize:      9,
            fontWeight:    700,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color:         'var(--verdict-accent)',
            margin:        '0 0 8px',
          }}>
            Council verdict
          </p>
          <p style={{
            fontFamily:    'var(--font-display)',
            fontSize:      17,
            fontWeight:    500,
            color:         'var(--text-1)',
            lineHeight:    1.65,
            letterSpacing: '-0.01em',
            margin:        0,
          }}>
            {verdict}
          </p>
          {/* P2 parity fix: same "Conditional on" treatment as the live
              session view (components/SynthesisCard.tsx) — only rendered
              when conditions were actually supplied. */}
          {conditions.length > 0 && (
            <>
              <p style={{
                fontFamily:    'var(--font-mono)',
                fontSize:      9,
                fontWeight:    700,
                letterSpacing: '0.10em',
                textTransform: 'uppercase',
                color:         'var(--text-4)',
                margin:        '12px 0 6px',
              }}>
                Conditional on
              </p>
              <ul style={{
                margin:        0,
                paddingLeft:   16,
                display:       'flex',
                flexDirection: 'column',
                gap:           3,
              }}>
                {conditions.map((c, i) => (
                  <li key={i} style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.5 }}>
                    {c}
                  </li>
                ))}
              </ul>
            </>
          )}
          {/* Sprint 1 follow-on parity fix: same Worth Confirming treatment
              as the live session view — this file's own header comment says
              it should match what was shown live, and dropping this content
              silently on the permanent record would be a real loss, not
              just a cosmetic gap. */}
          {keyQuestion && (
            <div style={{
              background:   'var(--worth-confirming-highlight-bg)',
              borderLeft:   '2px solid var(--worth-confirming-highlight-border)',
              borderRadius: 4,
              padding:      '9px 11px',
              margin:       '12px 0 0',
            }}>
              <p style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.55, margin: 0 }}>
                <strong style={{ color: 'var(--text-1)' }}>Worth confirming</strong> — {keyQuestion}
              </p>
            </div>
          )}
        </div>
      )}
      <p style={{ fontSize: 13.5, lineHeight: 1.85, color: 'var(--text-2)', whiteSpace: 'pre-wrap', margin: 0 }}>
        {renderSynthesisProse(rest)}
      </p>
      {/* Parity fix: same "What to do next" / "Before you act" treatment as the
          live session view (components/SynthesisCard.tsx) — this content was
          previously extracted nowhere on this page, so it either leaked as raw
          <action_plan>/<confidence_to_act> markup or (when the tag opened but
          never closed, e.g. a truncated run) got silently swallowed by the
          unclosed-tag guard above. Rendering it here keeps the permanent record
          matching what was shown live. */}
      {actionPlan.length > 0 && (
        <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border-dim)' }}>
          <div style={{
            borderLeft:   '3px solid var(--action-accent)',
            background:   'var(--action-bg)',
            borderRadius: '0 10px 10px 0',
            padding:      '14px 20px',
          }}>
            <p style={{
              fontFamily:    'var(--font-mono)',
              fontSize:      9,
              fontWeight:    700,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color:         'var(--action-accent)',
              margin:        '0 0 2px',
            }}>
              What to do next
            </p>
            <p style={{ fontSize: 10, color: 'var(--text-4)', fontStyle: 'italic', margin: '0 0 12px' }}>
              in order of impact
            </p>
            {actionPlan.map((item, i) => (
              <p key={i} style={{
                fontSize:   13,
                color:      'var(--text-2)',
                lineHeight: 1.7,
                margin:     i === actionPlan.length - 1 ? 0 : '0 0 10px',
              }}>
                {item.lead && (
                  <strong style={{ color: 'var(--action-accent)', fontWeight: 600 }}>{item.lead}</strong>
                )}
                {item.lead && ' — '}
                {item.rest}
              </p>
            ))}
            {confidenceToAct && (
              <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--action-note-border)' }}>
                <p style={{
                  fontFamily:    'var(--font-mono)',
                  fontSize:      9,
                  fontWeight:    700,
                  letterSpacing: '0.10em',
                  textTransform: 'uppercase',
                  color:         'var(--text-4)',
                  margin:        '0 0 6px',
                }}>
                  Before you act
                </p>
                <p style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.6, margin: 0 }}>
                  {confidenceToAct.lead && (
                    <strong style={{ color: 'var(--action-accent)', fontWeight: 600 }}>{confidenceToAct.lead}</strong>
                  )}
                  {confidenceToAct.lead && ' — '}
                  {confidenceToAct.rest}
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}

// Strip the examiner-style wrapper that automatic advisor-to-advisor context
// sharing prepends to pushback messages before they are saved to the DB —
// mirrors the same function in the brief PDF route so both surfaces show
// only the raw pushback text.
function cleanPushbackText(raw: string): string {
  return raw
    .replace(/^[^"\n]*[:\n]+\s*/i, '')
    // Bug fix: this required the closing quote to sit at (or right near) the
    // end of the string. That was true for the directly-challenged advisor
    // (PersonaPanel.tsx stores the raw challenge text with no wrapper at all),
    // but the five auto-shared advisors receive the full examinerMsg template
    // (components/SessionView.tsx, handleShareContext) — which appends
    // "Reassess it independently through your own lens..." and "Provide a
    // concise update..." AFTER the closing quote. Since nothing used to
    // follow the quote, that instructional tail was left in place and
    // rendered as if it were part of the pushback. Matching the FIRST quoted
    // segment (non-greedy, no end anchor) instead of "everything to the end
    // is one big quote" fixes this regardless of what trails it.
    .replace(/^"([\s\S]*?)"[\s\S]*$/, '$1')
    // Belt-and-suspenders for the same wrapper's instruction lines, in case a
    // stored message ever lacks the quote marks.
    .replace(/\s*Reassess it independently through your own lens[\s\S]*$/i, '')
    .replace(/\s*Provide a concise update[\s\S]*$/i, '')
    .trim()
}

interface Props {
  params: Promise<{ id: string }>
}

const PERSONA_ORDER: PersonaKey[] = [
  'decision_brief',
  'synthesis',
  'contrarian',
  'risk_architect',
  'pattern_analyst',
  'stakeholder_mirror',
  'elder',
  'competitor',
]

function decryptText(value: string | null | undefined): string {
  return decrypt(value) ?? ''
}

// TSD §2.7.3 / handover PENDING fix: the Decision Arc timeline used to be
// built from `childSessions` alone — direct children of the root only
// (single hop). Correct for a decision reanalyzed once (root ← revisit),
// but a decision reanalyzed twice or more (root ← B ← C) has a grandchild
// (C) that never satisfies `parent_session_id = root.id`, so it silently
// never appeared in the timeline when viewed from the root — even though
// each individual link (root←B, B←C) was itself perfectly correct.
//
// Walks the chain outward one level at a time, breadth-first, starting
// from the root's already-fetched direct children, until a level returns
// nothing new. An application-level loop rather than a recursive SQL CTE
// on purpose: reanalyze chains are expected to stay short in practice (a
// handful of revisits at most), so a few extra sequential round trips for
// the rare long chain is simpler to reason about, debug, and test than a
// WITH RECURSIVE query for a case this uncommon.
async function walkDescendantChain(
  rootId: string,
  directChildren: { id: string; created_at: string }[],
  supabase: ReturnType<typeof createServiceClient>,
): Promise<{ id: string; created_at: string }[]> {
  const all: { id: string; created_at: string }[] = [...directChildren]
  let frontier = directChildren.map(c => c.id)
  const seen = new Set<string>([rootId, ...frontier])

  // Hard cap, not just a loop-terminator: bounds the worst case if a data
  // integrity bug ever produced a cycle, so one page load can't turn into
  // an unbounded number of queries. 25 hops is far beyond any realistic
  // reanalyze chain — this is a safety rail, not an expected depth.
  const MAX_HOPS = 25
  for (let hop = 0; hop < MAX_HOPS && frontier.length > 0; hop++) {
    const { data: nextLevel } = await supabase
      .from('sessions')
      .select('id, created_at')
      .in('parent_session_id', frontier)

    const fresh = (nextLevel ?? []).filter(c => !seen.has(c.id))
    if (fresh.length === 0) break

    for (const c of fresh) seen.add(c.id)
    all.push(...fresh)
    frontier = fresh.map(c => c.id)
  }

  return all
}

export default async function RecordPage({ params }: Props) {
  const { id } = await params
  const supabase = createServiceClient()

  const [sessionResult, messagesResult, outcomeResult, childSessionsResult, graphEdgeCountResult] = await Promise.all([
    supabase.from('sessions').select('*').eq('id', id).single(),
    supabase.from('messages').select('*').eq('session_id', id).order('created_at', { ascending: true }),
    supabase.from('outcomes').select('*').eq('session_id', id).single(),
    // RET-5 Sprint 1: any sessions that revisit THIS one (forward link)
    supabase.from('sessions').select('id, created_at').eq('parent_session_id', id).order('created_at', { ascending: false }),
    // Sprint G4 breadcrumb: count graph edges touching this session (Mirror-gated, shown only when > 0)
    supabase.from('graph_edges')
      .select('*', { count: 'exact', head: true })
      .or(`session_id_a.eq.${id},session_id_b.eq.${id}`)
      .is('dismissed_at', null),
  ])

  if (sessionResult.error || !sessionResult.data) notFound()

  const session = {
      ...sessionResult.data,
      decision_text: decryptText(sessionResult.data.decision_text),
      context_text: decrypt(sessionResult.data.context_text),
    }
  
    const messages = (messagesResult.data ?? []).map(msg => ({
      ...msg,
      content: decryptText(msg.content),
    }))

  const outcome  = outcomeResult.data
    ? { ...outcomeResult.data, what_decided: decryptText(outcomeResult.data.what_decided) }
    : null

  // P0 fix: RecordTour previously had no awareness of the user's real decision
  // count or of prior tour completion — it was gated on localStorage alone, so
  // an established user (e.g. 5 decisions already on record) opening the app on
  // a fresh device/PWA install would see a "first decision" tour here too, the
  // same bug already found and fixed on the Session View / Council tour. Both
  // queries depend on session.user_id, which isn't known until sessionResult
  // above has resolved, so this is a second, smaller Promise.all rather than
  // folded into the first one.
  const [totalSessionCountResult, tourProfileResult] = await Promise.all([
    session.user_id
      ? supabase.from('sessions').select('*', { count: 'exact', head: true }).eq('user_id', session.user_id)
      : Promise.resolve({ count: null }),
    session.user_id
      ? supabase.from('user_profiles').select('record_tour_completed_at').eq('user_id', session.user_id).single()
      : Promise.resolve({ data: null }),
  ])
  const totalSessionCount = totalSessionCountResult.count ?? undefined
  const recordTourDone    = !!tourProfileResult?.data?.record_tour_completed_at

  // Note: per-session bias note moved to the live SessionView page (SB-3) —
  // it now surfaces right after synthesis completes, when the user is most
  // engaged, instead of on the static record page after the fact.

  const dateStr = formatDateTime(session.created_at)

  // ── RET-5 Sprint 1: revisit breadcrumbs (linked re-ask, no AI behavior change) ──
  // Backward: this session originated from a Reanalyze on an earlier one.
  // Forward: this session has since been revisited (one or more times).
  let parentLink: { id: string; decisionPreview: string; createdAt: string } | null = null
  if (session.parent_session_id) {
    const { data: parentRow } = await supabase
      .from('sessions')
      .select('id, decision_text, created_at')
      .eq('id', session.parent_session_id)
      .single()
    if (parentRow) {
      const preview = decryptText(parentRow.decision_text)
      parentLink = {
        id: parentRow.id,
        decisionPreview: preview.length > 70 ? preview.slice(0, 70).replace(/\s+\S*$/, '') + '…' : preview,
        createdAt: parentRow.created_at,
      }
    }
  }

  const childSessions = childSessionsResult.data ?? []

  // Same underlying gap as the root timeline below, fixed the same way:
  // childLink's count used to be childSessions.length (direct children of
  // THIS session only) — correct for one revisit, wrong for a chain that
  // continues past this session's own immediate child (e.g. viewing B in
  // A ← B ← C ← D would only ever count C, never D). Walk once here,
  // unconditionally (not just when this session is a chain root), so both
  // the breadcrumb and the root timeline below draw from the same correct
  // full-chain data.
  const fullDescendants = childSessions.length > 0
    ? await walkDescendantChain(session.id, childSessions, supabase)
    : []

  const childLink = childSessions[0]
    ? { id: childSessions[0].id, createdAt: childSessions[0].created_at, count: fullDescendants.length }
    : null

  // ── RET-5 Sprint 3: Decision Arc timeline — only on root sessions with ≥1 revisit ──
  // Breadcrumbs on revisit pages already link back to root; timeline lives here.
  // Adds at most 3 DB queries, only when this page is a chain root.
  let timelineEntries:     TimelineEntry[] | null = null
  let hasMirrorAccess      = false
  let avgCalibrationDelta: number | null = null

  const isChainRoot = !session.parent_session_id && childSessions.length > 0

  if (isChainRoot) {
    // Reuses fullDescendants computed above (for the breadcrumb) — a root
    // session's full descendant chain is exactly what the timeline needs
    // too, no reason to walk it twice. Was `childSessions.map(...)`
    // (direct children only) before this fix; see walkDescendantChain's
    // own comment for why that silently dropped anything past the first
    // revisit.
    const childIds = fullDescendants.map((c: { id: string }) => c.id)
    const allIds   = [session.id, ...childIds]

    const [childDetailsResult, allOutcomesResult] = await Promise.all([
      supabase
        .from('sessions')
        .select('id, decision_text, created_at')
        .in('id', childIds),
      supabase
        .from('outcomes')
        .select('session_id, what_decided, council_helped, calibration_delta')
        .in('session_id', allIds),
    ])

    // Mirror access — only checked when there's a chain worth showing the tile for
    if (session.user_id) {
      const accessState = await getMirrorAccessState(session.user_id, supabase)
      hasMirrorAccess = accessState === 'unlocked'
    }

    // Build outcome map — what_decided is encrypted
    const outcomeMap: Record<string, {
      whatDecided:      string
      councilHelped:    string
      calibrationDelta: number | null
    }> = {}
    for (const o of allOutcomesResult.data ?? []) {
      outcomeMap[o.session_id] = {
        whatDecided:      decryptText(o.what_decided),
        councilHelped:    o.council_helped,
        calibrationDelta: o.calibration_delta ?? null,
      }
    }

    // calibration_delta average — only from sittings that have it
    const deltas = (allOutcomesResult.data ?? [])
      .map(o => o.calibration_delta)
      .filter((d): d is number => typeof d === 'number')
    avgCalibrationDelta = deltas.length > 0
      ? parseFloat((deltas.reduce((a, b) => a + b, 0) / deltas.length).toFixed(1))
      : null

    // Root entry first, then children in ascending date order
    const SNIPPET_LEN = 80
    const snippet = (text: string) =>
      text.length > SNIPPET_LEN ? text.slice(0, SNIPPET_LEN).replace(/\s+\S*$/, '') + '…' : text

    const rootEntry: TimelineEntry = {
      id:              session.id,
      createdAt:       session.created_at,
      decisionSnippet: snippet(session.decision_text),
      isCurrent:       session.id === id,
      outcome:         outcomeMap[session.id] ?? null,
    }

    const childEntries: TimelineEntry[] = [...(childDetailsResult.data ?? [])]
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      .map(c => ({
        id:              c.id,
        createdAt:       c.created_at,
        decisionSnippet: snippet(decryptText(c.decision_text)),
        isCurrent:       c.id === id,
        outcome:         outcomeMap[c.id] ?? null,
      }))

    timelineEntries = [rootEntry, ...childEntries]
  }


  // Sprint G4 breadcrumb: only shown to Mirror users with actual connections.
  // hasMirrorAccess is already set above for chain-root sessions. For non-root
  // sessions it stays false until here — re-check only when a graph edge exists
  // (avoids an extra DB call for the common case of no connections yet).
  const rawGraphCount = graphEdgeCountResult.count ?? 0
  let graphConnectionCount = 0
  if (rawGraphCount > 0 && session.user_id) {
    if (!hasMirrorAccess) {
      const accessState = await getMirrorAccessState(session.user_id, supabase)
      hasMirrorAccess = accessState === 'unlocked'
    }
    if (hasMirrorAccess) graphConnectionCount = rawGraphCount
  }

  // Group by persona, deduplicated.
  // If a session was re-run (e.g. pre-Sprint 24b or via examiner update), multiple assistant
  // rows exist per persona key. Keep only the LAST initial assistant message per persona —
  // that is, the last assistant message before any user (pushback) message in that group.
  // Pushback exchanges (user + following assistant) are preserved in full.
  const raw: Record<string, { role: string; content: string }[]> = {}
  for (const msg of messages) {
    if (!raw[msg.persona]) raw[msg.persona] = []
    raw[msg.persona].push({ role: msg.role, content: msg.content })
  }
  const byPersona: Record<string, { role: string; content: string }[]> = {}
  for (const [key, msgs] of Object.entries(raw)) {
    const firstUserIdx = msgs.findIndex(m => m.role === 'user')
    const initialBlock  = firstUserIdx === -1 ? msgs : msgs.slice(0, firstUserIdx)
    const exchanges     = firstUserIdx === -1 ? []   : msgs.slice(firstUserIdx)
    // Of potentially multiple initial assistant messages, keep only the last
    const latestInitial = initialBlock.filter(m => m.role === 'assistant').slice(-1)
    byPersona[key] = [...latestInitial, ...exchanges]
  }

  return (
    <>
      {/* ── Entrance animations + page-specific styles ──────── */}
      <style>{`
        @keyframes recordFadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .rec-fade   { animation: recordFadeIn 380ms ease-out both; }
        .rec-fade-1 { animation-delay: 0ms; }
        .rec-fade-2 { animation-delay: 80ms; }
        .rec-fade-3 { animation-delay: 160ms; }
        .rec-fade-4 { animation-delay: 240ms; }

        /* Record hero card — matches session page sv-hero */
        .rec-hero {
          background: var(--bg-card);
          border: 1px solid var(--border-mid);
          border-radius: 18px;
          box-shadow: var(--shadow-card);
          padding: 24px 28px 20px;
          position: relative;
          /* NOTE: no overflow:hidden — same Android WebKit line-clamp sibling
             clipping bug as sv-hero on the session page. */
          margin-bottom: 16px;
        }
        .rec-hero::before {
          content: '';
          position: absolute;
          top: 0; left: 0; right: 0;
          height: 1px;
          background: linear-gradient(90deg, transparent, var(--gold-dim), transparent);
          pointer-events: none;
        }
        @media (max-width: 600px) {
          .rec-hero { padding: 18px 16px 16px; }
        }
        .rec-hero-decision {
          font-family: var(--font-display);
          font-size: clamp(17px, 2.2vw, 22px);
          font-weight: 500;
          line-height: 1.45;
          letter-spacing: -0.015em;
          color: var(--text-1);
        }
        .rec-hero-context {
          font-size: 12.5px;
          line-height: 1.65;
          color: var(--text-3);
        }

        /* Persona card tiers */
        .rec-persona-elevated {
          border-radius: 18px;
          overflow: hidden;
          background: var(--bg-card);
          box-shadow: var(--shadow-card);
        }
        .rec-persona-standard {
          border-radius: 14px;
          overflow: hidden;
          background: var(--bg-card);
        }
        .rec-persona-header-brief {
          padding: 16px 22px;
          border-bottom: 1px solid var(--border-dim);
          background: var(--gold-glow);
          border-top: 2px solid var(--gold-dim);
        }
        .rec-persona-header-synthesis {
          padding: 16px 22px;
          border-bottom: 1px solid var(--border-dim);
          background: var(--synthesis-done);
        }
        .rec-persona-header-standard {
          padding: 13px 18px;
          border-bottom: 1px solid var(--border-dim);
          background: var(--bg-card-alt);
        }
        /* Light mode: card-alt is readable; dark mode: it's #101628 */

        /* Pushback exchange styles */
        .rec-pushback-user {
          border-radius: 8px;
          padding: 11px 14px 11px 16px;
          background: var(--bg-inset);
          border: 1px solid var(--border-dim);
          border-left: 2px solid var(--gold-dim);
        }
        .rec-pushback-response {
          padding-left: 14px;
          border-left: 1px solid var(--border-dim);
          margin-left: 2px;
        }

        /* Bottom tray */
        .rec-bottom-tray {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
          justify-content: space-between;
        }
        .rec-bottom-left { display: flex; gap: 8px; flex-wrap: wrap; }
        @media (max-width: 480px) {
          .rec-bottom-tray { flex-direction: column; align-items: stretch; }
          .rec-bottom-left { flex-direction: column; }
          .rec-bottom-left .btn-ghost { justify-content: center; }
        }

        /* Header flex wrap on mobile */
        .rec-header-row {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 16px;
          flex-wrap: wrap;
          margin-bottom: 24px;
        }
        @media (max-width: 480px) {
          .rec-header-row { gap: 12px; }
          .rec-header-row > a { width: 100%; }
          .rec-header-row > a button { width: 100%; justify-content: center; }
        }
      `}</style>

      <div style={{ minHeight: '100vh', background: 'var(--bg-void)', padding: '40px 16px 64px' }}>
        <div style={{ maxWidth: '48rem', margin: '0 auto' }}>

          {/* ── Page Header ────────────────────────────────────── */}
          <div className="rec-header-row rec-fade rec-fade-1">
            <div>
              {/* Back button — exact component + inline style override preserved */}
              <BackButton
                label="← Back"
                style={{
                  padding: 0,
                  fontSize: 12,
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-4)',
                  cursor: 'pointer',
                  marginBottom: 12,
                  display: 'block',
                  fontFamily: 'inherit',
                  minHeight: 0,
                }}
              />
              <Link href="/" style={{ textDecoration: 'none' }}>
                <span style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 13,
                  fontWeight: 600,
                  letterSpacing: '0.22em',
                  color: 'var(--gold)',
                  textTransform: 'uppercase',
                  cursor: 'pointer',
                  display: 'block',
                  marginBottom: 6,
                }}>
                  Quorum
                </span>
              </Link>
              <p style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: 'var(--text-4)',
              }}>
                Decision Record · {dateStr}
              </p>

              {/* RET-5 Sprint 1: revisit breadcrumbs */}
              {parentLink && (
                <Link href={`/record/${parentLink.id}`} style={{ textDecoration: 'none' }} title={parentLink.decisionPreview}>
                  <p style={{
                    fontSize: 11.5, color: 'var(--gold)', marginTop: 6,
                    display: 'flex', alignItems: 'center', gap: 5,
                  }}>
                    ← Revisiting a decision from {formatDate(parentLink.createdAt)}
                  </p>
                </Link>
              )}
              {childLink && (
                <Link href={`/record/${childLink.id}`} style={{ textDecoration: 'none' }}>
                  <p style={{
                    fontSize: 11.5, color: 'var(--gold)', marginTop: 6,
                    display: 'flex', alignItems: 'center', gap: 5,
                  }}>
                    Revisited on {formatDate(childLink.createdAt)}
                    {childLink.count > 1 ? ` (+${childLink.count - 1} more)` : ''} →
                  </p>
                </Link>
              )}

              {/* Sprint G4: graph breadcrumb — Mirror users with connections only */}
              {graphConnectionCount > 0 && (
                <Link href="/mirror#msec-graph" style={{ textDecoration: 'none' }}>
                  <p style={{
                    fontSize: 11.5, color: 'var(--text-4)', marginTop: 6,
                    display: 'flex', alignItems: 'center', gap: 5,
                  }}>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, opacity: 0.6 }}>
                      <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
                      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
                    </svg>
                    Connected to {graphConnectionCount} decision{graphConnectionCount !== 1 ? 's' : ''} in your graph
                  </p>
                </Link>
              )}
            </div>

            <Link href="/">
              <button
                className="btn-ghost"
                data-tour-id="record-new-decision"
                style={{
                  padding: '10px 18px',
                  fontSize: 12.5,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  minHeight: 44,
                  marginTop: 4,
                }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
                New Decision
              </button>
            </Link>
          </div>

          {/* S2-03 — Trust badge strip: encryption, visibility, AI disclosure */}
          <TrustBadgeStrip encryptionEnabled={!!process.env.DB_ENCRYPTION_KEY} securityHref="/security" />

          {/* ── Decision Hero Card ─────────────────────────────── */}
          <div className="rec-hero rec-fade rec-fade-2" data-tour-id="record-decision">
            <p style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: 'var(--text-4)',
              marginBottom: 10,
            }}>
              The Decision
            </p>

            <RecordDecisionHero
              decisionText={session.decision_text}
              contextText={session.context_text}
            />
          </div>

          {/* ── Validation prompt — only place a returning user (e.g. from   */}
          {/* the validation-nudge email) can actually answer this. Lives    */}
          {/* right after the decision itself, before any secondary asks.    */}
          {/* Self-hides via its own fetch if already confirmed/corrected.   */}
          {session.validation_state === 'pending' && (
            <div className="rec-fade rec-fade-2" style={{ marginBottom: 4 }}>
              <ValidationCard
                sessionId={session.id}
                authToken={null}
                userEmail={session.user_email ?? null}
              />
            </div>
          )}

          {/* ── Outcome Tracker ────────────────────────────────── */}
          <div className="rec-fade rec-fade-3" style={{ marginBottom: 12 }} data-tour-id="record-outcome">
            <OutcomeTracker
              sessionId={session.id}
              existingOutcome={outcome}
              preDecisionConfidence={session.pre_decision_confidence ?? null}
            />
          </div>

          {/* ── Decision Brief CTA ─────────────────────────────── */}
          <div className="rec-fade rec-fade-3" style={{ marginBottom: 12 }} data-tour-id="record-decision-brief">
            <BriefCTA sessionId={session.id} />
          </div>

          {/* ── Session count signal (2–4 decisions) — EarlyEchoCard ── */}
          {/* Reads localStorage client-side; hidden at 0–1 or 5+ sessions */}
          <div className="rec-fade rec-fade-3" style={{ marginBottom: 12 }}>
            <EarlyEchoCard sessionId={session.id} />
          </div>

          {/* ── Email capture — shown to unlinked users only ────── */}
          <div className="rec-fade rec-fade-3" style={{ marginBottom: 28 }}>
            <EmailCaptureCard sessionId={session.id} />
          </div>

          {/* ── Persona Sections ───────────────────────────────── */}
          <div className="rec-fade rec-fade-4" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {PERSONA_ORDER.map(key => {
              const msgs = byPersona[key]
              if (!msgs || msgs.length === 0) return null
              const persona    = PERSONAS[key]
              const isSynthesis = key === 'synthesis'
              const isBrief     = key === 'decision_brief'
              const isElevated  = isSynthesis || isBrief

              return (
                <div
                  key={key}
                  className={isElevated ? 'rec-persona-elevated' : 'rec-persona-standard'}
                  style={{
                    border: isBrief
                      ? '1px solid rgba(201,168,76,0.35)'
                      : isSynthesis
                      ? '1px solid var(--green-border)'
                      : '1px solid var(--border-dim)',
                  }}
                >
                  {/* ── Card header ── */}
                  <div className={
                    isBrief ? 'rec-persona-header-brief'
                    : isSynthesis ? 'rec-persona-header-synthesis'
                    : 'rec-persona-header-standard'
                  }>
                    {isElevated ? (
                      <>
                        {/* Elevated: display serif name */}
                        <p style={{
                          fontFamily: 'var(--font-display)',
                          fontSize: 17,
                          fontWeight: 500,
                          letterSpacing: '-0.01em',
                          color: isBrief ? 'var(--gold)' : 'var(--text-1)',
                          margin: 0,
                          marginBottom: 3,
                        }}>
                          {persona.label}
                        </p>
                        <p style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: 10,
                          letterSpacing: '0.1em',
                          textTransform: 'uppercase',
                          color: isBrief ? 'var(--gold-dim)' : 'var(--text-4)',
                          margin: 0,
                        }}>
                          {persona.tagline}
                        </p>
                      </>
                    ) : (
                      <>
                        {/* Standard: compact mono label + smaller name */}
                        <p style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: 9.5,
                          letterSpacing: '0.12em',
                          textTransform: 'uppercase',
                          color: 'var(--text-4)',
                          margin: 0,
                          marginBottom: 3,
                        }}>
                          Advisor
                        </p>
                        <p style={{
                          fontFamily: 'var(--font-display)',
                          fontSize: 15,
                          fontWeight: 500,
                          letterSpacing: '-0.01em',
                          color: 'var(--gold)',
                          margin: 0,
                          marginBottom: 2,
                        }}>
                          {persona.label}
                        </p>
                        <p style={{
                          fontSize: 11,
                          color: 'var(--text-4)',
                          margin: 0,
                          fontStyle: 'italic',
                        }}>
                          {persona.tagline}
                        </p>
                      </>
                    )}
                  </div>

                  {/* ── Card body ── */}
                  <div style={{
                    padding: isElevated ? '20px 22px' : '16px 18px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 16,
                  }}>
                    {msgs.map((msg, i) => (
                      <div key={i}>
                        {msg.role === 'user' ? (
                          <div className="rec-pushback-user">
                            <p style={{
                              fontFamily: 'var(--font-mono)',
                              fontSize: 9.5,
                              letterSpacing: '0.1em',
                              textTransform: 'uppercase',
                              color: 'var(--text-4)',
                              marginBottom: 6,
                            }}>
                              You challenged
                            </p>
                            <p style={{ fontSize: 13, color: 'var(--text-3)', lineHeight: 1.6 }}>
                              {cleanPushbackText(msg.content)}
                            </p>
                          </div>
                        ) : (
                          /* If this assistant message follows a user pushback, indent it */
                          i > 0 && msgs[i - 1]?.role === 'user' ? (
                            <div className="rec-pushback-response">
                              {isSynthesis ? renderSynthesisMessage(msg.content) : isBrief ? renderBriefBody(msg.content) : (
                                <p style={{ fontSize: 13.5, lineHeight: 1.85, color: 'var(--text-2)', whiteSpace: 'pre-wrap' }}>
                                  {stripHeaderTags(msg.content)}
                                </p>
                              )}
                            </div>
                          ) : (
                            isSynthesis ? renderSynthesisMessage(msg.content) : isBrief ? renderBriefBody(msg.content) : (
                              <p style={{ fontSize: 13.5, lineHeight: 1.85, color: 'var(--text-2)', whiteSpace: 'pre-wrap' }}>
                                {stripHeaderTags(msg.content)}
                              </p>
                            )
                          )
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>

          {/* ── Decision Arc timeline — root sessions with ≥1 revisit ──── */}
          {/* RET-5 Sprint 3: free and ungated. Mirror conversion tile additive at bottom. */}
          {timelineEntries && (
            <div className="rec-fade rec-fade-4" style={{ marginTop: 24, marginBottom: 8 }}>
              <DecisionTimeline
                entries={timelineEntries}
                currentSessionId={id}
                hasMirrorAccess={hasMirrorAccess}
                avgCalibrationDelta={avgCalibrationDelta}
              />
            </div>
          )}

          {/* ── Bottom Tray ────────────────────────────────────── */}
          <div style={{ marginTop: 44 }}>
            <div className="gold-rule" style={{ marginBottom: 22 }} />
            <div className="rec-bottom-tray">
              <div className="rec-bottom-left">
                <BackButton
                  label="← Back"
                  style={{ padding: '10px 18px', fontSize: 13, minHeight: 44 }}
                />
                <ReanalyzeDrawer
                  sessionId={session.id}
                  decisionText={session.decision_text}
                  contextText={session.context_text}
                  userId={session.user_id ?? null}
                  encryptionEnabled={!!process.env.DB_ENCRYPTION_KEY}
                />
              </div>
              <Link href="/">
                <button
                  className="btn-ghost"
                  style={{ padding: '10px 18px', fontSize: 13, minHeight: 44 }}
                >
                  New Decision
                </button>
              </Link>
            </div>

            {/* Session watermark */}
            <p style={{
              marginTop: 28,
              textAlign: 'center',
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              letterSpacing: '0.1em',
              color: 'var(--text-4)',
              opacity: 0.6,
            }}>
              Quorum · {id.slice(0, 8)}
            </p>
          </div>

        </div>
      </div>

      {/* ── Sprint TOUR-1: First-decision record tour (client component) ── */}
      <RecordTour totalSessionCount={totalSessionCount} tourDone={recordTourDone} />
    </>
  )
}
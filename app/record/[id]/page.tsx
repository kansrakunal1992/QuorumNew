import { notFound } from 'next/navigation'
import { formatDateTime } from '@/lib/dates'
import { createServiceClient } from '@/lib/supabase'
import OutcomeTracker from '@/components/OutcomeTracker'
import BriefCTA from '@/components/BriefCTA'
import EmailCaptureCard from '@/components/EmailCaptureCard'
import EarlyEchoCard from '@/components/EarlyEchoCard'
import BiasNoteCard from '@/components/BiasNoteCard'
import Link from 'next/link'
import ReanalyzeDrawer from '@/components/ReanalyzeDrawer'
import BackButton from '@/components/BackButton'
import { PERSONAS } from '@/lib/personas'
import { BIAS_PARAMETERS } from '@/lib/bias-scorer'
import type { PersonaKey } from '@/lib/types'
import { decrypt } from '@/lib/encryption'
import TrustBadgeStrip from '@/components/TrustBadgeStrip'

// Strip <lens>, <position>, <realcost> tags stored in DB — rendered separately in PersonaPanel
// but never cleaned before persistence, so record page must strip them before display
function stripHeaderTags(raw: string): string {
  return raw
    .replace(/<lens>[\s\S]*?<\/lens>/g, '')
    .replace(/<position>[\s\S]*?<\/position>/g, '')
    .replace(/<realcost>[\s\S]*?<\/realcost>/g, '')
    .replace(/^\s+/, '')
}

// Strip the examiner-style wrapper that "share to all advisors" prepends to user
// pushback messages before they are saved to the DB — mirrors the same function
// in the brief PDF route so both surfaces show only the raw pushback text.
function cleanPushbackText(raw: string): string {
  return raw
    .replace(/^The user submitted the following[^"\n]*[:\n]+\s*/i, '')
    .replace(/^"([\s\S]*)"[\s]*$/, '$1')
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

export default async function RecordPage({ params }: Props) {
  const { id } = await params
  const supabase = createServiceClient()

  const [sessionResult, messagesResult, outcomeResult] = await Promise.all([
    supabase.from('sessions').select('*').eq('id', id).single(),
    supabase.from('messages').select('*').eq('session_id', id).order('created_at', { ascending: true }),
    supabase.from('outcomes').select('*').eq('session_id', id).single(),
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

  // ── Item A: bias note for this session — server-rendered, free, no Mirror gate ──
  // Looks up bias_library rows that include this session_id, scoped to whichever
  // identity tier the session has (user_id > user_email > device_id — same
  // precedence used when the row was written in /api/bias-score). Only
  // signal_type === 'distorting' detections are surfaced; 'neutral' and
  // 'adaptive' classifications are not shown as a caution here. Shows at most
  // one note — the strongest signal for this specific session, not a
  // longitudinal claim (no detection_count threshold).
  let biasNote: { label: string; reasoning: string } | null = null
  {
    const identityCol =
      session.user_id    ? 'user_id'    :
      session.user_email ? 'user_email' :
      session.device_id  ? 'device_id'  : null

    const identityVal =
      session.user_id ?? session.user_email ?? session.device_id ?? null

    if (identityCol && identityVal) {
      const { data: biasRows } = await supabase
        .from('bias_library')
        .select('bias_parameter, activation_contexts')
        .eq(identityCol, identityVal)
        .contains('session_ids', [session.id])

      type SessionBiasContext = {
        reasoning?:        string
        signal_type?:      'distorting' | 'neutral' | 'adaptive'
        prosecutor_score?: number
      }

      const candidates = (biasRows ?? [])
        .map(row => {
          const contexts = row.activation_contexts as Record<string, SessionBiasContext> | null
          const ctx = contexts?.[session.id]
          return ctx ? { biasKey: row.bias_parameter as string, ctx } : null
        })
        .filter((c): c is { biasKey: string; ctx: SessionBiasContext } => c !== null)
        .filter(c => c.ctx.signal_type === 'distorting' && !!c.ctx.reasoning)
        .sort((a, b) => (b.ctx.prosecutor_score ?? 0) - (a.ctx.prosecutor_score ?? 0))

      const top = candidates[0]
      if (top) {
        const param = BIAS_PARAMETERS.find(b => b.key === top.biasKey)
        const label = param?.label ?? top.biasKey.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
        const rawReasoning = top.ctx.reasoning!.trim()
        const reasoning = rawReasoning.length > 220
          ? rawReasoning.slice(0, 220).replace(/\s+\S*$/, '') + '…'
          : rawReasoning
        biasNote = { label, reasoning }
      }
    }
  }

  const dateStr = formatDateTime(session.created_at)

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
                label="← Back to Council"
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
            </div>

            <Link href="/">
              <button
                className="btn-ghost"
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
          <TrustBadgeStrip encryptionEnabled={!!process.env.DB_ENCRYPTION_KEY} />

          {/* ── Decision Hero Card ─────────────────────────────── */}
          <div className="rec-hero rec-fade rec-fade-2">
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

            <p className="rec-hero-decision">
              {session.decision_text}
            </p>

            {session.context_text && (
              <>
                <div className="gold-rule" style={{ margin: '14px 0' }} />
                <p style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 9.5,
                  letterSpacing: '0.13em',
                  textTransform: 'uppercase',
                  color: 'var(--text-4)',
                  marginBottom: 6,
                }}>
                  Context
                </p>
                <p style={{ fontSize: 12.5, lineHeight: 1.65, color: 'var(--text-3)' }}>
                  {session.context_text}
                </p>
              </>
            )}
          </div>

          {/* ── Outcome Tracker ────────────────────────────────── */}
          <div className="rec-fade rec-fade-3" style={{ marginBottom: 12 }}>
            <OutcomeTracker sessionId={session.id} existingOutcome={outcome} />
          </div>

          {/* ── Bias note for this session — free, no Mirror gate ──── */}
          {/* Hidden entirely when biasNote is null (BiasNoteCard returns null) */}
          <div className="rec-fade rec-fade-3" style={{ marginBottom: 12 }}>
            <BiasNoteCard note={biasNote} />
          </div>

          {/* ── Decision Brief CTA ─────────────────────────────── */}
          <div className="rec-fade rec-fade-3" style={{ marginBottom: 12 }}>
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
                              <p style={{ fontSize: 13.5, lineHeight: 1.85, color: 'var(--text-2)', whiteSpace: 'pre-wrap' }}>
                                {stripHeaderTags(msg.content)}
                              </p>
                            </div>
                          ) : (
                            <p style={{ fontSize: 13.5, lineHeight: 1.85, color: 'var(--text-2)', whiteSpace: 'pre-wrap' }}>
                              {stripHeaderTags(msg.content)}
                            </p>
                          )
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>

          {/* ── Bottom Tray ────────────────────────────────────── */}
          <div style={{ marginTop: 44 }}>
            <div className="gold-rule" style={{ marginBottom: 22 }} />
            <div className="rec-bottom-tray">
              <div className="rec-bottom-left">
                <BackButton
                  label="← Back to Council"
                  style={{ padding: '10px 18px', fontSize: 13, minHeight: 44 }}
                />
                <ReanalyzeDrawer
                  sessionId={session.id}
                  decisionText={session.decision_text}
                  contextText={session.context_text}
                  userId={session.user_id ?? null}
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
    </>
  )
}
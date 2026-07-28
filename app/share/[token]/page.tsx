// app/share/[token]/page.tsx
// Public, unauthenticated read-only view of a shared decision.
// Deliberately narrow surface: decision text, context, and the latest
// synthesis verdict only. No persona debate, no bias/Mirror data, no
// editing controls — none of that is meant for a stranger on WhatsApp/
// LinkedIn/Reddit, and none of it is fetched here in the first place.
//
// Looked up by share_token, gated on is_shared = true so an owner who has
// since revoked sharing (DELETE /api/record/[id]/share) can't be reached
// via a previously-sent link.

import { notFound } from 'next/navigation'
import { createServiceClient } from '@/lib/supabase'
import { decrypt } from '@/lib/encryption'
import { formatLongDate } from '@/lib/dates'
import { parseSynthesisHighlights } from '@/lib/synthesis-highlights'
import Link from 'next/link'

interface Props {
  params: Promise<{ token: string }>
}

export default async function SharedRecordPage({ params }: Props) {
  const { token } = await params
  const supabase = createServiceClient()

  const { data: session } = await supabase
    .from('sessions')
    .select('id, decision_text, context_text, created_at, is_shared')
    .eq('share_token', token)
    .eq('is_shared', true)
    .single()

  if (!session) notFound()

  const { data: synthesis } = await supabase
    .from('synthesis_versions')
    .select('verdict_text, verdict_lean')
    .eq('session_id', session.id)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()

  // Conditions/worth-confirming/action-plan aren't persisted in
  // synthesis_versions — same as the share route, pull them from the raw
  // synthesis message. "Latest" for the same reason: a pushback exchange
  // within the session can produce more than one persona='synthesis' row.
  const { data: synthesisMsg } = await supabase
    .from('messages')
    .select('content')
    .eq('session_id', session.id)
    .eq('persona', 'synthesis')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const highlights = synthesisMsg?.content
    ? parseSynthesisHighlights(decrypt(synthesisMsg.content) ?? '')
    : null

  const decisionText = decrypt(session.decision_text) ?? ''
  const contextText  = decrypt(session.context_text) ?? ''
  const verdictText  = synthesis?.verdict_text ? decrypt(synthesis.verdict_text) : null

  const LEAN_LABELS: Record<string, string> = {
    proceed: 'Leaning to proceed',
    wait:    'Leaning to wait',
    mixed:   'Mixed signal',
  }

  return (
    <main style={{ minHeight: '100vh', background: 'var(--bg-void)', padding: '48px 20px 80px' }}>
      <div style={{ maxWidth: 640, margin: '0 auto' }}>

        <p style={{
          fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.14em',
          textTransform: 'uppercase', color: 'var(--gold)', marginBottom: 18,
        }}>
          Quorum · Shared Decision
        </p>

        <div style={{
          background: 'var(--bg-card)', border: '1px solid var(--border-mid)',
          borderRadius: 18, padding: '24px 28px', boxShadow: 'var(--shadow-card)',
        }}>
          <p style={{
            fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.14em',
            textTransform: 'uppercase', color: 'var(--text-4)', marginBottom: 10,
          }}>
            The Decision
          </p>
          <p style={{
            fontFamily: 'var(--font-display)', fontSize: 'clamp(17px, 2.2vw, 22px)',
            fontWeight: 500, lineHeight: 1.45, color: 'var(--text-1)', margin: 0,
          }}>
            {decisionText}
          </p>

          {contextText && (
            <>
              <div className="gold-rule" style={{ margin: '18px 0 14px' }} />
              <p style={{
                fontFamily: 'var(--font-mono)', fontSize: 9.5, letterSpacing: '0.13em',
                textTransform: 'uppercase', color: 'var(--text-4)', marginBottom: 6,
              }}>
                Context
              </p>
              <p style={{ fontSize: 12.5, lineHeight: 1.65, color: 'var(--text-3)', margin: 0 }}>
                {contextText}
              </p>
            </>
          )}

          {verdictText && (
            <>
              <div className="gold-rule" style={{ margin: '18px 0 14px' }} />
              <p style={{
                fontFamily: 'var(--font-mono)', fontSize: 9.5, letterSpacing: '0.13em',
                textTransform: 'uppercase', color: 'var(--gold)', marginBottom: 6,
              }}>
                {synthesis?.verdict_lean && LEAN_LABELS[synthesis.verdict_lean]
                  ? LEAN_LABELS[synthesis.verdict_lean]
                  : "The Council's Verdict"}
              </p>
              <p style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--text-2)', margin: 0 }}>
                {verdictText}
              </p>
            </>
          )}

          {!!highlights?.conditions.length && (
            <>
              <div className="gold-rule" style={{ margin: '18px 0 14px' }} />
              <p style={{
                fontFamily: 'var(--font-mono)', fontSize: 9.5, letterSpacing: '0.13em',
                textTransform: 'uppercase', color: 'var(--text-4)', marginBottom: 8,
              }}>
                Conditional On
              </p>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {highlights.conditions.map((c, i) => (
                  <li key={i} style={{ fontSize: 12.5, lineHeight: 1.6, color: 'var(--text-3)', marginBottom: 4 }}>
                    {c}
                  </li>
                ))}
              </ul>
            </>
          )}

          {highlights?.keyQuestion && (
            <>
              <div className="gold-rule" style={{ margin: '18px 0 14px' }} />
              <p style={{
                fontFamily: 'var(--font-mono)', fontSize: 9.5, letterSpacing: '0.13em',
                textTransform: 'uppercase', color: 'var(--text-4)', marginBottom: 6,
              }}>
                Worth Confirming
              </p>
              <p style={{ fontSize: 12.5, lineHeight: 1.65, color: 'var(--text-3)', margin: 0 }}>
                {highlights.keyQuestion}
              </p>
            </>
          )}

          {!!highlights?.actionPlan.length && (
            <>
              <div className="gold-rule" style={{ margin: '18px 0 14px' }} />
              <p style={{
                fontFamily: 'var(--font-mono)', fontSize: 9.5, letterSpacing: '0.13em',
                textTransform: 'uppercase', color: 'var(--text-4)', marginBottom: 8,
              }}>
                What To Do Next
              </p>
              <ol style={{ margin: 0, paddingLeft: 18 }}>
                {highlights.actionPlan.map((item, i) => (
                  <li key={i} style={{ fontSize: 12.5, lineHeight: 1.6, color: 'var(--text-3)', marginBottom: 6 }}>
                    {item.lead && <span style={{ color: 'var(--text-2)', fontWeight: 600 }}>{item.lead} — </span>}
                    {item.rest}
                  </li>
                ))}
              </ol>
            </>
          )}

          <p style={{ marginTop: 20, fontSize: 11, color: 'var(--text-4)' }}>
            {formatLongDate(session.created_at)}
          </p>
        </div>

        <div style={{ textAlign: 'center', marginTop: 28 }}>
          <Link href="/" style={{
            fontSize: 12, color: 'var(--gold)', textDecoration: 'none',
            fontFamily: 'var(--font-mono)', letterSpacing: '0.05em',
          }}>
            Run your own decision through Quorum →
          </Link>
        </div>

      </div>
    </main>
  )
}

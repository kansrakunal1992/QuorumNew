'use client'

// components/StakeholderOutreach.tsx
// ── "Want to hear from them directly?" (Phase 2/3, v2) ────────────────────────
//
// Surfaces contextually inside DecisionCheckpoint.tsx's examine phase, only
// when the chat actually named a stakeholder (plan section 22: integrations
// appear when they solve a current problem, never as a standing menu).
//
// Two paths converge on the same capture step (plan section 6's "Draft
// outreach... user edits, cancels, regenerates, sends" plus "the stakeholder
// response must become part of the decision engine context"):
//   - Draft + send (Slack/Teams/WhatsApp/copy), then check for or paste a reply.
//   - Skip straight to pasting something they already said elsewhere.
// Both end at POST /api/stakeholder-input/manual — one path that writes
// stakeholder_inputs, not two slightly different ones.

import { useState } from 'react'
import type { CSSProperties } from 'react'
import type { ChatStakeholderMention } from '@/lib/types'
import ConnectorSettings, { type ConnectorProvider } from '@/components/ConnectorSettings'

type Channel = 'slack' | 'teams' | 'whatsapp' | 'manual'

interface SearchMatch {
  targetId:    string   // Slack: channel id. Teams: chat id.
  channelName: string   // Slack: channel/DM name (also used for check-replies). Teams: chat topic.
  label:       string
  snippet:     string
}

interface Props {
  sessionId:     string
  stakeholders:  ChatStakeholderMention[]
  authToken:     string | null
}

const cardStyle: CSSProperties = {
  background: 'var(--bg-card)',
  border: '1px solid var(--border-dim)',
  borderRadius: 18,
  padding: 18,
}

const smallBtn: CSSProperties = {
  padding: '9px 14px', borderRadius: 10, border: '1px solid var(--border-mid)',
  background: 'transparent', color: 'var(--text-2)', fontSize: 13.5, cursor: 'pointer',
}

const smallPrimaryBtn: CSSProperties = {
  ...smallBtn, border: 'none', background: 'var(--gold)', color: 'var(--bg-void)', fontWeight: 600,
}

type Phase = 'prompt' | 'channel' | 'search' | 'draft' | 'sent' | 'paste' | 'saved'

export default function StakeholderOutreach({ sessionId, stakeholders, authToken }: Props) {
  const [phase, setPhase]           = useState<Phase>('prompt')
  const [expanded, setExpanded]     = useState(false)
  const [person, setPerson]         = useState(stakeholders[0] ?? null)
  const [channel, setChannel]       = useState<Channel | null>(null)
  const [connectors, setConnectors] = useState<{ slack: boolean; teams: boolean }>({ slack: false, teams: false })

  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchMatch[] | null>(null)
  const [searching, setSearching]     = useState(false)
  const [target, setTarget]           = useState<SearchMatch | null>(null)

  const [draftText, setDraftText]     = useState('')
  const [drafting, setDrafting]       = useState(false)
  const [whatsappLink, setWhatsappLink] = useState<string | null>(null)
  const [sentMarker, setSentMarker]   = useState<string | null>(null)
  const [sendError, setSendError]     = useState<string | null>(null)

  const [replies, setReplies]         = useState<{ text: string; userName: string | null; timestamp: string }[] | null>(null)
  const [checkingReplies, setCheckingReplies] = useState(false)

  const [pasteText, setPasteText]     = useState('')
  const [saving, setSaving]           = useState(false)

  if (!person) return null

  const authedFetch = (url: string, init: RequestInit = {}) =>
    fetch(url, { ...init, headers: { ...(init.headers ?? {}), ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}) } })

  async function startDraft(ch: Channel) {
    setChannel(ch)
    setDrafting(true)
    setPhase(ch === 'slack' || ch === 'teams' ? 'search' : 'draft')
    if (ch === 'slack' || ch === 'teams') setSearchQuery(person!.name)

    try {
      const res = await authedFetch('/api/stakeholder-outreach/draft', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId, stakeholderName: person!.name, role: person!.role ?? null,
          consultReason: person!.consultReason ?? null, channel: ch === 'manual' ? 'manual' : ch,
        }),
      })
      const data = await res.json()
      setDraftText(data.draftText ?? '')
      setWhatsappLink(data.whatsappLink ?? null)
    } catch (err) {
      console.error('[StakeholderOutreach] draft failed:', err)
    } finally {
      setDrafting(false)
    }
  }

  async function runSearch() {
    if (!channel || (channel !== 'slack' && channel !== 'teams') || !searchQuery.trim()) return
    setSearching(true)
    setSearchResults(null)
    try {
      const res  = await authedFetch(`/api/connectors/${channel}/search`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: searchQuery.trim() }),
      })
      const data = await res.json()
      const matches: SearchMatch[] = (data.matches ?? []).map((m: any) => ({
        targetId:    channel === 'slack' ? m.channelId : m.chatId,
        channelName: channel === 'slack' ? m.channelName : m.chatTopic,
        label:       channel === 'slack' ? `#${m.channelName || 'DM'}` : m.chatTopic,
        snippet:     m.text?.slice(0, 90) ?? '',
      }))
      setSearchResults(matches)
    } catch (err) {
      console.error('[StakeholderOutreach] search failed:', err)
      setSearchResults([])
    } finally {
      setSearching(false)
    }
  }

  function pickTarget(m: SearchMatch) {
    setTarget(m)
    setPhase('draft')
  }

  async function send() {
    if (!channel) return
    setSendError(null)

    if (channel === 'whatsapp') {
      if (whatsappLink) window.open(whatsappLink, '_blank')
      setPhase('sent')
      return
    }
    if (channel === 'manual') {
      // "Copy" path — nothing to send via API; clipboard, then straight to
      // the paste-a-reply step (there's nothing to poll for).
      try { await navigator.clipboard.writeText(draftText) } catch { /* clipboard permission denied — text is still selectable on screen */ }
      setPhase('sent')
      return
    }
    if (!target) return

    try {
      const res = await authedFetch(`/api/connectors/${channel}/send`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetId: target.targetId, text: draftText }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Send failed')
      setSentMarker(data.sentMarker)
      setPhase('sent')
    } catch (err) {
      console.error('[StakeholderOutreach] send failed:', err)
      setSendError('Couldn\u2019t send that — want to try again, or copy it instead?')
    }
  }

  async function checkForReplies() {
    if (!channel || (channel !== 'slack' && channel !== 'teams') || !sentMarker || !target) return
    setCheckingReplies(true)
    try {
      const res = await authedFetch(`/api/connectors/${channel}/check-replies`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetId: target.targetId, channelName: target.channelName, sentAfter: sentMarker }),
      })
      const data = await res.json()
      setReplies((data.matches ?? []).map((m: any) => ({ text: m.text, userName: m.userName, timestamp: m.timestamp })))
    } catch (err) {
      console.error('[StakeholderOutreach] check-replies failed:', err)
      setReplies([])
    } finally {
      setCheckingReplies(false)
    }
  }

  async function saveReply(text: string, timestamp?: string) {
    setSaving(true)
    try {
      await authedFetch('/api/stakeholder-input/manual', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId, stakeholderName: person!.name,
          channel: channel === 'manual' ? 'manual' : channel,
          provenance: channel === 'manual' || !channel ? 'user_pasted' : 'sent_via_quorum',
          sourceText: text,
          sourceTimestamp: timestamp ? new Date(Number(timestamp) * 1000 || timestamp).toISOString() : undefined,
        }),
      })
      setPhase('saved')
    } catch (err) {
      console.error('[StakeholderOutreach] save failed:', err)
    } finally {
      setSaving(false)
    }
  }

  if (!expanded) {
    return (
      <div style={cardStyle}>
        <div style={{ fontSize: 15, color: 'var(--text-1)', marginBottom: 10 }}>
          Want to hear from {person.name} directly?
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={smallPrimaryBtn} onClick={() => setExpanded(true)}>Ask {person.name.split(' ')[0]}</button>
          {stakeholders.length > 1 && (
            <select
              value={person.name}
              onChange={e => setPerson(stakeholders.find(s => s.name === e.target.value) ?? person)}
              style={{ background: 'var(--bg-inset)', color: 'var(--text-2)', border: '1px solid var(--border-mid)', borderRadius: 10, fontSize: 13.5 }}
            >
              {stakeholders.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
            </select>
          )}
        </div>
      </div>
    )
  }

  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div style={{ fontSize: 15, color: 'var(--text-1)' }}>Asking {person.name}</div>
        <button style={{ background: 'none', border: 'none', color: 'var(--text-4)', fontSize: 13, cursor: 'pointer' }} onClick={() => setExpanded(false)}>Close</button>
      </div>

      {phase === 'prompt' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <ConnectorSettings authToken={authToken} onStatus={s => setConnectors({ slack: s.slack.connected, teams: s.teams.connected })} />
          <div style={{ fontSize: 13, color: 'var(--text-4)', marginTop: 4 }}>How do you want to reach them?</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {connectors.slack && <button style={smallBtn} onClick={() => startDraft('slack')}>Slack</button>}
            {connectors.teams && <button style={smallBtn} onClick={() => startDraft('teams')}>Teams</button>}
            <button style={smallBtn} onClick={() => startDraft('whatsapp')}>WhatsApp</button>
            <button style={smallBtn} onClick={() => startDraft('manual')}>Copy a message</button>
          </div>
          <button style={{ ...smallBtn, border: 'none', textDecoration: 'underline', width: 'fit-content' }} onClick={() => setPhase('paste')}>
            Already have something {person.name.split(' ')[0]} said? Paste it in
          </button>
        </div>
      )}

      {phase === 'search' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder={`Search ${channel === 'slack' ? 'Slack' : 'Teams'} for ${person.name}`}
              style={{ flex: 1, padding: 10, borderRadius: 10, border: '1px solid var(--border-mid)', background: 'var(--bg-inset)', color: 'var(--text-1)', fontSize: 14 }}
            />
            <button style={smallPrimaryBtn} onClick={runSearch} disabled={searching}>{searching ? '…' : 'Search'}</button>
          </div>
          {searchResults && (
            searchResults.length ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {searchResults.map((m, i) => (
                  <button key={i} onClick={() => pickTarget(m)} style={{ ...smallBtn, textAlign: 'left', width: '100%' }}>
                    <div style={{ fontWeight: 600, fontSize: 13.5 }}>{m.label}</div>
                    <div style={{ color: 'var(--text-4)', fontSize: 12.5 }}>{m.snippet}</div>
                  </button>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: 13.5, color: 'var(--text-4)' }}>Nothing found — try a different search, or go back and pick a different way to reach them.</div>
            )
          )}
        </div>
      )}

      {phase === 'draft' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {drafting ? (
            <div style={{ fontSize: 13.5, color: 'var(--text-4)', fontStyle: 'italic' }}>Drafting…</div>
          ) : (
            <>
              <textarea
                value={draftText}
                onChange={e => setDraftText(e.target.value)}
                rows={4}
                style={{ padding: 12, borderRadius: 12, border: '1px solid var(--border-mid)', background: 'var(--bg-inset)', color: 'var(--text-1)', fontSize: 14.5, resize: 'vertical' }}
              />
              {sendError && <div style={{ fontSize: 13, color: 'var(--text-3)' }}>{sendError}</div>}
              <div style={{ display: 'flex', gap: 8 }}>
                <button style={smallPrimaryBtn} onClick={send}>
                  {channel === 'whatsapp' ? 'Open in WhatsApp' : channel === 'manual' ? 'Copy' : `Send${target ? ` to ${target.label}` : ''}`}
                </button>
                <button style={smallBtn} onClick={() => startDraft(channel!)}>Regenerate</button>
              </div>
            </>
          )}
        </div>
      )}

      {phase === 'sent' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 14, color: 'var(--gold-bright)' }}>
            {channel === 'manual' ? 'Copied.' : channel === 'whatsapp' ? 'Opened in WhatsApp.' : 'Sent.'}
          </div>
          {(channel === 'slack' || channel === 'teams') ? (
            <>
              <button style={smallBtn} onClick={checkForReplies} disabled={checkingReplies}>
                {checkingReplies ? 'Checking…' : 'Check for a reply'}
              </button>
              {replies && (
                replies.length ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {replies.map((r, i) => (
                      <div key={i} style={{ padding: 10, borderRadius: 10, background: 'var(--bg-inset)' }}>
                        <div style={{ fontSize: 13.5, color: 'var(--text-1)', marginBottom: 6 }}>{r.text}</div>
                        <button style={{ ...smallBtn, padding: '6px 10px', fontSize: 12.5 }} onClick={() => saveReply(r.text, r.timestamp)} disabled={saving}>
                          Use this as their answer
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ fontSize: 13, color: 'var(--text-4)' }}>Nothing yet — check again in a bit, or paste their reply once they answer.</div>
                )
              )}
            </>
          ) : (
            <div style={{ fontSize: 13, color: 'var(--text-4)' }}>Once they reply, come back and paste it in.</div>
          )}
          <button style={{ ...smallBtn, border: 'none', textDecoration: 'underline', width: 'fit-content' }} onClick={() => setPhase('paste')}>
            Paste their reply myself
          </button>
        </div>
      )}

      {phase === 'paste' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <textarea
            value={pasteText}
            onChange={e => setPasteText(e.target.value)}
            rows={4}
            placeholder={`What did ${person.name} say?`}
            style={{ padding: 12, borderRadius: 12, border: '1px solid var(--border-mid)', background: 'var(--bg-inset)', color: 'var(--text-1)', fontSize: 14.5, resize: 'vertical' }}
          />
          <button style={smallPrimaryBtn} onClick={() => saveReply(pasteText)} disabled={!pasteText.trim() || saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      )}

      {phase === 'saved' && (
        <div style={{ fontSize: 14, color: 'var(--gold-bright)' }}>
          Got it — {person.name}'s view is part of this decision now.
        </div>
      )}
    </div>
  )
}

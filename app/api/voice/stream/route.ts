// app/api/voice/stream/route.ts
// Sprint 22a — SSE endpoint that bridges browser ↔ Soniox WebSocket
// ─────────────────────────────────────────────────────────────────────────────
// Flow:
//   1. Browser GETs /api/voice/stream?sessionId=xxx
//   2. This route opens a Soniox WS and stores it in voiceSessions
//   3. Token batches are forwarded to the browser via SSE
//   4. On SSE cancel (browser disconnects), Soniox WS is closed
//
// SSE event shapes sent to client:
//   { type: 'ready' }
//   { type: 'batch', finalText: string, partialText: string, hasEndpoint: bool }
//   { type: 'finished' }
//   { type: 'error', errorType: string, msg: string }
//
// Fixes applied vs earlier draft:
//   • Correct WS URL: wss://stt-rt.soniox.com/transcribe-websocket
//   • Batch events (not per-token) so client can reset partialText correctly
//   • <end> and <fin> special tokens filtered from display text
//   • error_type used (stable) rather than numeric error_code
// ─────────────────────────────────────────────────────────────────────────────

export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import WebSocket from 'ws'
import {
  voiceSessions,
  sweepStaleSessions,
  sendSSE,
  type VoiceSession,
} from '@/lib/voice-sessions'

const SONIOX_WS_URL = 'wss://stt-rt.soniox.com/transcribe-websocket'

// Tokens Soniox uses internally — never shown to the user
const SPECIAL_TOKENS = new Set(['<end>', '<fin>'])

export async function GET(req: NextRequest) {
  const apiKey = process.env.SONIOX_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'STT_NOT_CONFIGURED' }, { status: 503 })
  }

  const sessionId = req.nextUrl.searchParams.get('sessionId')
  if (!sessionId || sessionId.length < 8) {
    return NextResponse.json({ error: 'INVALID_SESSION_ID' }, { status: 400 })
  }

  sweepStaleSessions()

  const encoder = new TextEncoder()
  let session: VoiceSession | null = null

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // ── Open Soniox WebSocket ─────────────────────────────────────────────
      const ws = new WebSocket(SONIOX_WS_URL)

      session = {
        ws,
        controller,
        encoder,
        sessionId,
        createdAt: Date.now(),
      }
      voiceSessions.set(sessionId, session)

      // ── Send config on open ───────────────────────────────────────────────
      ws.on('open', () => {
        ws.send(JSON.stringify({
          api_key:                   apiKey,
          model:                     'stt-rt-v4',
          audio_format:              'auto',
          enable_endpoint_detection: true,
          max_endpoint_delay_ms: 3000,
          language_hints:            ['en'],
        }))
        sendSSE(session!, { type: 'ready' })
      })

      // ── Token events from Soniox ──────────────────────────────────────────
      ws.on('message', (raw: Buffer) => {
        let event: {
          tokens?:       { text: string; is_final: boolean }[]
          finished?:     boolean
          error_code?:   number | null
          error_type?:   string | null
          error_message?: string | null
        }

        try {
          event = JSON.parse(raw.toString())
        } catch {
          return
        }

        // ── Soniox error ────────────────────────────────────────────────────
        if (event.error_code != null) {
          sendSSE(session!, {
            type:      'error',
            errorType: event.error_type ?? String(event.error_code),
            msg:       event.error_message ?? 'Transcription error',
          })
          cleanup(sessionId, ws, controller)
          return
        }

        // ── Token batch — send as one event so client can reset partialText ─
        // Per Soniox docs: non-final tokens reset on EVERY response.
        // We batch the whole message so the client replaces (not appends) partial.
        if (event.tokens?.length) {
          const finalTokens   = event.tokens.filter(t =>  t.is_final && !SPECIAL_TOKENS.has(t.text))
          const partialTokens = event.tokens.filter(t => !t.is_final)
          const hasEndpoint   = event.tokens.some(t => t.is_final && t.text === '<end>')

          if (finalTokens.length || partialTokens.length) {
            sendSSE(session!, {
              type:        'batch',
              finalText:   finalTokens.map(t => t.text).join(''),
              partialText: partialTokens.map(t => t.text).join(''),
              hasEndpoint,
            })
          }
          // All tokens are already final when endpoint is detected —
          // close proactively instead of waiting for Soniox to time out
          if (hasEndpoint) {
            sendSSE(session!, { type: 'finished' })
            cleanup(sessionId, ws, controller)
            return
          }
        }

        // ── Session finished ────────────────────────────────────────────────
        if (event.finished) {
          sendSSE(session!, { type: 'finished' })
          cleanup(sessionId, ws, controller)
        }
      })

      // ── WS-level errors ───────────────────────────────────────────────────
      ws.on('error', (err: Error) => {
        console.error(`[voice/stream] Soniox WS error (${sessionId}):`, err.message)
        sendSSE(session!, {
          type:      'error',
          errorType: 'ws_error',
          msg:       'Connection to speech service failed',
        })
        cleanup(sessionId, ws, controller)
      })

      ws.on('close', () => {
        voiceSessions.delete(sessionId)
      })
    },

    // ── Browser disconnected / navigated away ─────────────────────────────
    cancel() {
      if (session) {
        try { session.ws.close() } catch { /* ignore */ }
        voiceSessions.delete(sessionId)
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type':      'text/event-stream',
      'Cache-Control':     'no-cache, no-transform',
      'Connection':        'keep-alive',
      'X-Accel-Buffering': 'no', // Prevent Railway/nginx buffering SSE
    },
  })
}

function cleanup(
  sessionId: string,
  ws: WebSocket,
  controller: ReadableStreamDefaultController<Uint8Array>,
) {
  try { ws.close() }          catch { /* ignore */ }
  try { controller.close() }  catch { /* ignore */ }
  voiceSessions.delete(sessionId)
}

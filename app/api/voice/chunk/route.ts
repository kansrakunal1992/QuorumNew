// app/api/voice/chunk/route.ts
// Sprint 22a — receives 250ms binary audio chunks, forwards to Soniox WS
// ─────────────────────────────────────────────────────────────────────────────
// Client POSTs audio/octet-stream every 250ms while recording.
// ?finalize=true on the last POST triggers Soniox manual finalization,
// which flushes all remaining non-final tokens.
// ─────────────────────────────────────────────────────────────────────────────

export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { voiceSessions } from '@/lib/voice-sessions'

const MAX_CHUNK_BYTES = 64 * 1024  // 64 KB — well above a 250ms webm chunk
const SESSION_WAIT_MS = 2000       // max wait for session to appear in Map
const SESSION_POLL_MS = 50

export async function POST(req: NextRequest) {
  const sessionId  = req.nextUrl.searchParams.get('sessionId')
  const doFinalize = req.nextUrl.searchParams.get('finalize') === 'true'

  if (!sessionId) {
    return NextResponse.json({ error: 'MISSING_SESSION_ID' }, { status: 400 })
  }

  // Wait for session — handles first chunk arriving before SSE route stores WS
  const session = await waitForSession(sessionId)
  if (!session) {
    return NextResponse.json({ error: 'SESSION_NOT_FOUND' }, { status: 404 })
  }

  if (session.ws.readyState !== 1 /* WebSocket.OPEN */) {
    return NextResponse.json({ error: 'WS_NOT_OPEN' }, { status: 409 })
  }

  // ── Forward binary audio to Soniox ───────────────────────────────────────
  try {
    const buf = await req.arrayBuffer()
    if (buf.byteLength > MAX_CHUNK_BYTES) {
      return NextResponse.json({ error: 'CHUNK_TOO_LARGE' }, { status: 413 })
    }
    if (buf.byteLength > 0) {
      session.ws.send(Buffer.from(buf))
    }
  } catch (err) {
    console.error(`[voice/chunk] Forward failed (${sessionId}):`, err)
    return NextResponse.json({ error: 'FORWARD_FAILED' }, { status: 502 })
  }

  // ── Finalize: flush remaining non-final tokens ────────────────────────────
  // Per docs: send after ~200ms of silence following end of speech.
  // We call this once when MediaRecorder.stop() fires client-side.
  if (doFinalize) {
    try {
      session.ws.send(JSON.stringify({ type: 'finalize' }))
    } catch (err) {
      console.error(`[voice/chunk] Finalize send failed (${sessionId}):`, err)
      // Non-fatal — SSE error handler will surface this if WS is broken
    }
  }

  return NextResponse.json({ ok: true })
}

async function waitForSession(sessionId: string) {
  const deadline = Date.now() + SESSION_WAIT_MS
  while (Date.now() < deadline) {
    const s = voiceSessions.get(sessionId)
    if (s) return s
    await sleep(SESSION_POLL_MS)
  }
  return null
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

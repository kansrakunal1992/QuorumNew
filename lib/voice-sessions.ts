// lib/voice-sessions.ts
// Sprint 22a — shared in-memory session store for voice streaming
// ─────────────────────────────────────────────────────────────────────────────
// Holds active Soniox WebSocket connections keyed by sessionId.
// Both /api/voice/stream (SSE) and /api/voice/chunk share this Map because
// Railway runs Next.js as a persistent Node.js process — not serverless.
//
// Sessions are cleaned up:
// • On Soniox 'finished' event
// • On SSE ReadableStream cancel (client disconnects / navigates away)
// • By TTL sweep (10 min guard against leaked sessions)
// ─────────────────────────────────────────────────────────────────────────────

import type WebSocket from 'ws'

export interface VoiceSession {
  ws:         WebSocket
  controller: ReadableStreamDefaultController<Uint8Array> | null
  encoder:    TextEncoder
  sessionId:  string
  createdAt:  number
}

export const voiceSessions = new Map<string, VoiceSession>()

const TTL_MS = 10 * 60 * 1000

export function sweepStaleSessions() {
  const now = Date.now()
  for (const [id, session] of voiceSessions.entries()) {
    if (now - session.createdAt > TTL_MS) {
      try { session.ws.close() } catch { /* ignore */ }
      voiceSessions.delete(id)
    }
  }
}

export function sendSSE(session: VoiceSession, payload: object) {
  if (!session.controller) return
  try {
    const line = `data: ${JSON.stringify(payload)}\n\n`
    session.controller.enqueue(session.encoder.encode(line))
  } catch {
    // Controller may already be closed
  }
}

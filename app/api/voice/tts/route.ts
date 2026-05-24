export const runtime = 'nodejs'

const SONIOX_TTS_URL = 'https://tts-rt.soniox.com/tts'

function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/^#+\s*/gm, '')
    .replace(/^[-•]\s*/gm, '')
}

export async function POST(req: Request) {
  const apiKey = process.env.SONIOX_API_KEY
  if (!apiKey) {
    return Response.json({ error: 'TTS_NOT_CONFIGURED' }, { status: 503 })
  }

  let text: string
  try {
    const body = await req.json()
    text = body.text
  } catch {
    return Response.json({ error: 'INVALID_BODY' }, { status: 400 })
  }

  if (!text || typeof text !== 'string' || !text.trim()) {
    return Response.json({ error: 'INPUT_EMPTY' }, { status: 400 })
  }
  if (text.length > 8000) {
    return Response.json({ error: 'INPUT_TOO_LONG' }, { status: 400 })
  }

  const clean = stripMarkdown(text)

  let sonioxRes: Response
  try {
    sonioxRes = await fetch(SONIOX_TTS_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model:        'tts-rt-v1',
        language:     'en',
        voice:        'Adrian',
        audio_format: 'mp3',
        text:         clean,
      }),
    })
  } catch (err) {
    console.error('[TTS] Network error reaching Soniox:', err)
    return Response.json({ error: 'TTS_PROVIDER_DOWN' }, { status: 502 })
  }

  if (!sonioxRes.ok) {
    if (sonioxRes.status === 429) {
      return Response.json({ error: 'TTS_QUOTA_EXCEEDED' }, { status: 429 })
    }
    if (sonioxRes.status >= 500) {
      return Response.json({ error: 'TTS_PROVIDER_DOWN' }, { status: 502 })
    }
    let errBody: { error_type?: string; error_message?: string } = {}
    try { errBody = await sonioxRes.json() } catch { /* ignore */ }
    console.error('[TTS] Soniox error:', errBody.error_type, errBody.error_message)
    return Response.json({ error: 'TTS_FAILED' }, { status: 502 })
  }

  const contentType = sonioxRes.headers.get('Content-Type') ?? 'audio/mpeg'

  return new Response(sonioxRes.body, {
    headers: {
      'Content-Type':  contentType,
      'Cache-Control': 'no-store',
    },
  })
}

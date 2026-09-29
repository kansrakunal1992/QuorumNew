/**
 * QUORUM — Share Target Route (Phase 4, v3)
 *
 * The Web Share Target API delivers a plain browser form POST here — no
 * Authorization header, same constraint as the OAuth callbacks (see
 * lib/connectors/state.ts's file header). Rather than try to identify and
 * save on the user's behalf from an unauthenticated POST, this route just
 * carries the shared text into the app itself: redirect to
 * /share-received?text=..., a normal page in the PWA where the person is
 * already signed in client-side, and pick the decision + stakeholder from
 * there through the same authenticated POST /api/stakeholder-input/manual
 * everything else already uses.
 *
 * Requires an addition to the PWA manifest (public/manifest.json) — see
 * docs/CHANGELOG_v3.md for the exact snippet; that file wasn't available in
 * this drop's source to edit directly (see the changelog for why).
 */

import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

  let text = ''
  try {
    const formData = await req.formData()
    // WhatsApp's share sheet puts the forwarded message in `text` for plain
    // messages, or sometimes `url` if the shared item is link-shaped —
    // checked in that order.
    text = (formData.get('text') ?? formData.get('title') ?? formData.get('url') ?? '').toString()
  } catch (err) {
    console.error('[ShareTarget] failed to parse form data:', err)
  }

  return NextResponse.redirect(`${baseUrl}/share-received?text=${encodeURIComponent(text)}`, 303)
}

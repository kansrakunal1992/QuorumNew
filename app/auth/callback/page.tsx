'use client'
// app/auth/callback/page.tsx
// ── Sprint 6 + 6b: Magic Link Callback ───────────────────────────────────────
//
// Supabase redirects here after the user clicks the magic link.
//
// Sprint 6b: Cross-browser session recovery.
// The magic link URL now carries ?xd=<deviceId>&xs=<sessionIds> params embedded
// by /api/auth at send time. When the link is clicked in a different browser
// (email client, mobile WebView, etc.), localStorage is empty — but these URL
// params carry the originating browser's identity. The callback merges both
// sources and passes the combined payload to link-sessions so ALL prior anonymous
// sessions are linked regardless of which browser the link is opened in.
//
// Identity merge (see lib/auth-intent.ts — mergeIdentity — for the exact rules):
//   session ids / device ids  = de-duplicated UNION of: URL params, the server-side pending intent, localStorage
//   return path               = PRIORITY: URL ?rt=  →  pending intent  →  localStorage
//
// Nov 2026 — cross-browser hardening. The URL params alone were not reliable: when Supabase does not honour the
// link's emailRedirectTo (Redirect URL allow-list mismatch) it redirects to the Site URL and every param is lost, so
// the person landed on Home and lost their place in the Convene gate. POST /api/auth now also records a short-lived
// "pending intent" keyed by email, and this page fetches it (POST /api/auth/resume) once Supabase has verified the
// link. Link failures (#error_code=otp_expired in the URL HASH, which this page never read before) are now handled
// explicitly and send the person back to where they were instead of Home.
// ─────────────────────────────────────────────────────────────────────────────

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { getStoredSessionIds, storeUserEmail, getStoredDeviceId } from '@/lib/storage'
import { sanitizeReturnTo, readReturnTo, clearReturnTo } from '@/lib/return-to'   // Phase 0: return to where they were
import { mergeIdentity, parseAuthHash, readInitialAuthHash, cleanSessionIds, withQueryFlag } from '@/lib/auth-intent'   // cross-browser hardening
import type { AuthIntent } from '@/lib/auth-intent'
import { readPendingParks, setPendingParks } from '@/lib/pending-park'             // Phase 1: file parked items after sign-in
import { readHabitPrefs } from '@/lib/habit-prefs'                                 // Phase 2: file the D2 cue + cadence after sign-in
import { track } from '@/lib/track'                                                 // Phase 0: first-party events
import { trackMetaEvent } from '@/lib/meta-pixel'

// ── Inner component — reads URL params (requires Suspense parent) ─────────────
function CallbackHandler() {
  const router       = useRouter()
  const searchParams = useSearchParams()
  const [status, setStatus] = useState<'processing' | 'linking' | 'done' | 'error'>('processing')

  useEffect(() => {
    const run = async () => {
      try {
        const supabase = createClient()

        // ── Step 1: Exchange PKCE code for a session ──────────────────────────
        const code  = searchParams.get('code')
        // Supabase's implicit flow reports a failed link in the URL HASH (#error=access_denied&error_code=otp_expired),
        // PKCE-style flows in the query string. Read both — this used to check only the query string, so an expired or
        // already-used link fell through to a vague "no session" failure and a bounce to Home.
        const hashInfo = parseAuthHash(readInitialAuthHash())
        const error = searchParams.get('error') ?? hashInfo.error

        // Where to send someone whose link failed: the page they asked for it from (carried in ?rt= or saved locally),
        // so they land back on the sign-in step with a clear message rather than on Home with their place lost.
        const bounceHome = (reason: 'link_expired' | 'link_failed') => {
          const back = sanitizeReturnTo(searchParams.get('rt')) ?? readReturnTo()
          try { sessionStorage.removeItem('quorum_brief_email_pending') } catch {}
          setStatus('error')
          setTimeout(() => router.replace(back ? withQueryFlag(back, 'auth_error', reason) : '/'), 2500)
        }

        if (error) {
          console.error('[AuthCallback] URL error:', error, searchParams.get('error_description') ?? hashInfo.description)
          bounceHome(hashInfo.kind === 'expired' ? 'link_expired' : 'link_failed')
          return
        }

        if (code) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)
          if (exchangeError) {
            console.error('[AuthCallback] Code exchange failed:', exchangeError)
            bounceHome('link_failed')
            return
          }
        }

        // ── Step 2: Read the now-valid session ────────────────────────────────
        const { data: { session }, error: sessionError } = await supabase.auth.getSession()
        if (sessionError || !session?.user) {
          console.error('[AuthCallback] No session after exchange:', sessionError)
          bounceHome('link_failed')
          return
        }

        const user = session.user
        setStatus('linking')

        // Persist email for bias library pre-auth context
        storeUserEmail(user.email ?? '')

        // ── Step 3: Build merged identity payload ─────────────────────────────
        // Three carriers, because any one of them can be missing:
        //   A. localStorage        — only populated when the link opens in the SAME browser that requested it
        //   B. the link's URL params (?xd ?xs ?rt) — lost if Supabase falls back to the Site URL
        //   C. the server-side pending intent, keyed by this verified email — survives both of the above
        let intent: AuthIntent | null = null
        try {
          const r = await fetch('/api/auth/resume', {
            method:  'POST',
            headers: { Authorization: `Bearer ${session.access_token}` },
          })
          if (r.ok) intent = ((await r.json()) as { intent?: AuthIntent | null }).intent ?? null
        } catch { /* non-fatal: URL params + localStorage still apply */ }

        const localSessionIds = getStoredSessionIds()
        const localDeviceId   = getStoredDeviceId()
        const urlDeviceId     = searchParams.get('xd') ?? null
        const urlSessionIds   = cleanSessionIds(searchParams.get('xs') ?? '')

        const identity = mergeIdentity({
          local:  { sessionIds: localSessionIds, deviceId: localDeviceId, returnTo: readReturnTo() },
          url:    {
            sessionIds: urlSessionIds, deviceId: urlDeviceId, returnTo: searchParams.get('rt'),
            utmSource:   searchParams.get('us') ?? null,
            utmCampaign: searchParams.get('uc') ?? null,
            utmContent:  searchParams.get('ct') ?? null,
          },
          intent,
        })
        const allSessionIds = identity.sessionIds
        const deviceIds     = identity.deviceIds

        console.log(`[AuthCallback] Linking: ${allSessionIds.length} sessions, deviceIds=[${deviceIds.join(',')}]`)
        console.log(`[AuthCallback]   local: ${localSessionIds.length} sessions · url: ${urlSessionIds.length} · intent: ${intent?.sessionIds.length ?? 'none'} · returnTo=${identity.returnTo ?? 'home'}`)

        // ← NEW: GTM attribution — read back the us/uc/ct params /api/auth
        // embedded in the magic link (see that route for the write side).
        const urlUtmSource   = identity.utm.source     // URL param, else the pending intent (see mergeIdentity)
        const urlUtmCampaign = identity.utm.campaign
        const urlUtmContent  = identity.utm.content

        // Sprint 12: which method this session actually authenticated with.
        // Supabase sets app_metadata.provider to 'email' for magic link /
        // OTP, and 'google' for Google OAuth — read from the session itself
        // rather than trusting anything the client claimed beforehand.
        const authMethod: 'magic_link' | 'google' =
          user.app_metadata?.provider === 'google' ? 'google' : 'magic_link'

        // ── Meta Pixel: CompleteRegistration (free-tier acquisition funnel) ───
        // This app is passwordless (magic link + Google OAuth) — Supabase
        // auto-creates the auth.users row on a person's very first successful
        // sign-in, for EITHER provider. There's no separate "account created"
        // step to hook into, so the reliable signal is comparing the user's
        // created_at to last_sign_in_at: on a brand-new account both are
        // stamped by the same auth event (milliseconds apart). On any later
        // login, last_sign_in_at moves forward while created_at stays fixed.
        // Same auth.users columns for both providers, so this covers magic
        // link and Google identically without touching link-sessions or the
        // DB schema.
        const createdAtMs  = user.created_at ? new Date(user.created_at).getTime() : null
        const lastSignInMs = user.last_sign_in_at ? new Date(user.last_sign_in_at).getTime() : null
        const isNewRegistration =
          createdAtMs !== null &&
          lastSignInMs !== null &&
          Math.abs(lastSignInMs - createdAtMs) < 60_000 // same auth event, not a later login

        if (isNewRegistration) {
          // Session-scoped dedupe (NOT localStorage/permanent) — survives this
          // tab's re-renders/route changes/effect re-fires, but never blocks a
          // genuinely new registration in a future tab or after this tab closes.
          const dedupeKey = `quorum_meta_cr_${user.id}`
          const alreadyFired = (() => {
            try { return sessionStorage.getItem(dedupeKey) === '1' } catch { return false }
          })()
          if (!alreadyFired) {
            try { sessionStorage.setItem(dedupeKey, '1') } catch {}
            trackMetaEvent('CompleteRegistration', {
              content_name: 'Quorum Free Tier',
              status: 'completed',
            })
            console.log(`[AuthCallback] Meta Pixel: CompleteRegistration fired (${authMethod})`)
          }

          // ← NEW: GTM attribution — only ever recorded on true first
          // registration (this same isNewRegistration gate), never
          // overwritten by a later login. Fire-and-forget, same pattern as
          // link-sessions below — a failure here shouldn't block sign-in.
          if (urlUtmSource || urlUtmCampaign || urlUtmContent) {
            fetch('/api/auth/link-utm', {
              method:  'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                userId:      user.id,
                utmSource:   urlUtmSource,
                utmCampaign: urlUtmCampaign,
                utmContent:  urlUtmContent,
              }),
            }).catch(() => { /* non-fatal — see /api/auth/link-utm */ })
          }
        }

        // ── Step 4: Link all recovered sessions to the authenticated user ─────
        // Response intentionally not inspected: link-sessions has no
        // provider-mismatch / duplicate-account error path to react to.
        // Supabase Auth's own identity linking already merges a magic-link
        // login and a Google login for the same email into one auth user
        // (confirmed against this project's config, 2026-08) — `user.id`
        // above is already that single canonical id, so there's no
        // "wrong account" case for this step to detect. See the matching
        // note in app/api/auth/link-sessions/route.ts.
        // Identity comes from the Bearer token: the route no longer trusts a userId in the body (see that file).
        const linkRes = await fetch('/api/auth/link-sessions', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({
            sessionIds: allSessionIds,   // explicit IDs to link via RPC
            deviceIds,                   // device IDs for DB-level session lookup
            authMethod,
          }),
        }).catch(() => null)
        if (!linkRes?.ok) console.warn('[AuthCallback] link-sessions did not succeed:', linkRes?.status)

        // ── Phase 1: file anything parked while anonymous ─────────────────────
        // "Park it for later" needs an account; the text waited in
        // localStorage (lib/pending-park.ts). Failures stay queued for next time.
        try {
          const pending = readPendingParks()
          if (pending.length) {
            const failed: string[] = []
            for (const text of pending) {
              try {
                const r = await fetch('/api/watchlist', {
                  method:  'POST',
                  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
                  body:    JSON.stringify({ text }),
                })
                if (!r.ok && r.status !== 404) failed.push(text)   // 404 = Watchlist flag off: drop, do not retry forever
              } catch { failed.push(text) }
            }
            setPendingParks(failed)
          }
        } catch { /* non-fatal */ }

        // ── Phase 2: file the cue + cadence chosen while anonymous ───────────
        // The local copy is kept on purpose -- it is also what stops the D2
        // card from asking again on this device.
        try {
          const hp = readHabitPrefs()
          if (hp && (hp.cue || hp.cadence)) {
            await fetch('/api/preferences/habit', {
              method:  'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
              body:    JSON.stringify({ cue: hp.cue, cadence: hp.cadence }),
            })
          }
        } catch { /* non-fatal; HabitSetupCard retries nothing, but the choice stays local */ }

        track('auth_completed', { provider: authMethod, new_registration: isNewRegistration })

        setStatus('done')

        // ── Phase 0: send people back where they signed in from ───────────────
        // ?rt= (magic link, survives a different browser) wins over the
        // localStorage value (Google OAuth / same-browser). Both are validated
        // same-origin paths. Home stays the default.
        // Priority (lib/auth-intent.ts mergeIdentity): the link's ?rt=, then the server-side pending intent, then this
        // browser's saved value. Already validated same-origin paths.
        const returnTo = identity.returnTo
        clearReturnTo()
        try { sessionStorage.removeItem('quorum_brief_email_pending') } catch {}   // the link was used: stop showing "Check your inbox"
        if (returnTo) {
          router.replace(`${returnTo}${returnTo.includes('?') ? '&' : '?'}linked=1`)
          return
        }
        // Encode email into the redirect URL so any browser (Chrome main, Custom Tab,
        // Safari, etc.) can pick up the identity — localStorage is isolated per browser
        // context on mobile, so we cannot rely on storeUserEmail reaching the right one.
        const homeUrl = user.email
          ? `/?linked=1&em=${encodeURIComponent(user.email)}`
          : '/?linked=1'
        router.replace(homeUrl)

      } catch (err) {
        console.error('[AuthCallback] Error:', err)
        setStatus('error')
        setTimeout(() => router.replace('/'), 3000)
      }
    }

    run()
  }, [router, searchParams])

  return (
    <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-void)', padding: 20 }}>
      <div style={{ textAlign: 'center', maxWidth: 360 }}>
        <div style={{ fontSize: 28, marginBottom: 16 }}>
          {status === 'error' ? '✕' : '⟳'}
        </div>
        <p style={{ fontSize: 14, color: 'var(--text-2)', marginBottom: 8 }}>
          {status === 'processing' && 'Verifying your link…'}
          {status === 'linking'    && 'Linking your sessions…'}
          {status === 'done'       && 'Authenticated. Redirecting…'}
          {status === 'error'      && 'Something went wrong. Redirecting to home…'}
        </p>
        {status !== 'error' && (
          <p style={{ fontSize: 11, color: 'var(--text-4)' }}>
            Your decision history is being connected across devices.
          </p>
        )}
      </div>
    </main>
  )
}

// ── Loading shell shown while CallbackHandler hydrates ───────────────────────
function CallbackLoading() {
  return (
    <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-void)', padding: 20 }}>
      <div style={{ textAlign: 'center', maxWidth: 360 }}>
        <div style={{ fontSize: 28, marginBottom: 16 }}>⟳</div>
        <p style={{ fontSize: 14, color: 'var(--text-2)', marginBottom: 8 }}>
          Verifying your link…
        </p>
      </div>
    </main>
  )
}

// ── Default export — wraps in Suspense (required by Next.js 15) ───────────────
export default function AuthCallbackPage() {
  return (
    <Suspense fallback={<CallbackLoading />}>
      <CallbackHandler />
    </Suspense>
  )
}

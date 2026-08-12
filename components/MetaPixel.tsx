'use client'
// components/MetaPixel.tsx
// ── Meta Pixel base loader — FREE-TIER acquisition funnel ────────────────────
//
// Renders the standard Meta Pixel bootstrap (fbq init + first PageView) and
// tracks PageView again on every subsequent client-side route change — the
// App Router doesn't do a native page load on navigation, so fbq's own
// automatic PageView only ever fires once without this.
//
// Renders nothing at all when NEXT_PUBLIC_META_PIXEL_ID is unset, so local
// dev / previews without the env var behave exactly as before this change.
//
// CompleteRegistration and ViewContent are NOT fired here — see
// app/auth/callback/page.tsx and components/AuthPanel.tsx respectively.
// This component only ever fires PageView.
// ─────────────────────────────────────────────────────────────────────────────

import { Suspense, useEffect, useRef } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import Script from 'next/script'
import { META_PIXEL_ID, isMetaPixelConfigured, trackMetaEvent } from '@/lib/meta-pixel'

// Separate inner component: useSearchParams() requires a Suspense boundary
// in the App Router, so we isolate it from the script-injection logic above.
function PixelRouteChangeTracker() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const hasMounted = useRef(false)

  useEffect(() => {
    // Skip the very first run — the inline base script below already fires
    // the initial PageView itself. This effect exists only to catch
    // *subsequent* client-side navigations, which fbq cannot see on its own.
    if (!hasMounted.current) {
      hasMounted.current = true
      return
    }
    trackMetaEvent('PageView')
  }, [pathname, searchParams])

  return null
}

export default function MetaPixel() {
  if (!isMetaPixelConfigured()) return null

  return (
    <>
      <Script id="meta-pixel-base" strategy="afterInteractive">
        {`
          !function(f,b,e,v,n,t,s)
          {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
          n.callMethod.apply(n,arguments):n.queue.push(arguments)};
          if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
          n.queue=[];t=b.createElement(e);t.async=!0;
          t.src=v;s=b.getElementsByTagName(e)[0];
          s.parentNode.insertBefore(t,s)}(window, document,'script',
          'https://connect.facebook.net/en_US/fbevents.js');
          fbq('init', '${META_PIXEL_ID}');
          fbq('track', 'PageView');
        `}
      </Script>
      <noscript>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          height="1"
          width="1"
          style={{ display: 'none' }}
          src={`https://www.facebook.com/tr?id=${META_PIXEL_ID}&ev=PageView&noscript=1`}
          alt=""
        />
      </noscript>
      <Suspense fallback={null}>
        <PixelRouteChangeTracker />
      </Suspense>
    </>
  )
}

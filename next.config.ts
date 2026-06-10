// next.config.ts
// ── Sprint 4 (S4-05): HTTP Security Headers ──────────────────────────────────
//
// Headers applied to every response. Key protections:
//
//   Content-Security-Policy   — restrict script/style/connect sources; block framing
//   Strict-Transport-Security — force HTTPS for 1 year (HSTS)
//   X-Frame-Options           — belt-and-suspenders clickjacking block (pre-CSP browsers)
//   X-Content-Type-Options    — prevent MIME sniffing
//   Referrer-Policy           — don't leak full URL in Referer header
//   Permissions-Policy        — disable unused browser features
//
// CSP NOTES:
//   - 'unsafe-inline' on script-src is required for Next.js App Router hydration
//     and inline script tags. This can be tightened to nonce-based CSP via
//     middleware.ts in a future sprint (S6+).
//   - All AI API calls (Anthropic, DeepSeek) and TTS calls (Soniox) are made
//     server-side from API routes — they do NOT appear in connect-src because
//     CSP only governs browser-initiated connections.
//   - Supabase URL is dynamic (*.supabase.co) — using wildcard subdomain.
//   - microphone is NOT blocked in Permissions-Policy: voice input requires it.
//   - worker-src 'self': explicit allowance for service worker registration (PWA).
//     Without this, some browsers fall back to child-src → default-src, but
//     being explicit prevents any browser-specific ambiguity.
// ─────────────────────────────────────────────────────────────────────────────

import type { NextConfig } from 'next'

// ── Build CSP string ─────────────────────────────────────────────────────────

const ContentSecurityPolicy = [
  // Default: only same-origin
  "default-src 'self'",

  // Scripts: Next.js requires 'unsafe-inline' for hydration scripts.
  // TODO S6+: replace with nonce-based CSP via middleware.ts
  "script-src 'self' 'unsafe-inline'",

  // Styles: Next.js injects inline styles; Google Fonts CSS is loaded in layout.tsx
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",

  // Fonts: Google Fonts static assets served from fonts.gstatic.com
  "font-src 'self' https://fonts.gstatic.com",

  // Images: data: URIs used by Next.js Image and inline SVGs; blob: for canvas exports
  "img-src 'self' data: blob:",

  // Connections from the browser:
  //   - Same origin (API routes, Next.js data fetching)
  //   - Supabase: REST API + Realtime WebSocket for auth and DB reads
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co",

  // Media: TTS audio is returned as blob: URLs from /api/voice/tts (same origin)
  "media-src 'self' blob:",

  // Workers: explicit 'self' for service worker registration (PWA — sw.js)
  "worker-src 'self'",

  // Block <object>, <embed>, <applet>
  "object-src 'none'",

  // Restrict base tag to same origin (prevents base-tag hijacking)
  "base-uri 'self'",

  // Form submissions: same origin only
  "form-action 'self'",

  // Prevent this app from being embedded in iframes anywhere
  "frame-ancestors 'none'",
].join('; ')


// ── Permissions Policy ────────────────────────────────────────────────────────
// Disable features Quorum doesn't use. microphone is intentionally allowed
// (not listed) because VoiceInput requires it with user permission.

const PermissionsPolicy = [
  'camera=()',
  'geolocation=()',
  'payment=()',
  'usb=()',
  'interest-cohort=()',   // opt out of FLoC/Topics
].join(', ')


// ── Next.js config ────────────────────────────────────────────────────────────

const nextConfig: NextConfig = {
  output: 'standalone',
  serverExternalPackages: ['ws'],

  async headers() {
    return [
      // ── Service worker: must not be cached & must declare scope ────────────
      // Cache-Control: no-cache ensures the browser checks for SW updates on
      // every navigation. Without this, a stale SW could persist for hours.
      // Service-Worker-Allowed: / explicitly sets scope to root (belt + suspenders
      // since sw.js is already at the root path).
      {
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control',          value: 'no-cache, no-store, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },

      // ── All other routes: security headers ────────────────────────────────
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: ContentSecurityPolicy,
          },
          {
            // Force HTTPS for 1 year; include subdomains
            // preload not set — requires submission to HSTS preload list
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains',
          },
          {
            // Belt-and-suspenders clickjacking protection (pre-CSP browsers)
            // Redundant with frame-ancestors in CSP but belt-and-suspenders
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            // Prevent browsers guessing content type from payload
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            // Only send origin (not full URL) in Referer header to third parties
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'Permissions-Policy',
            value: PermissionsPolicy,
          },
        ],
      },
    ]
  },
}

export default nextConfig

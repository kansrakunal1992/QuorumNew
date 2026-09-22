import type { Metadata } from 'next'
import './globals.css'
import { isUnifiedSessionEnabled } from '@/lib/feature-flags'
import ThemeToggle from '@/components/ThemeToggle'
import CookieConsent from '@/components/CookieConsent'
import AppFooter from '@/components/AppFooter'
import UpdateBanner from '@/components/UpdateBanner'
import InstitutionModeBadge from '@/components/InstitutionModeBadge'   // Institutional Sprint 5
import PlanBadge from '@/components/PlanBadge'                         // Free/Elite plan identifier
import VisitorCounter from '@/components/VisitorCounter'               // "N people already here" social-proof pill
import MetaPixel from '@/components/MetaPixel'                         // Free-tier acquisition funnel tracking

export const metadata: Metadata = {
  title: 'Quorum — Private Decision Intelligence',
  description: 'Convene your personal advisory council before every high-stakes decision.',
}

// ── Structured data (schema.org) ──────────────────────────────────────────
// Site-wide Organization + SoftwareApplication JSON-LD. This is the single
// clearest, most machine-readable statement of "what Quorum is" on the
// entire site — deliberately including a disambiguation line, because the
// name "Quorum" is already used by an unrelated public-affairs software
// company (quorum.us) and by several other unrelated "AI council of
// advisors" projects. Without this, a crawler or model has to infer which
// "Quorum" it's looking at; with it, the entity is stated outright.
//
// Update APP_URL (via NEXT_PUBLIC_APP_URL) once the production domain is
// set — see the accompanying baby-steps doc.
function structuredData(appUrl: string) {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        name: 'Quorum',
        alternateName: 'Quorum — Private Decision Intelligence',
        url: appUrl,
        logo: `${appUrl}/quorum-logo.png`,
        description:
          'Quorum is private decision intelligence software. It is not affiliated with the public-affairs software company at quorum.us, or with any other product using the name "Quorum" or "QuorumAI."',
      },
      {
        '@type': 'SoftwareApplication',
        name: 'Quorum — Private Decision Intelligence',
        url: appUrl,
        applicationCategory: 'BusinessApplication',
        operatingSystem: 'Web',
        description:
          'Convene a council of six AI advisor personas before a high-stakes decision, then track whether your judgment compounds over time with Mirror. Built for founders, CXOs, and family office principals.',
        offers: [
          {
            '@type': 'Offer',
            name: 'Council (Free)',
            price: '0',
            priceCurrency: 'INR',
          },
          {
            '@type': 'Offer',
            name: 'Elite (adds Mirror, monthly)',
            price: '2999',
            priceCurrency: 'INR',
          },
          {
            '@type': 'Offer',
            name: 'Elite (adds Mirror, annual)',
            price: '29999',
            priceCurrency: 'INR',
          },
          {
            '@type': 'Offer',
            name: 'Private (custom enterprise, from)',
            price: '9999',
            priceCurrency: 'INR',
          },
        ],
      },
    ],
  }
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://your-domain-here.com'

  return (
    <html lang="en" data-theme="light" data-unified-session={isUnifiedSessionEnabled() ? 'true' : undefined} suppressHydrationWarning>
      <head>
        {/* ── Prevent theme flash ── */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function(){
                try {
                  var t = localStorage.getItem('quorum_theme');
                  if (t === 'light' || t === 'dark') {
                    document.documentElement.setAttribute('data-theme', t);
                  }
                } catch(e) {}
              })();
            `,
          }}
        />

        {/* ── Structured data (Organization + SoftwareApplication) ── */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData(appUrl)) }}
        />

        {/* ── PWA ──────────────────────────────────────────────────────────
            manifest.json  — app identity, icons, display mode for install prompt
            theme-color    — browser chrome colour when launched from home screen
            apple-*        — iOS home screen behaviour (Safari-specific)
            mobile-web-app — Android home screen add
        ─────────────────────────────────────────────────────────────────── */}
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#0a0a0a" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Quorum" />
        <link rel="apple-touch-icon" href="/icon-192.png" />

        {/*
          ── Typography stack ──────────────────────────────────────
          Display  : Cormorant Garamond — editorial serif, counsel gravitas
          Body     : DM Sans — humanist geometric, optical-size axis,
                     warmer than Inter on dark backgrounds, same DM family
                     as DM Mono → cohesive type system
          Mono     : DM Mono — labels, tags, nav, data
          ─────────────────────────────────────────────────────────
          DM Sans loaded as a variable font (opsz 9–40, wght 300–700)
          covering regular + italic in a single file — faster than
          the 8 static Inter files previously used.
        */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400;1,500&family=DM+Mono:wght@400;500&family=DM+Sans:ital,opsz,wght@0,9..40,300..700;1,9..40,300..700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <MetaPixel />
        <UpdateBanner />
        <ThemeToggle />
        {/* Institutional Sprint 5 — fixed top-right, renders null unless the
            signed-in user actually belongs to an institution */}
        <InstitutionModeBadge />
        {/* Free/Elite plan identifier — in-flow strip, renders null when
            signed out. Stacks below InstitutionModeBadge's strip when both apply. */}
        <PlanBadge />
        {children}
        {/* S2-04 — legal footer on every page */}
        <AppFooter />
        {/* "N people already here" social-proof pill — fixed bottom-left,
            hides itself when the footer above scrolls into view */}
        <VisitorCounter />
        {/* S2-01 — cookie consent banner; gated to client, no SSR flash */}
        <CookieConsent />
      </body>
    </html>
  )
}

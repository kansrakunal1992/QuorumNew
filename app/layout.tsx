import type { Metadata } from 'next'
import './globals.css'
import ThemeToggle from '@/components/ThemeToggle'
import CookieConsent from '@/components/CookieConsent'
import AppFooter from '@/components/AppFooter'

export const metadata: Metadata = {
  title: 'Quorum — Private Decision Intelligence',
  description: 'Convene your personal advisory council before every high-stakes decision.',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
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
        <ThemeToggle />
        {children}
        {/* S2-04 — legal footer on every page */}
        <AppFooter />
        {/* S2-01 — cookie consent banner; gated to client, no SSR flash */}
        <CookieConsent />
      </body>
    </html>
  )
}

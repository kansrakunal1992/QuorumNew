import type { Metadata } from 'next'
import './globals.css'
import ThemeToggle from '@/components/ThemeToggle'

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
        {/* ── Inject theme before paint to prevent flash ── */}
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
      </head>
      <body>
        <ThemeToggle />
        {children}
      </body>
    </html>
  )
}

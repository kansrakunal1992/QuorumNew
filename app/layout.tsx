import type { Metadata } from 'next'
import './globals.css'

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
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}

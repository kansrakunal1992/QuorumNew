// app/page.tsx
//
// Previously this file WAS the homepage — a 'use client' component — which
// meant it could not export `metadata` (Next.js only allows metadata exports
// from Server Components). The homepage inherited the generic title/
// description from app/layout.tsx instead of having its own.
//
// Fix: this file is now a thin Server Component that owns the homepage's
// metadata and renders the original client component, moved unchanged to
// ./HomeClient.tsx. No visual or behavioral change — same component, same
// 'use client' boundary, just wrapped so it can carry its own <title> and
// <meta description> instead of falling back to the layout's.
//
// /app/methodology/page.tsx already does this correctly (own title +
// description) — this brings the homepage in line with that pattern.

import type { Metadata } from 'next'
import HomeClient from './HomeClient'
import NaturalIntakeClient from './NaturalIntakeClient'
import { isNaturalIntakeEnabled } from '@/lib/feature-flags'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://your-domain-here.com'

export const metadata: Metadata = {
  title: 'Quorum — Private Decision Intelligence',
  // v15: matches the front door. Says what the product does; no claim that it knows or predicts the person.
  description:
    'Bring a hard decision. Six independent advisors and an Examiner challenge it, Quorum checks back on what happened, and over time shows you the patterns in how you decide.',
  alternates: {
    canonical: APP_URL,
  },
  openGraph: {
    title: 'Quorum — Private Decision Intelligence',
    description: 'Bring a hard decision. Have it challenged by six independent advisors, and remembered.',
    url: APP_URL,
    siteName: 'Quorum',
    images: [{ url: `${APP_URL}/quorum-logo.png` }],
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: 'Quorum — Private Decision Intelligence',
    description: 'Bring a hard decision. Have it challenged by six independent advisors, and remembered.',
    images: [`${APP_URL}/quorum-logo.png`],
  },
}

export default function Page() {
  // Natural Intake v1: a user only ever sees one of these two, decided
  // server-side before anything renders — never both, never a flash of one
  // then the other. HomeClient is not modified by this addition.
  if (isNaturalIntakeEnabled()) {
    return <NaturalIntakeClient />
  }
  return <HomeClient />
}

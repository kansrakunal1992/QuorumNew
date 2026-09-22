// app/sitemap.ts
//
// Generates /sitemap.xml at build/request time via Next.js's Metadata API
// (https://nextjs.org/docs/app/api-reference/file-conventions/metadata/sitemap).
//
// The site had none before. Only public, unauthenticated pages are listed —
// nothing under /session, /record, /mirror, /admin, /settings, /account,
// since those require login and shouldn't be indexed or cited as URLs
// someone can just visit.
//
// Add a new entry here whenever a new public page is added (e.g. a future
// /blog post, a /compare page, a glossary entry for "judgment compounding").

import type { MetadataRoute } from 'next'

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://your-domain-here.com'
  const now = new Date()

  return [
    {
      url: `${baseUrl}/`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 1,
    },
    {
      url: `${baseUrl}/methodology`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.8,
    },
    {
      url: `${baseUrl}/security`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.4,
    },
    {
      url: `${baseUrl}/privacy`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.3,
    },
    {
      url: `${baseUrl}/terms`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.3,
    },
    {
      url: `${baseUrl}/cookies`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.2,
    },
    {
      url: `${baseUrl}/install`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.4,
    },
  ]
}

// app/robots.ts
//
// Generates /robots.txt at build/request time via Next.js's Metadata API
// (https://nextjs.org/docs/app/api-reference/file-conventions/metadata/robots).
//
// Why this exists: the site previously shipped with no robots.txt at all.
// That's not a "blocked" state (no file = crawl everything by default), but
// it also means nothing ever told AI answer-engine crawlers they're welcome,
// and nothing kept any crawler out of the private, auth-gated app routes.
//
// Two things this file does:
//   1. Explicitly allows the crawlers that power AI answers/citations —
//      ChatGPT, Claude, Perplexity, Gemini — on the public marketing and
//      content pages, so Quorum can be read and cited by name.
//   2. Disallows the private app routes for every crawler. These are already
//      behind auth, so this isn't a security boundary — it's just hygiene:
//      no crawler should be spending time (or a citation) on a URL that
//      resolves to a login wall or another user's session.
//
// Update PRIVATE_PATHS if new authenticated routes are added under app/.

import type { MetadataRoute } from 'next'

const PRIVATE_PATHS = [
  '/session/',
  '/record/',
  '/mirror/',
  '/admin/',
  '/settings/',
  '/account/',
  '/api/',
  '/auth/',
  '/share/',
  '/install/',
]

// AI answer-engine + assistant crawlers, current as of late 2026.
// Source roles (why each is here, not just its name):
//   GPTBot            OpenAI  — training data for ChatGPT
//   OAI-SearchBot      OpenAI  — indexing for ChatGPT Search citations
//   ChatGPT-User       OpenAI  — on-demand fetch when a user pastes a URL
//   ClaudeBot          Anthropic — training data for Claude
//   Claude-SearchBot   Anthropic — indexing for Claude's search citations
//   Claude-User        Anthropic — on-demand fetch when a user references a URL
//   PerplexityBot      Perplexity — builds Perplexity's primary search index
//   Perplexity-User    Perplexity — on-demand fetch when a user invokes a URL
//   Google-Extended    Google — opt-in signal for training Gemini / Vertex AI
//   GoogleOther        Google — AI Overviews and experimental surfaces
//   Applebot-Extended  Apple — Apple Intelligence training
//   CCBot              Common Crawl — the open dataset many models train on
//
// Regular Googlebot and Bingbot are handled by the "*" group below (both
// also feed Google AI Overviews and Copilot respectively — you generally
// don't want to block classic search while trying to gain AI visibility).
const AI_CRAWLERS = [
  'GPTBot',
  'OAI-SearchBot',
  'ChatGPT-User',
  'ClaudeBot',
  'Claude-SearchBot',
  'Claude-User',
  'PerplexityBot',
  'Perplexity-User',
  'Google-Extended',
  'GoogleOther',
  'Applebot-Extended',
  'CCBot',
]

export default function robots(): MetadataRoute.Robots {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://your-domain-here.com'

  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: PRIVATE_PATHS,
      },
      ...AI_CRAWLERS.map((userAgent) => ({
        userAgent,
        allow: '/',
        disallow: PRIVATE_PATHS,
      })),
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
  }
}

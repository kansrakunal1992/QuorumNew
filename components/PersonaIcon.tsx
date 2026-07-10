// components/PersonaIcon.tsx
// Item #8/20: a small, restrained icon per council persona. Deliberately
// abstract/geometric line-art (stroke-based, single color via currentColor)
// to match the existing icon convention in the app (see IconTrash and the
// chevron/polyline icons in app/page.tsx and DecisionRules.tsx) rather than
// literal avatars or mascots — the site's visual language is "Private Bank
// Stationery," not an illustrated cast of characters.
//
// Each glyph is a quiet visual metaphor for what that advisor does, not a
// literal picture of them:
//   Contrarian          — a circle cut by an X: direct opposition
//   Risk Architect       — a triangle with a fracture line: finds the break point
//   Pattern Analyst      — connected nodes: echoes the Decision Graph's own visual language
//   Stakeholder Mirror   — two overlapping circles: who else is in the frame
//   Elder                — concentric rings: slow, accumulated time
//   Competitor           — two chevrons facing away from each other: rivalry/tension

import type { PersonaKey } from '@/lib/types'

type IconPersona = Exclude<PersonaKey, 'synthesis' | 'decision_brief'>

interface Props {
  persona: IconPersona
  size?: number
  color?: string
  strokeWidth?: number
}

export default function PersonaIcon({ persona, size = 20, color = 'currentColor', strokeWidth = 1.6 }: Props) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none' as const,
    stroke: color,
    strokeWidth,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  }

  switch (persona) {
    case 'contrarian':
      return (
        <svg {...common} aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M8.5 8.5l7 7" />
          <path d="M15.5 8.5l-7 7" />
        </svg>
      )
    case 'risk_architect':
      return (
        <svg {...common} aria-hidden="true">
          <path d="M12 3.5l8.5 15h-17z" />
          <path d="M13.2 9.5l-2.3 5h3l-2.1 5" />
        </svg>
      )
    case 'pattern_analyst':
      return (
        <svg {...common} aria-hidden="true">
          <path d="M5.5 6l6.5 7M18.5 6L12 13M12 13l-4.8 6" />
          <circle cx="5.5" cy="6" r="1.5" fill={color} stroke="none" />
          <circle cx="18.5" cy="6" r="1.5" fill={color} stroke="none" />
          <circle cx="12" cy="13" r="1.5" fill={color} stroke="none" />
          <circle cx="7.2" cy="19" r="1.5" fill={color} stroke="none" />
        </svg>
      )
    case 'stakeholder_mirror':
      return (
        <svg {...common} aria-hidden="true">
          <circle cx="9" cy="12" r="6.5" />
          <circle cx="15" cy="12" r="6.5" />
        </svg>
      )
    case 'elder':
      return (
        <svg {...common} aria-hidden="true">
          <circle cx="12" cy="12" r="2.75" />
          <circle cx="12" cy="12" r="6" />
          <circle cx="12" cy="12" r="9.5" />
        </svg>
      )
    case 'competitor':
      return (
        <svg {...common} aria-hidden="true">
          <path d="M4.5 7.5l5.5 4.5-5.5 4.5" />
          <path d="M19.5 7.5l-5.5 4.5 5.5 4.5" />
        </svg>
      )
    default:
      return null
  }
}

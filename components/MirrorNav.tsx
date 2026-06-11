'use client'

// components/MirrorNav.tsx
// ── Sprint M2: Sticky Mirror section navigation ───────────────────────────────
//
// Renders a slim sticky sub-nav just below the Mirror page header.
// Each pill scrolls to the corresponding section (id="msec-{key}").
// IntersectionObserver highlights the currently-visible section.
// Mobile: horizontal-scroll pill strip, no overflow clipping.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useCallback } from 'react'

const SECTIONS = [
  { key: 'fingerprint',     label: 'Fingerprint'    },
  { key: 'independence',    label: 'Independence'   },
  { key: 'rules',           label: 'Rules'          },
  { key: 'patterns',        label: 'Patterns'       },
  { key: 'contradictions',  label: 'Contradictions' },
  { key: 'calibration',     label: 'Calibration'    },
  { key: 'sri',             label: 'Reliability'    },
  { key: 'timeline',        label: 'Timeline'       },
] as const

type SectionKey = typeof SECTIONS[number]['key']

export default function MirrorNav({ highlightedSections = [] }: {
  highlightedSections?: string[]
}) {
  const [active, setActive] = useState<SectionKey | null>(null)

  useEffect(() => {
    const observers: IntersectionObserver[] = []
    SECTIONS.forEach(({ key }) => {
      const el = document.getElementById(`msec-${key}`)
      if (!el) return
      const obs = new IntersectionObserver(
        entries => { entries.forEach(e => { if (e.isIntersecting) setActive(key) }) },
        { rootMargin: '-30% 0px -60% 0px', threshold: 0 },
      )
      obs.observe(el)
      observers.push(obs)
    })
    return () => observers.forEach(o => o.disconnect())
  }, [])

  // Auto-scroll active pill into view on mobile
  useEffect(() => {
    if (!active) return
    const pill = document.querySelector<HTMLElement>(`.mirror-nav-pill[data-key="${active}"]`)
    pill?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
  }, [active])

  const scrollTo = useCallback((key: SectionKey) => {
    const el = document.getElementById(`msec-${key}`)
    if (!el) return
    const top = el.getBoundingClientRect().top + window.scrollY - 96
    window.scrollTo({ top, behavior: 'smooth' })
    setActive(key)
      }, [])  
      // Deep-link scroll: fires when landing on /mirror#msec-{key} from an external link  
      // (e.g. CalibrationRevealCard). Delayed 650ms so sections have rendered before scrolling.  
      useEffect(() => {
            const hash = window.location.hash    
            if (!hash.startsWith('#msec-')) return    
            const key = hash.slice(6) as SectionKey    
            const t1 = setTimeout(() => scrollTo(key), 800)     
            const t2 = setTimeout(() => scrollTo(key), 3000)     
            return () => { clearTimeout(t1); clearTimeout(t2); 
            window.scrollTo(window.scrollX, window.scrollY) }
          }, [scrollTo])  
          
    return (
    <>
      <style>{`
        .mirror-nav-wrap {
          position:         sticky;
          top:              52px;
          z-index:          40;
          background:       var(--bg-void);
          border-bottom:    1px solid var(--border-dim);
          margin:           0 -24px 28px;
          padding:          0 24px;
        }
        .mirror-nav-inner {
          display:          flex;
          gap:              2px;
          overflow-x:       auto;
          padding:          8px 0;
          scrollbar-width:  none;
          max-width:        680px;
          margin:           0 auto;
        }
        .mirror-nav-inner::-webkit-scrollbar { display: none; }
        .mirror-nav-pill {
          flex-shrink:      0;
          padding:          4px 12px;
          border-radius:    20px;
          border:           1px solid transparent;
          background:       transparent;
          font-family:      inherit;
          font-size:        11px;
          font-weight:      500;
          letter-spacing:   0.03em;
          color:            var(--text-4, #888);
          cursor:           pointer;
          transition:       all 0.15s;
          white-space:      nowrap;
        }
        .mirror-nav-pill:hover {
          color:            var(--text-2, #ccc);
          background:       var(--bg-card-alt);
        }
        .mirror-nav-pill.active {
          color:            var(--gold, #c9a84c);
          background:       rgba(201,168,76,0.08);
          border-color:     rgba(201,168,76,0.25);
        }
        @media (max-width: 600px) {
          .mirror-nav-wrap { margin: 0 -16px 24px; padding: 0 16px; top: 48px; }
          .mirror-nav-pill { font-size: 10.5px; padding: 6px 12px; min-height: 36px; }
        }
        .mirror-nav-badge {
          display: inline-block; width: 5px; height: 5px; border-radius: 50%;
          background: var(--gold, #c9a84c); margin-left: 4px;
          vertical-align: middle; margin-top: -2px;
        }
      `}</style>
      <div className="mirror-nav-wrap">
        <div className="mirror-nav-inner" role="navigation" aria-label="Mirror sections">
          {SECTIONS.map(({ key, label }) => (
            <button
              key={key}
              data-key={key}
              className={`mirror-nav-pill${active === key ? ' active' : ''}`}
              onClick={() => scrollTo(key)}
              aria-current={active === key ? 'location' : undefined}
            >
              {label}
              {highlightedSections.includes(key) && (
                <span className="mirror-nav-badge" aria-hidden="true" />
              )}
            </button>
          ))}
        </div>
      </div>
    </>
  )
}

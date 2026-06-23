'use client'

import { useEffect, useState } from 'react'

// Reads the current theme synchronously from localStorage (same key the
// inline anti-flash script uses). Falls back to the DOM attribute so that
// both SSR and CSR paths agree. Never reads 'dark' as a hardcoded default —
// that caused the button to briefly show the wrong mode on every page load.
function getPersistedTheme(): 'dark' | 'light' {
  try {
    const stored = localStorage.getItem('quorum_theme')
    if (stored === 'light' || stored === 'dark') return stored
  } catch { /* ignore */ }
  // Fallback: read whatever the anti-flash script already stamped on <html>
  if (typeof document !== 'undefined') {
    const attr = document.documentElement.getAttribute('data-theme')
    if (attr === 'light' || attr === 'dark') return attr
  }
  return 'dark'
}

export default function ThemeToggle() {
  // Initialise as null to avoid any flash — rendered only after mount
  const [theme, setTheme] = useState<'dark' | 'light' | null>(null)

  useEffect(() => {
    // Sync from persisted preference on every mount (covers page navigations)
    const persisted = getPersistedTheme()
    setTheme(persisted)
    // Ensure the DOM attribute is in sync (in case SSR defaulted to 'dark')
    document.documentElement.setAttribute('data-theme', persisted)
  }, [])

  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    document.documentElement.setAttribute('data-theme', next)
    try { localStorage.setItem('quorum_theme', next) } catch { /* ignore */ }
  }

  // Render nothing until we know the real theme — avoids a dark→light flash
  // on the button itself. The page background is already correct (anti-flash
  // inline script ran before paint); only the button label needs to wait.
  if (theme === null) return null

  const isDark = theme === 'dark'

  return (
    <button
      className="theme-toggle"
      onClick={toggle}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {isDark ? (
        /* Sun icon */
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="5"/>
          <line x1="12" y1="1" x2="12" y2="3"/>
          <line x1="12" y1="21" x2="12" y2="23"/>
          <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
          <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
          <line x1="1" y1="12" x2="3" y2="12"/>
          <line x1="21" y1="12" x2="23" y2="12"/>
          <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
          <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
        </svg>
      ) : (
        /* Moon icon */
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
        </svg>
      )}
      {isDark ? 'Light' : 'Dark'}
    </button>
  )
}

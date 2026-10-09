// lib/prefill.ts
// -- Phase 1 (retention work) -------------------------------------------------
// One-shot hand-off of "the next decision" text from a post-decision screen to
// the chat input on the home page ("Bring it now" in NextDecisionPrompt).
// sessionStorage, so it never outlives the tab and is consumed exactly once.

const KEY = 'quorum_prefill_decision'

export function setDecisionPrefill(text: string): void {
  if (typeof window === 'undefined') return
  const t = text.trim().slice(0, 600)
  try {
    if (t) sessionStorage.setItem(KEY, t)
    else sessionStorage.removeItem(KEY)
  } catch { /* storage unavailable -- the chat just opens empty */ }
}

/** Returns the pending text and clears it. */
export function takeDecisionPrefill(): string | null {
  if (typeof window === 'undefined') return null
  try {
    const t = sessionStorage.getItem(KEY)
    if (t) sessionStorage.removeItem(KEY)
    return t && t.trim() ? t : null
  } catch { return null }
}

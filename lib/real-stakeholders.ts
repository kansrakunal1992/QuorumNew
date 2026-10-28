// lib/real-stakeholders.ts
// ── Who counts as "someone else" in a decision (pure) ────────────────────────
//
// The chat's note-taker sometimes lists the person themselves as a stakeholder ("You", "Me", "myself"). The summary
// screen already hid those from "Who's involved"; the outreach card did not, so a first-time user saw
// "Want to hear from You directly? [Ask You]". One helper, used by both, so they cannot drift apart again.

import type { ChatStakeholderMention } from '@/lib/types'

const SELF_REFERENCE = /^(you|me|myself|i|yourself|self)$/i

/** True when the name is the person themselves rather than someone they could ask. */
export const isSelfReference = (name: string | null | undefined): boolean =>
  !name || !name.trim() || SELF_REFERENCE.test(name.trim())

/** The stakeholders worth offering outreach to, in their original order. */
export function realStakeholders(list: ChatStakeholderMention[] | null | undefined): ChatStakeholderMention[] {
  return (list ?? []).filter(s => !isSelfReference(s?.name))
}

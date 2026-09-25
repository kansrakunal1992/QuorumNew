# Integration Spikes — Slack, Gmail, Outlook, WhatsApp (Phase 0)

No connector code ships in this drop. This is the research that the locked
decisions (Gmail send-only-first, Slack both-tracks-now, WhatsApp
share-from-own-app) were made against, so Phase 2's estimate starts from
facts instead of assumptions.

## Slack
- OAuth sign-in, targeted message search, and sending as the user are all
  supported through standard Slack APIs.
- Since March 2026, apps that are **not** listed on the Slack Marketplace are
  rate-limited to roughly 1 request per minute and 15 messages per
  conversation-history call — workable for "search for this specific thing"
  but not for anything resembling bulk indexing. Slack's own terms
  separately prohibit bulk indexing regardless of rate limits.
- **Decision:** pursue private/internal testing and the Marketplace listing
  process in parallel, not sequentially — but the Marketplace review itself
  runs on Slack's own timeline, outside our control. Phase 2 will scope the
  actual review effort once we're in it.

## Gmail
- Sending mail uses a lighter-weight OAuth scope with a simpler approval path.
- **Reading** mail requires a Google "restricted" scope, which requires an
  app verification process plus an **annual, paid third-party security
  assessment (CASA)** — a real recurring cost, not a one-time gate, and one
  that takes weeks to clear the first time.
- **Decision:** ship send-only first (draft in Quorum, send as the user, user
  pastes any reply back in manually). No verification process started yet —
  that's a distinct, separately-scoped decision for later.

## Outlook / Microsoft 365
- Both reading and sending are available through delegated, user-level
  Microsoft Graph permissions.
- Requires Microsoft publisher verification; some organizations' admins
  additionally require pre-approval before their employees can consent to a
  third-party app at all — a real friction point for anyone using a
  work Microsoft account, not something we can route around.
- **Decision:** build after Slack, as its own connector — not blocking Phase 2.

## WhatsApp
- The official WhatsApp Business Platform sends only from a **business-owned
  number**, only to people who have opted in, and only within a rolling
  24-hour window after they last messaged that number.
- There is **no official way** to read or send from someone's personal
  WhatsApp account or personal chat history — this isn't a rate limit or an
  approval process, it's a hard platform boundary. No workaround was found,
  and none should be built.
- **Decision:** the person sends the message from their own WhatsApp app
  (Quorum drafts it, hands off via a prefilled "open in WhatsApp" link), and
  a reply is brought back into Quorum by the person sharing or pasting it in
  — not by Quorum reading it directly.

## Standing rules for all four, once built
Explicit permission per use, never a standing bulk grant. No full-history
import. Only the specific messages the user picks get stored. Every
outbound send requires a one-tap confirm screen showing the exact text.
Easy disconnect. Connectors are surfaced in context ("Want to hear your CTO
directly?"), never as an onboarding step.

# Privacy & Security Copy — Draft Additions (for Kunal to place in the real pages)

Not applied to `app/privacy/page.tsx` or any legal page in this zip — that
file wasn't read in full this round, and legal copy shouldn't be edited
blind. These are draft paragraphs for you to place, reworded as needed once
Phase 2 (Slack/Gmail/Outlook/WhatsApp) actually ships. Nothing below is live
in v1 — no connector code exists yet in this drop.

## Why this is needed
Today's trust copy ("Private", "Not used for training", "raw import never
stored") is written for content that's entirely the user's own. Once a
connector can pull in a Slack message or an email, that's no longer true —
some of what Quorum stores will be words written by someone else, about the
user's decision, without that person having used Quorum themselves.

## Draft: what changes when a connector is on
> When you connect Slack, Gmail, Outlook, or share a WhatsApp message with
> Quorum, only what you explicitly ask us to look at or paste in is stored —
> never your full mailbox or channel history. Anything a colleague or family
> member wrote that we bring in gets kept as **evidence for your decision**,
> tagged with where it came from, and it stays separate from your own
> reflections — we tell your bias and pattern engine what's yours and what's
> someone else's, so someone else's wording never gets folded into your
> personal profile.

## Draft: consent language shown at first connect (per connector)
> Quorum will only search [Slack / your inbox] when you ask it to, for
> exactly what you ask it to find. We'll show you what we found before it's
> used. You can disconnect at any time from Settings, and anything already
> imported can be deleted with your other data.

## Draft: before any outbound message is sent
> This will be sent from your own [Slack / Gmail / Outlook] account, as you.
> Review it below — nothing goes out until you tap Send.

## Open item for Kunal
Once real connector copy is drafted for the actual legal/marketing pages,
it should also get a one-line mention in the FAQ (`components/FAQSection.tsx`)
and the trust strip (`components/TrustBadgeStrip.tsx`) — both read in this
audit only enough to know they exist, not edited here.

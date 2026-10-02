# v5 — naming note, the two reminders, and the back-button fix

4 files. Built on `QuorumZip1stOctLatest.zip`.

## A naming collision, so nothing's confusing later

Your latest upload already contains a `docs/CHANGELOG_v4.md` — real, substantial
work (the council-nudge funnel, lean taps, prediction-at-reveal) that reads
like it was done directly against your repo, independent of this thread. So
**"v4" is already taken.** What I had queued up as "v4" (the hero-card cap and
the magic-link fix, from your reminders) ships here as **v5** instead, to
avoid two different things both claiming to be v4 in your history. Confirmed
first that this didn't touch anything I was mid-fixing — it doesn't touch
`app/api/auth/route.ts`, `lib/hero-cards.ts`, or `app/NaturalIntakeClient.tsx`
at all, so there's nothing to reconcile there.

## 1. Hero-card cap — removed

Same fix as previously staged: `app/NaturalIntakeClient.tsx` calls
`eligibleHeroCards(...)` directly now, no cap, no rotation. Both files'
header comments updated to match.

## 2. Magic link — fixed

Same fix as previously staged: `app/api/auth/route.ts` was an exact
duplicate of `app/api/auth/link-utm/route.ts`'s content, so every real
request 400'd on a `userId` a pre-auth request can never have, and no link
was ever sent. Reconstructed from both sides of the contract (the two
client callers, and `app/auth/callback/page.tsx`'s own comments on exactly
which URL params it expects back). Same caveat as before — reasoned from a
well-documented contract, not run end-to-end. Please test the actual send
→ email arrives → sign-in works loop, and the `wrong_provider` path with a
Google-linked email, before trusting it in production.

## WhatsApp share_target — already done, nothing needed

Checked `public/manifest.json` in this upload (the folder wasn't in earlier
exports, so this is the first chance I've had to look) — the `share_target`
key is already there, matching what v3's changelog asked for exactly.
Nothing for me to do here.

## 3. Stakeholder outreach — back navigation added

The bug you flagged: picking a channel, searching, or getting partway into
a draft had no way back except closing the whole panel and starting over.

`components/StakeholderOutreach.tsx` now shows a **←** next to "Asking
[name]" on every step after the initial channel choice. It goes to the
right previous step, not just "back to start":
- From search → back to channel choice.
- From draft → back to search (Slack/Teams/Outlook, since a target was
  picked there) or back to channel choice (Gmail/WhatsApp/copy, which have
  no search step).
- From sent or the paste-a-reply screen → back to channel choice.

Each step clears the state it shouldn't carry forward (a half-typed draft,
a picked search target) so going back doesn't leave stale data behind for
the next attempt. "Regenerate" (new AI draft, same target) and manual
edits in the textarea are unchanged — the back button is for changing an
earlier *choice*, not for rewording the same message.

## Version
This is **v5**, picking up after your repo's own v4. Next will be **v6**.

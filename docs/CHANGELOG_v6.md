# v6 — Judgment Record on the flag-on landing page

3 files. Built on `QuorumZip5Oct.zip` (confirmed your external edits there
were copy-only, in `ChatIntake.tsx` and `lib/chat-intake-reply.ts` — nothing
touching what this adds, so nothing to reconcile).

## What's in this drop

**`components/JudgmentRecordStrip.tsx`** (new) — the ported section: same
data and same All / Open / Logged tabs as `app/HomeClient.tsx`'s "Your
judgment record," same outcome-dot/snippet/date/status-badge row, click
through to `/record/[id]`. Two deliberate differences from the flag-off
version:
- Shows the latest **3** by default, not 5 — "Show N more" still reveals
  the rest, per tab.
- Styled as a bordered row list (HomeClient's own per-card treatment), not
  `HeroCardCollapsible`'s one-line-summary tile — so it reads as a log of
  real past decisions, not a sixth status card.

Every color is an existing CSS variable already used elsewhere in this
file and in HomeClient.tsx's own version (`--outcome-yes/partial/no`,
`--bg-card`, `--border-dim`, `--text-1..4`, `--gold*`) — nothing
hardcoded, so it follows `[data-theme]` the same way everything else does.
Renders nothing for a user with zero decisions yet.

**`app/NaturalIntakeClient.tsx`** — the local `HistorySession` type was
narrowed to just `{ outcome }`; widened to the full shape
(`id`, `decision_text`, `created_at`, `outcome`) the existing `/api/history`
call already returns — no backend change, the data was always there, just
not passed through. Now also passes `historySessions` down to `ChatIntake`.

**`components/ChatIntake.tsx`** — new `historySessions` prop, and
`<JudgmentRecordStrip>` rendered between the `AuthPanel` block and
`<MeetTheCouncil />` — below the hero-card stack, immediately above Council,
exactly where you asked for it.

## One pre-existing limitation, not introduced by this change
The history fetch only runs when there's a locally-stored device session id
(`getStoredSessionIds().length`) — a signed-in user opening the app on a
brand-new device with no local history would see nothing here, even though
their account may have real decisions on file server-side. This was already
true of the hero cards' pending/decided counts before this change; the new
section just inherits it. Separate issue, not something I touched — flagging
it rather than leaving it silently unmentioned.

## Version
This is **v6**.

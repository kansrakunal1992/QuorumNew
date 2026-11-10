# Prepopulated decision links (Nov 2026)

`https://app.quorumvault.org/?decision=<text>&utm_...` now opens the front door with `<text>` already in the chat box.
The visitor edits it, deletes it or presses **Help me decide →** themselves. Nothing is ever submitted for them.

## Files
| File | Change |
|---|---|
| `lib/url-prefill.ts` | **New.** Pure helpers: read + clean `?decision=`, tidy the URL, precedence, once-per-page-load claim, edit detection |
| `components/ChatIntake.tsx` | Existing mount-only prefill effect extended; `decision_started` gains two props only when prefilled |
| `lib/prefill.ts` | `600` exported as `MAX_PREFILL_CHARS` (same value, one source of truth) |
| `lib/track.ts` | `decision_prefill_loaded` added to `TrackEventName` |
| `app/api/events/route.ts` | `decision_prefill_loaded` added to `ALLOWED_EVENTS` (without this the server silently drops it) |
| `lib/event-props.ts` | Event registered as an intake-style event (identifier-only values); keys `prefill_chars`, `prefill_truncated` allowed |
| `lib/attribution.ts` | `decision_prefill_loaded` added to `ATTRIBUTED_EVENTS` so it carries utm_source/medium/campaign/content + ref |
| `tests/decision-prefill.test.ts` | **New.** 45 tests |

No SQL migration. No new env var. No change to Council, auth, pricing, persistence or prompts.

## Behaviour
* The box is owned by `ChatIntake` (`input` state), rendered by `NaturalIntakeClient` when `NEXT_PUBLIC_NATURAL_INTAKE_ENABLED=true`. The URL text goes into that same state, through that same `send()`.
* Text is cleaned, not rejected: control characters, invisible bidi overrides, BOM and U+FFFD removed; NFC-normalised; blank-line runs collapsed; cut to **600 characters** by code point (the existing `setDecisionPrefill` limit). Zero-width joiners are kept (Devanagari, emoji). A value with no letter or digit (empty, `???`, emoji only) is ignored.
* Not applied to a resumed chat, and not applied if the box already has text.
* After loading, `decision` (and `q` when `q=1`) is removed from the address bar in a **single** `replaceState`. Every other pair is kept byte-for-byte, in order, with the `#hash`. A refresh or remount therefore cannot reapply it; a module-level claim is a second guard if `replaceState` fails in a webview.
* A prefilled link does **not** focus the box (on a phone that would open the keyboard over the text and the button). `?q=1` and the session hand-off still focus, as before.
* The text is only ever a `<textarea>` value; no `dangerouslySetInnerHTML` anywhere in `ChatIntake`.

### Precedence when sources conflict
1. sessionStorage hand-off (`lib/prefill.ts`, "Bring it now") 2. `?decision=` 3. `?q=1` (focus only, no text).
The hand-off wins because the person chose it moments ago in-app; a link is something someone sent them. If the hand-off wins, a `?decision=` in the URL is still tidied away but no event fires. Starter cards act on a click after the box exists and replace the text by design, as before.

## Analytics
| Event | Props |
|---|---|
| `decision_prefill_loaded` (new; fires once, only when text really went into the box) | `surface='natural_intake'`, `prefill_chars` (number), `prefill_truncated` (bool), `flow_version`, plus context: `device_class`, `in_app`, `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `ref` |
| `decision_started` (existing, unchanged) | existing props, plus **only when prefilled**: `prefilled=true`, `prefill_edited` (bool: any wording change; whitespace-only changes ignored; swapping in a starter card counts as edited) |

The decision text is never sent. The server also drops any non-identifier string on this event.

Example (not executed here; no database in the build sandbox), per campaign, last 14 days:
```sql
select coalesce(props->>'utm_campaign','(none)')                                                     as campaign,
       count(*) filter (where event='landing_view')                                                  as landing_views,
       count(*) filter (where event='decision_prefill_loaded')                                       as prefill_loaded,
       count(*) filter (where event='landing_view') - count(*) filter (where event='decision_prefill_loaded') as ordinary_landings,
       count(*) filter (where event='decision_started' and props->>'prefilled' is null)              as ordinary_started,
       count(*) filter (where event='decision_started' and props->>'prefilled'='true')               as prefilled_started,
       count(*) filter (where event='decision_started' and props->>'prefilled'='true' and props->>'prefill_edited'='false') as prefilled_started_unedited
from events
where created_at > now() - interval '14 days'
  and event in ('landing_view','decision_prefill_loaded','decision_started')
group by 1 order by landing_views desc;
```

## Tests
`tests/decision-prefill.test.ts` covers the 12 areas in the brief. The React effect cannot run in this repo's node-only vitest, so it is pinned by source guards (it never calls `send()`/fetch, is mount-only, fires the event exactly once, passes only a length) alongside behavioural tests of the pure helpers and of `captureFirstTouch`/`getEventContext`.

## Known limits
* `utm_term` is not captured by the existing attribution layer (`lib/event-context.ts` tracks four tags). It is preserved in the URL, not in events. Adding it is a small separate change.
* If `NEXT_PUBLIC_NATURAL_INTAKE_ENABLED` is off, `HomeClient` handles `?decision=` as before; it already wipes the whole query string (UTMs included) when it does. Left untouched (scope).
* `AvoidanceAlertCard`'s "Bring it back" already links to `/?decision=<text>`; with Natural Intake on it was previously ignored and now prefills too. Those events have no `utm_*`, which distinguishes them from campaign links.
* A visitor shown the optional auth gate (`ConnectCard`) instead of the input does not see the text until the gate is passed; a magic-link round trip loses it.
* Do not put sensitive decisions in public links: the text is visible in the URL, history and any referrer.

# CHANGELOG v14: know where people come from, and sign in before the Council

Built on the 29 Oct code (v13). No database migration. Everything new rides in the existing `events.props` column.

Two goals:

1. **Measure the journey end to end** (who arrives, from where, on what device; the cookie banner; errors; payments; the email loop), because ~46% of decisions had no identity and ~94% of landing views were unidentified.
2. **Ask for sign-in at the moment of highest intent**: right before the Council runs, never before the person has typed anything. Every reminder, check-in and the Mirror depends on knowing who the person is.

## 1. Sign in before the Council (ON by default)

- `components/ConveneGate.tsx` wraps `<SessionView>` on `/session/<id>`. A **signed-out** visitor whose **Council has not run yet** sees a short sign-in step instead. `SessionView` is not mounted, so no ontology, examiner or advisor call is made (nothing is spent) until they are signed in.
- Everything already run, locked or completed opens **exactly as before** (`lib/convene-gate.ts`, decided on the server in `app/session/[id]/page.tsx`).
- Reuses `ConnectCard` with a new non-skippable `convene_gate` mode, `returnTo` and `link-sessions`. After Google or the magic link the person lands back on the same `/session/<id>` with the session linked to their account; the magic link works across browsers because the session is fetched by id.
- **In-app browsers** (Instagram, Facebook, WhatsApp, other web views): Google refuses sign-in there, so the gate hides the Google button and shows an email option with a one-line explanation.
- **Fails open**: if the auth check throws, the person gets `SessionView`. A bug in the gate cannot lock anyone out.
- A stale locally-stored email no longer hides the card (the gate trusts only the live Supabase session).
- Linking without cookie consent: `pushSessionIdForSignIn()` writes the one session id at the moment the person taps "Continue with Google", the same reasoning that makes `quorum_return_to` and `quorum_user_email` strictly necessary. Nothing is written unless they start signing in.
- **Switch off:** `NEXT_PUBLIC_CONVENE_GATE=off` (also `0`, `false`, `disabled`, `no`) and redeploy. It is separate from `NEXT_PUBLIC_AUTH_GATE_MODE`.

## 2. New events (all through the strict privacy filter)

Browser events (allow-listed in `app/api/events/route.ts`, props limited to known keys with identifier-shaped values by `lib/event-props.ts`):

| Event | Where | Props |
|---|---|---|
| `consent_shown`, `consent_accepted`, `consent_rejected` | `CookieConsent.tsx` | `functional`, `via` |
| `convene_gate_shown` | `ConveneGate.tsx` | `surface` (+ session id) |
| `client_error` | chat turns, Council advisors, outcome save, payments | `where`, `kind`, `status` (capped at 3 per kind per page load) |
| `paywall_viewed`, `checkout_opened`, `checkout_dismissed`, `payment_success`, `payment_failed` | `PaymentButton.tsx` | `plan`, `surface`, `reason`, `founding` |
| `record_viewed` | `RecordViewTracker.tsx` on `/record/<id>` | `surface` (+ session id) |
| `outcome_recorded` | `OutcomeTracker.tsx` | `helped`, `from_notification`, `source` |

Server-only (not accepted from the browser, so they cannot be forged): `guest_order_created` (with `trigger`, `utm_source`, `utm_campaign`) and `guest_order_paid`, written by `create-order` / `verify-order` through the new `trackServerAnon()`.

Added to existing events: `ms_on_confirm` on `council_launch_requested`; `api_ms` on `intake_step_shown`; `source` on `return_visit`.

Added to **every** event by `lib/track.ts`: `device_class` (ios / android / desktop / other) and `in_app` (instagram / facebook / whatsapp / linkedin / twitter / other_webview / none). Never the raw user agent.

## 3. Attribution (fixes "every signup is direct / none")

`captureUtm()` only ran when the sign-in panel mounted, only with cookie consent, and by then the URL had lost its tags. Now `captureFirstTouch()` runs on arrival (`NaturalIntakeClient`), **before** `landing_view`:

- `landing_view`, `decision_started`, `auth_prompt_seen`, `auth_started`, `magic_link_requested`, `consent_*`, `convene_gate_shown`, `paywall_viewed`, `checkout_opened`, `payment_success` carry `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `ref` (the referrer **host only**, never a path or query).
- Held **in memory** for the page's life, so visitors without cookie consent still get attributed and nothing is written to their device. `getStoredUtm()` now falls back to it, which also repairs signup attribution within a page load.
- Server side, every context key must be a lowercase token (`[a-z0-9._-]`) or it is dropped (`sanitizeContextProps`).

## 4. Visitor token for people with no device id (optional, off unless configured)

Set `VISITOR_HASH_SECRET` (16+ chars). Events with **no device id and no account** then get `props.vh = HMAC(day-key, ip + user agent)`, 16 hex chars, where the day-key changes every UTC day. It cannot be linked across days, reversed to an IP or user agent, or stored on the visitor's device. Purpose: estimate distinct visitors per day. Unset = feature off, no behaviour change.

## 5. Email loop is now measurable

`NOTIFICATION_SOURCES` gained `daily_nudge`, `validation_nudge`, `council_nudge`, `mirror_insight`, `reanalyze_7d`, `reanalyze_14d`, `reanalyze_30d`, and the matching email links carry `?n=<source>`. Before this only three sources were recorded, the nudge opens were invisible, and the 7/14/30-day check-ins all shared one tag. (`review_date` keeps its tag.)

> Test change: `tests/notification-source.test.ts` asserted that `daily_nudge` is rejected; it is now a valid source, so that assertion uses `daily_nudge_typo`.

## Files

New: `lib/event-context.ts`, `lib/attribution.ts`, `lib/visitor-hash.ts`, `lib/convene-gate.ts`, `components/ConveneGate.tsx`, `components/RecordViewTracker.tsx`, `tests/v14-analytics.test.ts`, `docs/CHANGELOG_v14.md`.

Modified: `app/NaturalIntakeClient.tsx`, `app/api/events/route.ts`, `app/api/decision-session/create-order/route.ts`, `app/api/decision-session/verify-order/route.ts`, `app/api/cron/{daily-nudge,validation-nudge,council-nudge,mirror-insight-email,reanalyze-email}/route.ts`, `app/record/[id]/page.tsx`, `app/session/[id]/page.tsx`, `components/{ChatIntake,ConnectCard,CookieConsent,DecisionCheckpoint,OutcomeTracker,PaymentButton,PersonaPanel}.tsx`, `lib/{event-props,notification-source,storage,track,track-server}.ts`, `tests/notification-source.test.ts`, `env.example`.

## Tests and checks

- 583 tests pass (544 existing + 39 new in `tests/v14-analytics.test.ts`): UA parsing, UTM and referrer sanitising, the privacy filter, visitor-token properties, the gate rules, every cron email carries its tag, and wiring guards (the session page wraps `SessionView`, the gate fails open, the public events endpoint does **not** accept the server-only events).
- `tsc --noEmit`: no errors beyond the known TS2802 target warnings.
- `next build`: succeeds (type validation and page generation).

## Roll out and verify

1. Set `NEXT_PUBLIC_CONVENE_GATE` (leave unset or `on` to keep the gate on). Optionally set `VISITOR_HASH_SECRET`.
2. Deploy. No SQL to run.
3. Verify in a **private window** (no cookies):
   - Open `/?utm_source=test&utm_campaign=smoke`. In Supabase: `select props from events where event='landing_view' order by created_at desc limit 1;` should show `utm_source: "test"`, `device_class`, `in_app`.
   - Accept or decline the banner: `consent_shown` then `consent_accepted` / `consent_rejected` appear.
   - Run a chat to Convene: you should land on the sign-in step, no advisor should answer yet, and `convene_gate_shown` appears. Sign in: you return to the same session and the Council starts.
   - Signed in on a fresh session: the Council starts with no visible gate.
4. **Test Google sign-in from inside Instagram** (open the link from a DM). The Google button should be hidden and the email option shown.

**Rollback:** `NEXT_PUBLIC_CONVENE_GATE=off` and redeploy. All tracking is additive and safe to leave on.

## Known limits

- The page that sells the ₹299 session lives outside this repo. To see click vs load, it must send `trigger: "click"` (or `"load"`) to `create-order`; until then those orders record `trigger: "unknown"`.
- `NEXT_PUBLIC_*` values are fixed at build time, so changing the gate flag needs a redeploy (Railway does this automatically when a variable changes).
- Visitors who never accept cookies still have no device id, but the gate gives them an account at Convene, and the optional visitor token lets visits be counted.

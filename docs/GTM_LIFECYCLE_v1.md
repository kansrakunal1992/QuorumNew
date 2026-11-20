# GTM lifecycle emails: Quorum app side

The GTM OS (separate project) decides *which* lifecycle email programs to run. This app sends them. Only **copy text + a segment name** cross over:
never user emails, ids or decision text. The GTM OS cannot read users, cannot send mail itself, and cannot change who is emailed.

## What was added
| File | Purpose |
|---|---|
| `supabase/gtm_lifecycle_v1.sql` | Tables `gtm_outbox` + `gtm_lifecycle_sends`, opt-out column, segment function, outcomes view, write-only role |
| `app/api/cron/gtm-lifecycle/route.ts` | The daily cron that sends |
| `lib/gtm-lifecycle.ts` | Pure safety helpers (holdout draw, link allow-list, copy sanitising) |
| `lib/nudge-token.ts`, `app/api/cron/unsubscribe/route.ts` | New `lifecycle` unsubscribe type (fails loudly if the opt-out cannot be saved) |
| `lib/notification-throttle.ts` | New source `gtm_lifecycle` for the shared 3-day gate |
| `tests/gtm-lifecycle*.test.ts` | 42 tests |

## Turn it on (about 15 minutes)
1. **Supabase SQL editor (the Quorum project, not the GTM OS one):** make sure `gtm_export` from the GTM OS repo (`quorum_product_side/001_gtm_export.sql`) is applied, then run `supabase/gtm_lifecycle_v1.sql`. Safe to re-run. If it stops with *"notification_log has other sources"*, add those names to the list in section 1b and run again.
2. **Set a real password** for the new role (the file creates it with a placeholder):
   `alter role gtm_outbox_writer with password '<long random password>';`
   Build its connection string like your `gtm_readonly` one and give it to the GTM OS as `QUORUM_OUTBOX_DATABASE_URL`.
3. **Railway (this app):** add `GTM_LIFECYCLE_ENABLED=false` and `GTM_LIFECYCLE_DAILY_CAP=100`. Deploy.
4. **cron-job.org:** new job, `POST https://<your-app>/api/cron/gtm-lifecycle`, header `Authorization: Bearer <CRON_SECRET>`, daily at 05:30 UTC (after the existing nudge crons so they keep priority).
5. **Dry run:** set `GTM_LIFECYCLE_ENABLED=true`, then call the same URL with `?dry=1`. It returns `sent` (would send), `holdout`, `deferred`, `skipped`, `errors`. Nothing is sent or saved.
6. When the numbers look right, let the schedule run. The first real program should be small (`max_per_run` is set by the GTM OS, default 50).

## Controls you always have
- **Everything off:** set `GTM_LIFECYCLE_ENABLED=false` (the route then does nothing).
- **One program:** `update public.gtm_outbox set status = 'paused' where slug = '<slug>';` (or `'cancelled'`).
- **Programs stop by themselves** 45 days after they are handed over (`ends_at`).
- **Volume caps:** per program `max_per_run`, and across all programs `GTM_LIFECYCLE_DAILY_CAP`.
- **Retry a user whose send failed:** nothing to do; a failed send is released and retried on the next run. A row stuck in `claimed` means the server died mid-send; the user is deliberately *not* retried (no double-send). Delete that row if you want them retried.

## Safety rules enforced in this app
- Links in these emails can only point **inside this app** (a compromised outbox cannot send people to another site).
- Users who unsubscribed, were already assigned to the program, or got any lifecycle email in the last `cooldown_days` are never selected.
- The shared 3-day gate applies, so nobody gets two nudges back-to-back from different crons.
- A holdout group (default 10%) is recorded but never emailed; results are compared 14 days after assignment in `gtm_export.lifecycle_outcomes`.
- Each email has a one-click "Stop these emails" link. **Before real sending, have the legal basis, sender identity/address and unsubscribe wording reviewed for India, US and EU recipients.**

## Known limits
- Segment sizes shown in the GTM OS count all history; this app only messages activity from the last 90 days, so real volume is lower.
- Outcome rates look low for the first two weeks (windows are still open in both groups). The GTM OS ignores comparisons under 30 delivered / 10 holdout.
- Nothing here has been run against your live database or Resend: it was verified against a mock of your schema (real Postgres 16) and a fake Supabase client.

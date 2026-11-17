# Judgment record: Delete (with Undo) and Share on each row (Nov 2026)

Apply AFTER the round-4 landing zip: components/ChatIntake.tsx in this zip contains the round-4 changes plus this
one-line pass-through, so it must replace the round-4 copy (not the original). No SQL, no env var, no new event.

Changed: components/JudgmentRecordStrip.tsx, components/ChatIntake.tsx, app/NaturalIntakeClient.tsx
New:     tests/judgment-record-delete.test.ts, docs/CHANGELOG_judgment_record_delete.md

## What it does
- Each row of the judgment record on the new landing screen now has two small icons on the right, as on the classic home
  page: Share (the same ShareRecordButton) and a trash icon. Neither opens the record; tapping the row still does.
- Delete is one tap, then Undo. The row turns into a dashed "Decision deleted.  [Undo]" line in the same spot. Undo within
  6 seconds (UNDO_WINDOW_MS in JudgmentRecordStrip.tsx) puts it back. After that it is really deleted: out of the list
  (the hero open/logged counts follow), out of this device's stored ids, and DELETE /api/record on the server
  (same route as the classic page; it still checks ownership).
- Leaving the page while an Undo is showing counts as "yes, delete": pending ones are committed at once (the request uses
  keepalive so it survives the navigation).
- Works for every decision, including ones with a logged outcome, as on the classic page.
- The "All / Open / Logged" counts ignore a row that is being deleted straight away.

## Known, same as the classic page
- The "N decisions" figure that comes from the Mirror status (signed-in users) is fetched once on load, so it catches up on
  the next load; the open/logged counts and the list update at once.
- No analytics event for delete (the classic page had none).

## Check by eye
- Phone width 375: the two icons fit beside the decision text without squeezing it.
- Tap trash: the Undo line appears in the same place with no jump; Undo restores the row; waiting 6 seconds removes it.
- Delete the only decision: the strip stays with its Undo line for 6 seconds, then disappears.

## Roll back
Restore the three changed files from the previous deploy and delete the two new ones.

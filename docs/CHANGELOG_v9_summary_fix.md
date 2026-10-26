# Quorum — Natural Intake v9, summary-screen fix (from a real summary screen you pasted)

Deploy on top of the gaps zip. No migration, env vars, dependencies or new events.

## What was wrong on that screen, and why (each reproduced, then pinned by `tests/intake-summary-regression.test.ts`)
| What you saw | Cause (mine) | Fix |
|---|---|---|
| **"Routes I think you're weighing: [object Object]; [object Object]…"** | Routes are `{label, type}` objects; the summary joined them as strings. My earlier test cast them with `as never`, which hid it | Read labels (`optionLabels`). **Same bug was also silently emptying the evidence text and the framing text** that the materiality rules read, so Quorum's own routes never counted as evidence — fixed too |
| **"Has the idea been tested"** asked of someone with no idea or venture | The "building something of your own" check matched everyday words — "company will be acquired", "product manager", "idea of staying", "business trip", "consult" — so a job-acquisition worry looked like a start-up | Narrowed to genuinely building something of your own ("something of my own", "start a business/company/startup", "freelance", "self-employed"…). 6 of the 11 new tests fail on the old code, pass now |
| **"The main unknown, as I read it: runway"** | The model returned a bare slot name; I printed it | Only a real sentence (≥ 3 words) is shown as the main unknown; the slot is already listed under "Still open" |
| **The refined decision shown twice** | The summary repeated it under "My reading" | Removed from "My reading" |
| **"Who's involved: You"** | A one-person list of the user | Hidden unless someone other than you is named |
| **"A few things are still open"** while one item was listed | Fixed wording | Count-aware: "One thing is still open…" / "A few things…"; same for gaps |
| *(not visible, same family)* **Money runway treated the wrong way round** | "Look for another job" was classed as *still employed*; as the answer to "if you left" it means searching with no income | Now counts as income at risk, so runway is asked; "Another job lined up" still lets runway wait |

## Other things I noticed in that paste and did NOT change
* **"…role redundancy is a possibility, they are saying (& rightly so) that the merger is in very nascent stage and right now…"** — stored answers are clipped at 160 characters by design (`decision_state` is unencrypted), so a long answer shows cut off mid-sentence. The full text is in the transcript and reaches the Council. A smarter clip (sentence boundary) or a short model summary would be nicer; say if you want it.
* **Lean choices are truncated** ("Negotiate role clarity or protections with current…") by the existing label shortener; the full text is only in the tooltip, which phones don't show.
* **"What you chose" lists model-written options you tapped** (e.g. "Fear role will be redundant after acquisition"). That is correct provenance — you chose it — but the wording is Quorum's.
* "A possible tension" and the readiness line read well; no change.

## Verified
`tsc` clean on changed files (apart from my stand-in React types); 254 scripted intake tests pass (13 new). The new regression file was also run against the *previous* code: 6 failures there, 0 now. Not run in a browser or with the live model.

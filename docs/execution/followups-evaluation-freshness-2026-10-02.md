# Followups evaluation evidence

## Contract and ownership

Followups discovery → understand suggestion → inspect evaluation → open Gmail or
mark resolved → revisit. Root owns the existing read projection/types, web row,
clock hook, tests and synthetic story. No dependencies, new schema, worker changes,
provider fetches, billing or onboarding behavior. Relates to D84, D85, D90 and D245.

## Useful data and repair

The existing worker writes `followup_tracker.lastCheckAt` when evaluating indexed
sent/reply metadata. Expose it as `lastEvaluatedAt`; it is not a fresh Gmail read,
mailbox synchronization timestamp or proof a recipient has not replied. Each row
has a closed Evaluation disclosure: a known observation is dated and relative;
missing/invalid/future evidence says unavailable. New replies may still be syncing.
The web field is optional during rolling API deployment; old responses stay unknown.
Counts explicitly cover shown conversations, capped at 100, rather than the mailbox.
No new mailbox fields or analytics properties are collected.

Independent review caught the mount-only clock making a newer valid observation
appear unavailable. The existing hydration-safe hook now optionally refreshes on
an observation key and every minute; this row uses both. Existing callers retain
one post-mount update. The regression covers ages changing while mounted and a new
observation arriving between ticks on the same row.

## Verification and limits

27 PGlite read-service tests pass, including persisted evaluation provenance and
cross-mailbox isolation. 23 web screen/mutation tests pass, including unknown/future
states and the clock regression. Full typecheck and lint pass (six existing warnings).
Independent review cleared the timestamp and clock fixes with no remaining findings.
The API response remains the existing D202 envelope; there is no separately generated
OpenAPI schema in this repository for this interface.

Synthetic Storybook served from this checkout on port 6018. Desktop and 390×844
rendered known/null observation rows, closed and expanded disclosures; text and
controls wrapped without clipping. The observed relative label advanced 5m→6m
without reload. The unknown row said unavailable; browser error log was empty.
No real recipient was contacted or mailbox changed.

Local full API/browser testing remains blocked by the unavailable Docker database;
required CI/build/browser gates must pass before queueing. This is component and
isolated service evidence, not production freshness proof. Rollback: revert this PR.

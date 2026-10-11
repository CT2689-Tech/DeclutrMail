# First-sync speed, August through late September 2026

Checked 2026-10-11 against the initial-sync fetch path on this branch.
No Gmail calls were made for this note. Measurements below are the ones
already recorded in `#769` and in `apps/api/src/gmail/gmail-client.service.ts`.
`INITIAL_SYNC_BATCH_FETCH` is not implemented.

## What the August path fetched

The first-sync worker has listed message ids and then fetched each message
as metadata since `#17` (`d5639252`, 2026-05-22). It did not skip metadata.

As of 1 August 2026, immediately before `#765`:

- `messages.list` pages of 500 ids (`PAGE_SIZE` in `gmail-client.service.ts`, unchanged since `#17`).
- One `messages.get` per id, `format=metadata`, with the header allowlist.
- Quota charged a flat 5 units per request (`UNITS_PER_CALL = 5`), including `messages.get`.
- Fetch concurrency 20 (`FETCH_CONCURRENCY` in `packages/workers/src/initial-sync.worker.ts`, set in `#17`).

The metadata projection stores the sender, subject, snippet, labels, and
Gmail's size estimate when Gmail sends `sizeEstimate`. `#178` (`3ae8e8ab`,
2026-06-09) is the commit that introduced the current `metadataHeaders`
list (`From`, `Subject`, `To`, `Cc`, `List-Unsubscribe`,
`List-Unsubscribe-Post`). Bodies, attachments, and raw MIME are not
requested. That was already true in May.

`#471` (`c5d84b3c`, 2026-08-06) skips a single message Gmail cannot render
(`400 FAILED_PRECONDITION`) instead of failing the chunk. The in-code note
names a mailbox that was 7,519 of 84,138 messages through when one
unreadable message aborted the job. That change stops a stall. It does
not reduce quota.

## Root cause of the late-September slowdown

`#765` (`69175e17`, 2026-09-24) replaced the flat 5-unit charge with a
method table and priced `messages.get` at 20 units. The production budget
stayed on `gmail.googleapis.com/default` (15,000 units/user/minute, deploy
budget 12,000). On that metric `messages.get` costs 5 units. The 20-unit
price belongs to `gmail.googleapis.com/total_query_cost`, which is
unlimited on this grandfathered project.

`#769` (`b8eb9567`, 2026-09-26) records the effect: first syncs ran at
600 reads/minute instead of 2,400, and a 40,898-message sync took 68
minutes. Cloud Monitoring on 2026-09-25 (UTC), cited in
`gmail-client.service.ts`: 6,000 `GetMessage` calls in 10 minutes drew
30,000 units on `default` and 120,000 on `total_query_cost`. Service Usage
reported the per-user limits as 15,000 and unlimited.

`#769` prices `messages.get` from `GMAIL_QUOTA_METRIC`. The worker deploy
manifest sets `GMAIL_QUOTA_METRIC=gmail.googleapis.com/default` and
`GMAIL_QUOTA_UNITS_PER_MIN=12000`, so production is back on 5 units per
read. An unset metric still uses the newer 20-unit price, which is the
safe default for a project created on or after 2026-05-01 (6,000
units/user/minute on `total_query_cost`). `resolveGmailQuotaConfig` clamps
the budget to 1,200–12,000 and defaults an unset budget to 4,800.

`git log -S total_query_cost` on `gmail-client.service.ts` returns only
`#769`. The August path was not a list-only scan, and it was not changed
into a per-message get in September. The September change was the unit
price.

## Options

HTTP batch of `messages.get` (up to 100 sub-requests) does not reduce
quota units. Each sub-request still costs 5 units on `default` or 20 on
`total_query_cost`. It also adds a parser and a partial-failure path on
the fetch that `#471` just made safe. Not a quota win.

A `fields=` mask on the metadata get does not change the method price.
The allowlist already drops bodies. Shrinking the response would not
raise the 2,400 reads/minute ceiling.

Newest-first ordering could show Senders before the oldest mail is
stored. It does not reduce the number of `messages.get` calls, and this
note did not measure it. It is a product change, not a quota fix.

Per-user ceiling on the production metric: 15,000 units/user/minute.
At 5 units per `messages.get`, that is 3,000 gets/minute before other
methods. The deployed budget is 12,000 units/minute, which `#769`
states as 2,400 reads/minute. The Redis limiter and the five-second
burst window exist so a fresh mailbox cannot spend that minute in one
instant. Raising the budget toward 15,000 would spend the headroom the
quota config keeps for `messages.list`, watch, and label calls. This
note does not recommend it.

## Benchmark

This session did not run a new Gmail benchmark. The numbers already on
record, from the `#769` commit message: a live 3-minute smoke at the
production settings completed 7,200 reads at 40/second, all HTTP 200,
zero errors. That is the 2,400 reads/minute pace (40/second) after the
price fix. The mispriced pace in the same commit is 600 reads/minute.

## Decision

There is no safe quota-reducing change to ship. `INITIAL_SYNC_BATCH_FETCH`
is not added. The fetch path in this PR is unchanged.

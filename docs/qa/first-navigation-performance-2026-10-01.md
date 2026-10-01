# First navigation: production diagnosis and current-mail index

Integration owner: this Codex session, `codex/current-mail-query-performance`.
Base: `643082e329421219f3e7645ee96bcae69e64c64a` (merged web PR #839).
Owned files: migration 0081 and rollback, its Drizzle schema declaration,
Atlas checksum, the current-mail service-query regression and this report.
No dependency on open PR #836 (readiness diagnostics); no shared-file overlap.
No production schema write has been performed. Merge automatically triggers
`migration-apply.yml`, so this candidate requires explicit production-migration
approval under CLAUDE.md §2.0 before queueing.

## What the user experiences

Before: first navigation waits on real API reads; Senders may exceed the
2-second server-hydration deadline, fall back to a browser read and duplicate
work while the original API request continues. Cached navigation can avoid
those reads and feels much faster.

Candidate: the same list/count/summary queries can use an index containing
only current inbound mail. Cleared mail need not be heap-read and filtered for
each sender. This does not change the server deadline or cancel duplicate
requests; it addresses the confirmed expensive read seam. Production page
improvement remains unverified until the migration is applied and measured.

## Production observations

Read-only authenticated navigation and Cloud Run logs, October 1, approximately
14:20–14:40 UTC. API revision `declutrmail-api-00426-soh`; the web #839 production
deployment is ready and aliased to `app.declutrmail.com`. These are API request
durations, not browser navigation/FCP/LCP timings. Small samples and a capped
400-record window are diagnostic evidence, not production SLO percentiles.
Raw mailbox/log material is kept outside the repository.

| Request               | 2xx samples | Median ms | Maximum ms | Production after            |
| --------------------- | ----------: | --------: | ---------: | --------------------------- |
| Senders list          |           8 |   5,198.6 |   16,389.7 | Pending index rollout       |
| Senders summary       |           5 |   4,960.0 |   12,127.8 | Pending index rollout       |
| Activity              |           9 |   1,008.8 |    1,690.0 | No change in this candidate |
| Screener queue        |           3 |   1,617.7 |    2,610.4 | No change in this candidate |
| Authentication (`me`) |           6 |     382.2 |      957.9 | No change in this candidate |
| Settings              |           5 |     326.4 |      337.1 | No change in this candidate |
| Triage bootstrap      |           5 |   8,298.7 |   19,693.5 | Further diagnosis required  |

Vercel's Senders server-hydration log recorded the 2,000ms fallback at
14:34:29 UTC (actual prefetch 2,005ms). Activity prefetch took 1,438ms at
14:35:59 UTC. These substantiate primary API waits after the web changes.
The earlier [17-screen sweep](screen-load-performance-2026-09-30.md) uses warm
assets and synthetic responses; its sub-200ms results do not establish real
account or first-visit production timing. Local cold route entries also showed
approximately 317–320ms versus 15ms cached entries; cold assets and loading
boundaries remain a separate frontend concern.

## Confirmed query seam and rejected alternative

Current source `hasCurrentMail()` is used by list rows, matching counts,
mailbox-wide filter counts, and summary cleanup-active counts. The deployed
filter-count statement appears in `pg_stat_statements` with a cumulative
3,560.72ms mean (190 calls); cumulative statistics are not the sampled
navigation distribution. Its normalized SQL matches the current source.

A bounded, read-only `EXPLAIN ANALYZE` of the current-mail count seam on the
largest sender mailbox measured 4,885.266ms execution, 8,025 per-sender message
index probes, 50,374 message shared-buffer hits and no disk reads. It used
`mail_messages_account_sender_date_idx` and filtered labels in the heap. The
actual service count includes additional policy joins/axes; the seam is not
the complete endpoint. A materialized, distinct current-mail sender scan hit
its 5-second statement timeout and was rejected. No production settings,
planner switches, indexes, statistics or data were changed for these probes.

## Local before/after

The new regression invokes actual `SendersReadService` list, metadata and
summary methods, then explains all four captured current-mail statements.
It seeds 500 synthetic senders and 40,000 messages, mostly Trash, with 50
senders retaining one archived inbound message. Each statement has three
EXPLAIN runs; time is SQL engine execution. This selective cleared-mail
fixture is intentionally different from the populated production mailbox.
No endpoint/network/auth/browser improvement is inferred from these numbers.

| Actual service SQL | Before median / max ms | After median / max ms |
| ------------------ | ---------------------: | --------------------: |
| List rows          |        20.901 / 22.082 |       14.873 / 16.262 |
| Matching count     |          7.509 / 8.054 |         0.300 / 0.333 |
| Filter-axis counts |          7.408 / 7.648 |         0.375 / 0.391 |
| Summary            |        19.252 / 19.543 |       13.279 / 13.555 |

Before adding the migration, all four index-use assertions failed after the
same semantic assertions passed (negative control). Afterward, all passed.
Existing service tests additionally cover Trash, Spam, drafts, chats, outbound
and absent messages, mailbox isolation, Undo, new arrivals and historical
record preservation.

A disposable native Supabase PostgreSQL 17.6 database replayed the full Atlas
history, linted 0081, dropped the index using its concurrent rollback and
recreated it with the forward SQL. On the same synthetic fixture, one native
count-seam run fell from 9.181ms / 975 shared hits to 0.597ms / 60 shared hits.
This confirms native execution and rollback, not a production percentile.

## Rollout and limits

Migration 0081 adds a B-tree on `(mailbox_account_id, sender_key)` with the
exact `hasCurrentMail()` predicate: inbound and no Trash/Spam/Draft/Chat label.
Archived inbound mail remains included. No stored columns, retained data,
wire contracts, authentication, mailbox authorization or action preview changes.
No write is deferred; current-mail truth still comes from the live message
table, so no stale materialized state is introduced for destructive readers.

`CREATE INDEX CONCURRENTLY` runs outside a transaction. A failed build may
leave an invalid index; use the concurrent rollback before retrying. It adds
storage and maintenance on message insertion and label changes; existing
Inbox/non-mail partial indexes already depend on labels. Index-only behavior
depends on visibility-map freshness. No existing index is removed.

After approval and successful apply, verify index validity, repeat the same
count/service-read plans and authenticated first/repeat navigations, and
record endpoint and browser timings separately. Activity, Screener, Triage,
icons and the cross-region auth/database floor remain open work. This change
does not establish a 200ms production page-load guarantee.

Local validation: workspace typecheck; lint (zero errors, seven pre-existing
warnings); 110 database tests; 278 affected API tests plus eleven existing skips; Atlas
validate, dry-run, full native apply, lint and concurrent rollback/reapply.
Independent gate review and final-head CI are recorded in the PR.

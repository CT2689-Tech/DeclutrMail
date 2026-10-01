# Exact Inbox count consolidation — 2026-10-01

## Problem, scope and ownership

Senders list and detail independently count the same inbound all-time Inbox set, then scan its unread subset again. Bounded production plans show both scans on each of 51 returned rows: the full Inbox scan uses the existing covering Inbox partial index, while the separate unread scan chooses the older unread index and filters heap records.

Root integration owner. Isolated codex/sender-inbox-count-performance based on main 889e4f5c. Owns Senders read service/read spec/current-mail plan spec and this report. Independent of #847 controller timing and #836 readiness diagnostics; no shared public contract, new index, migration, auth, cache, worker or action-execution changes.

Combine exact Inbox total and exact unread count in one JSON aggregate over the original mailbox/sender/inbound/INBOX predicate. is_unread is already a key of migration 0070's partial Inbox index. Keep this all-time aggregate separate from rolling windows. List and detail continue returning their original numeric fields through ensureSafeIntegerNumber. Empty sets are exact zero. Do not add Trash/Spam exclusions to this Inbox predicate; it must match action/protection facts even for dual labels.

## Negative control and local checks

The actual list/detail integration test covers read+unread, old 2010 Inbox mail outside rolling windows, outbound self-send exclusion, archived unread exclusion, another mailbox with the same sender key, zero counts and dual INBOX/TRASH membership. Baseline returns all original exact counts correctly, then fails the one-positive-Inbox-scan assertion (two actual SQL predicates). Candidate passes.

Root candidate-local DB aliases preserve the candidate migrations rather than resolving the older shared dependency checkout. Read+current-mail plan suites: 79 passed / 10 existing optional skips. The plan fixture now includes 50 Inbox senders,25 unread and25 read; exact output counts and current-mail indexes still pass. The row plan uses the Inbox partial index and excludes the removed legacy unread-index scan. API typecheck, changed lint, formatting and diff pass.

## Bounded production query-plan observations

Read-only transactions, local 5s statement limit, actual current parameterized Senders row SQL; mailbox identifiers and returned mailbox records are not published. Original full row query: 4331.963 ms with 127 shared reads; immediate repeat 429.042 ms with zero reads. Another original repeat 1366.342 ms, zero reads. Proposed combined projection: 929.782 ms and 31.128 ms, both zero reads. These variable small diagnostic samples do NOT establish a reliable latency percentage or 200 ms SLO.

Original warmed full-query plans used 12418/12506 shared buffer hits; combined used 8397/8395. The removed unread scan accounted for about 4100 hits. The generated candidate parameterized SQL, with the same inputs, matches the probed combined SQL after ignoring formatting whitespace. Combined plans retain the current-mail and Inbox indexes, exact LIMIT 51 and the existing remaining projections. Unrelated source data, resource load and cache state can vary between probes. track_io_timing is off and was not changed; do not attribute elapsed-time variation solely to disk.

A separate exact default metadata plan still took 417.379 ms at the database with zero reads. Removing this row-level duplication does not solve mailbox-wide metadata, summary, transport or the universal 200 ms goal.

Independent required privacy/architecture review, exact-head CI/queue and authenticated production-after verification are pending at preparation.

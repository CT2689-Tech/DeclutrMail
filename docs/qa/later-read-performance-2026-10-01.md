# Later read performance — October 1, 2026

Integration owner: this Codex session, `codex/later-read-performance`.
Base: main `63584c60d242b10585c3fcb10d4af5d197597ed9`.
Owned runtime: `apps/api/src/senders/snoozed.read-service.ts`.
Independent of the Activity dialog hydration fix and readiness diagnostics.
No schema, auth, entitlement, worker, wake, reschedule or recovery changes.

## Production reproduction

The authenticated production sweep recorded two completed `/api/snoozed`
application reads at 6,505.80ms and 8,611.99ms on API revision
`declutrmail-api-00429-koz`. The browser eventually displayed “Nothing in
Later.” A subsequent read-only database probe confirmed zero Later timers
on the largest sender mailbox. These are two diagnostic observations, not
an equal-window before/after distribution or an SLO measurement.

The original list resolved the worker's Redis label mapping and grouped
all mailbox messages carrying that label **before** reading timer rows.
D245 already makes timers the sole source of list membership, so an empty
timer set discarded the entire mirror result after paying for it. Populated
lists also counted mirror-only senders that could never appear in the list.

## Change

Read the same timer projection first. With no timers, return the existing
empty result without resolving labels or reading message rows. Otherwise
read the mapping and restrict the unchanged label-count query to those
timer sender keys, still scoped to the mailbox. Identity projection,
sort order, timestamps, status derivation and response fields are unchanged.

Label membership still counts matching Trash and outbound messages; this
does not substitute the current-mail or Inbox predicate. A missing,
failed or timed-out mapping still produces `laterCount: null`. A valid
mapping with no matching messages still produces zero. Orphan timer keys
still cannot invent sender identity. Wake/recovery requests retain their
own authoritative reads and validation.

## Negative controls and loop measurement

Both new regressions failed against the original service: the mapping was
called despite an empty timer set, and the mirror query lacked the timer
sender bound. The populated regression first verifies the complete returned
count and mailbox isolation, including matching Trash and SENT labels.

The optional `LATER_READ_BENCH=1` benchmark consumes the complete empty
service result against PGlite with exactly 100ms of asynchronous latency
added to each actual driver call. Both revisions use the same fixture.

| Empty Later service read | Samples ms             | Median ms | Maximum ms |
| ------------------------ | ---------------------- | --------- | ---------- |
| Original                 | 209.62, 211.68, 207.55 | 209.62    | 211.68     |
| Candidate                | 101.95, 102.87, 102.90 | 102.87    | 102.90     |

This measures removal of a database round trip with synthetic transport
latency. It is not a production endpoint/browser result. It also does not
model the much larger original production label scan. Populated-list
performance depends on the size of the timer sender set and message history.

## Validation

- Full Snoozed service/controller suite: 24 tests passed with the optional
  benchmark enabled, including existing recovery and wake/reschedule cases.
- API typecheck, changed-file ESLint, Prettier and diff checks pass.
- Independent privacy and architecture review passed, with 123 tests passed
  and one optional benchmark skipped across the affected controller, entitlement
  and adversarial suites; see the accompanying independent review. Exact-head
  CI remains separate evidence.
- The production browser reproduction is read-only list navigation; no
  mailbox action, return, reschedule or billing change was performed.
- Deployment and post-release production timing must be verified before
  claiming the production delay has been reduced.

## CI integration correction

The initial PR CI run (36887413383) passed API tests but failed the billing browser journey because its sender-row test ID matched both responsive representations. The billing locator now requires the visible row and retains strict matching, the preview, paywall, signed sandbox webhook and entitlement assertions. No billing runtime behavior changed. This is an integration correction owned by this PR.

# Sentry query diagnosis and observability follow-through

Related decision: D159. Implementation and integration owner: root.

## Repair scope

The private encrypted Sentry report discarded the existing `reason` tag from
query failures. The two current handled browser failures had `surface=query`
and source-mapped stacks through `getInFlightActions` and `fetchLaterRecovery`,
but their query scopes disappeared from the report. Identifying a query should
not require a usable stack in every event.

Owned files: `scripts/sentry-private-triage.mjs`, its test, and this record.
Dependencies: merged source-map/capture-context work in #861 and #864's baseline.
No overlap with open readiness diagnostics PR #836. There are no browser/API,
schema, mailbox, consent, retention, billing or alert-channel changes.

Preserve only the source-verified `undo` and `snoozed` reason values, and only
when the event also carries `surface=query`. Tag order is irrelevant. Arbitrary
tokens, mailbox IDs, full query keys, filter text and addresses remain excluded.
Existing unambiguous React error codes retain their previous behavior. Other query scopes
remain omitted pending an explicit source-verified allowlist addition.

## Verification

- Negative control: the added regression fails on the shipped projection because
  `undo` becomes undefined. After correction, all ten private-triage tests pass.
- Regression covers both vendor tag orders, unknown scopes, mailbox-like values,
  full query keys and known reasons on non-query/missing surfaces. Existing tests
  retain encrypted round-trip/authentication, excluded content, bounded GET-only
  collection and source-path scrubbing coverage.
- The reviewer reproduced conflicting duplicate surfaces that could misattribute
  a query reason. A second negative control failed before the repair. Conflicting
  surface/reason values now fail closed, including unknown-value conflicts;
  identical duplicates remain valid. Malformed tag records are ignored instead
  of aborting the report.
- Full repository typecheck and lint pass (six existing unused-disable warnings).
  Changed-file formatting and whitespace checks pass.
- Independent reviewer reran all ten tests and cleared the duplicate-tag blocker
  after the correction; no remaining source or privacy blockers.
- Independent review and required repository checks are recorded in the PR.

This fixes diagnostic evidence loss. It does **not** establish the cause of the
two production `fetch()` rejections or claim those product failures are fixed.
The sanitized events prove original TypeScript source mapping for those two
events on release `d09db33c3a27aa3bfd8a1c8f128f8b4a0ad6e617`, not every historical
event. The newest main baseline #864 passed push CI and CodeQL on exact commit
`0f4876b4478af53550b751930c45cea738a0d632`.

## Action collector performance

On production Supabase, compiled the two actual Drizzle queries in
`apps/api/src/ops/action-outcomes.ts` with fixed 2026-10-03 06:49:18 UTC timestamps.
Inspected plans before bounded `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` in a
read-only transaction, statement timeout 3 seconds and lock timeout 500 ms.
No customer identifiers or row contents were selected.

- 24-hour outcomes: existing account/status/created index for roots, primary-key
  and root/recovery index bitmap combination for each lineage. Four roots,
  two aggregate rows, execution 0.391 ms; planning 1.424 ms.
- Pending: existing account/status/created index, zero pending aggregate rows,
  execution 0.152 ms; planning 0.765 ms.
- Neither query spilled to temporary storage or read uncached blocks. These are
  individual warm-cache measurements on a small workload, not a load benchmark.
  No new production index or migration is justified by this evidence. Recheck
  with workload growth; the existing index's leading mailbox column means these
  global reads should not be assumed to stay equally cheap at scale.

## Remaining external verification

Latest cost-availability observations, 2026-10-02 18:08:50 UTC: four measured
sources (GitHub Actions, GCP project charges, Upstash Redis, Vercel) and seven
unavailable sources. Supabase collects size/connections; Sentry collects error
quota/loss; PostHog collects quota/event usage; GCP budgets report budget state.
These collectors do not supply invoiced cost. Paddle and Razorpay observations
cover webhook health, not expense. Anthropic's cost API needs a usable Admin API
configuration; no zero spend is inferred from its unavailable observation.

Both existing email notification channels are enabled; one is marked VERIFIED
by Monitoring and the other has unspecified verification status. Neither status
proves delivery. The isolated alert rehearsal remains pending an explicitly
authorized recipient matching an existing channel and an actual inbox receipt.
Follow `docs/ops/observability-alerts.md`; create no parallel channels and clean up
the exact temporary metric/policy even if receipt cannot be confirmed.

Rucha's existing account login is being moved to Codex's browser at the user's
request, following repeated unreliable Chrome captures and a user-control
interruption. Production journey completion, PostHog authenticated dashboard
usability, rescore completion and scheduled Later return remain separate checks.
Cleanup already displays per-window counts; Activity already has queued/failed
states and a weekly outcomes strip. Do not duplicate these as new features.

Rollback: revert the two-value private projection addition. Product operation is
independent of this optional triage tool; rollback removes query labels from the
report without changing Sentry capture or retention.

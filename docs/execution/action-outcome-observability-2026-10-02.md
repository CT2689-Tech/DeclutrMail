# Cleanup and Undo outcome observability

## Scope and ownership

Root owns the aggregate action queries, optional operational collector, shared
runtime metric definitions, dashboard panels, tests and this record. There are no
dependencies on other open PRs. No schema, Gmail operation, recovery policy,
browser consent, billing or onboarding behavior changes.

## What the observations mean

Every five minutes, successful database reads emit aggregate observations for
Archive, Later and Delete label actions and their reverse/Undo actions separately.
The rolling 24-hour acceptance cohort counts one durable root job, selecting its
latest recovery attempt. A bulk UI click may create several roots. Recovery does
not inflate accepted-operation counts.

The collector separates queued, executing, completed, failed and protected states.
Confirmed message counts come only from persisted completed worker results;
completed zero-message no-ops remain explicit. Requested minus affected messages
does not establish partial completion. A failed operation may have changed Gmail
partially, so its completion is unconfirmed, not necessarily zero provider effect.
Unsubscribe and policy-only Undo are outside this label-action cohort.

Terminal p50/p95 measures root acceptance through the latest terminal update,
including queue and recovery time. All-age pending panels count current unresolved
attempts, including those accepted before the 24-hour window. Their oldest age and
30-minute overdue threshold start at the current attempt, not the original root.
This makes current retry age distinct from total root-to-terminal time.

Failure reasons use six closed categories. No mailbox/user/sender/job IDs,
selectors, provider text, tokens, recipients, subjects or bodies enter these logs.
Known empty reads produce zero counts. Unavailable reads produce a failed
collection heartbeat and no fabricated outcome records. Missing age/latency is
unknown. Existing database statement and outer collection deadlines apply.

## Dashboard and rollout

Eight panels show outcomes, confirmed messages, terminal p50/p95, all-age pending,
overdue, oldest pending attempt age and failure categories. Log distributions use
ALIGN_SUM per original series, then REDUCE_MEAN with full resource, log and cohort
identity preserved to extract numeric means. A secondary ALIGN_MEAN/REDUCE_MAX
combines numeric means across resource/revision series. Applying ALIGN_MEAN directly
to DELTA/DISTRIBUTION metrics is rejected by Google Cloud. This keeps counts and
SQL percentiles from being re-estimated from histogram buckets. Points represent
five-minute snapshot means, with the maximum across
resource/revision series; they are never additive event totals. The explanatory
text stays beside these panels, and collection freshness includes the new actions
source. Runtime absence alerts must pass the existing freshness gate before
activation against this new source.

Database queries are bounded by the existing telemetry deadlines. They have been
tested against actual PostgreSQL-compatible SQL in PGlite, including ordered-set
percentiles. Production-scale EXPLAIN remains outstanding: existing indexes lead
with mailbox identifiers rather than global created_at/status. A timeout is a
visible telemetry failure and must not be described as healthy zero coverage.

## Evidence and limitations

- SQL tests cover recovery deduplication, completed no-ops, protected exclusions,
  queue/execution overdue states, reverse outcomes, old pending attempts, bounded
  unknown failures, ISO-string binds, empty results and failed reads.
- Initial review found the histogram percentile dashboard bug, but missed that
  direct mean alignment also rejects distributions. The authenticated dashboard
  check caught that follow-up failure; descriptor-aware tests and live numeric
  parity now protect the corrected two-stage aggregation. See the
  [repair record](action-dashboard-distribution-repair-2026-10-03.md).
- Optional collection tests retain independent queue readings on database failure.
- The action metrics are provisioned and the eight action charts were repaired
  in the existing production dashboard on 2026-10-03. Seven render observations;
  pending age is absent alongside zero pending counts. This establishes usability
  for these panels, not complete coverage of every vendor or Sentry source maps.
- Rollback is reverting this PR and removing only its new metric/panel definitions;
  no production schema rollback or mailbox mutation is involved.

Related decision: D159. Integration owner: root.

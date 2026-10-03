# Action dashboard distribution repair

Related decision: D159. Integration and implementation owner: root.

## Scope

The eight Cleanup/Undo action panels added with #856 were blank in the
authenticated production dashboard. The exact built query returned HTTP 400:
`ALIGN_MEAN` cannot align `DELTA/DISTRIBUTION` metrics. Metric ingestion was healthy;
the existing chart-shape test asserted the unsupported aligner.

Owned files: `scripts/setup-infra-dashboard.mjs`, `scripts/infra-alerts.test.mjs`,
the action observability execution records and this incident's mistake entry.
Dependency: merged #856 and its deployed action collector. No overlap with open
readiness PR #836. No runtime, schema, account, consent or mailbox changes.

## Correction

Merge distribution observations with `ALIGN_SUM` within each five-minute original
series. Extract its exact mean using `REDUCE_MEAN`, grouping by every Cloud Run
resource label, the automatic log label and the declared bounded cohort labels.
Then apply numeric `ALIGN_MEAN` and `REDUCE_MAX` in secondary aggregation, grouped
only by the cohort. Unequal sample counts retain weighted means, while separate
revisions retain the existing maximum semantics. Histogram percentile estimates
do not replace operation counts or SQL-computed percentiles.

Authoritative contracts:
[Aggregation](https://cloud.google.com/monitoring/api/ref_v3/rest/v3/projects.alertPolicies#Aggregation)
and [TimeSeriesFilter](https://cloud.google.com/monitoring/api/ref_v1/rest/v1/projects.dashboards#TimeSeriesFilter).

## Verification

- The new descriptor compatibility test failed on the shipped source before the
  fix (`mean aligner requires numeric input`, actual type `DISTRIBUTION`).
- Combined infrastructure suites: 17/17 passed. Separate final reviewer rerun:
  12/12 alert tests passed. Weighted arithmetic fixture covers unequal counts,
  revision separation, explicit zero and absent observations; it is not a GCP
  emulator and currently uses a single time bin.
- All eight exact candidate queries returned HTTP 200. Independent reviewer
  compared 672 live aggregate points with raw distributions: zero numeric error,
  48 positive and 624 zero points, no missing or extra cohorts. Current live data
  has one resource identity and one observation in each populated time bin;
  weighted/multiple-revision cases are covered by the explicit fixture.
- `pnpm typecheck` passed. `pnpm lint` passed with six pre-existing unused-disable
  warnings. Formatting and `git diff --check` passed.
- At 06:05 UTC, patched only the eight matching action widgets in the exact
  existing dashboard, retaining its etag. Protected local before/after backups
  contain the private full dashboard. Readback confirmed all 52 other widgets
  unchanged and 60 total widgets; the API adds the documented default Y1 axis.
- After reload in the authenticated admin browser session, the exact shared URL
  rendered operation values 0–2, confirmed messages 0–3, terminal p50
  0.928–1.570 seconds and p95 0.963–1.621 seconds. Pending, overdue and failure
  series rendered zero. Pending age reports no data, consistent with zero pending;
  absent age is not converted to zero. Latest candidate API points were 05:57 UTC
  before the dashboard check. Browser range was 05:05–06:05 UTC. The inaccessible
  default chart table is initially lazy, not evidence of missing metric data.
- Independent source review cleared the correction before the live patch.

Shared dashboard:
[DeclutrMail infrastructure, cost and recovery](https://console.cloud.google.com/monitoring/dashboards/builder/6b21d7d4-d294-4df9-badd-ef62f5d7f279?project=declutrmail-ai-prod).
Browser screenshot evidence is held in the task artifact, without invoice details.

## State and limits

The dashboard configuration is applied and these action panels are browser
verified. Source PR merge/queue status must be checked separately. This repair
does not establish complete vendor cost coverage, alert delivery, current Sentry
source-map upload, or full production journey verification. No synthetic production
errors or mailbox actions were generated to produce telemetry.

Rollback: restore only these eight widget definitions from the protected backup
using the dashboard's current etag. Reverting source alone does not undo a manually
applied dashboard configuration. Restoring the old definitions reintroduces the
known chart error; it is a recovery mechanism, not a recommended steady state.

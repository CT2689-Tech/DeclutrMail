# Observability foundation audit — 2026-10-02

## Release truth

At audit time, PRs [851](https://github.com/CT2689-Tech/DeclutrMail/pull/851)
and [852](https://github.com/CT2689-Tech/DeclutrMail/pull/852) were OPEN and
unmerged. Both passed CI; 852's implementation-log check passed after retrying a
GitHub API HTTP 502. Preview deployment is not a production release.
Cloud Run API revision `declutrmail-api-00456-nef` reported Sentry release
`05beae88d723475afec168fdbad386e7a0ea60f0`, the base of this independent branch.
The code fixes below require merge, deployment and a subsequent live verification.

## Fixed in code

- Web Node/edge Sentry previously used a key denylist that retained arbitrary
  exception messages/contexts. Both now share the strict event and breadcrumb
  projection, disable unused transaction/log/metric channels, and disable default
  integrations explicitly. `integrations: []` did not disable SDK defaults.
- Explicit Next request-error capture remains wired. SDK initialization, loading
  and capture errors fail open with closed diagnostics containing no SDK details.
- API initialization handles SDK rejection, shares concurrent initialization,
  bounds waiting, clears timers, and reports readiness. Worker observers use a
  nonblocking SDK lookup, including recovery after a late initialization.
- Server frame identity admits static Next route groups and parameter templates
  while dropping queries, source context and private values. The encrypted
  diagnostic report also recognizes the application's canonical `app:///` paths;
  its previous path filter incorrectly discarded them.

These changes do not enable replay, widen analytics consent, or add mailbox
content to telemetry. Existing tracing is not proof of complete request/job
coverage: web server tracing is disabled; API integration coverage is limited.

## PostHog — live changes and evidence

[Production navigation](https://us.posthog.com/project/456795/insights/pw7aWizN)
uses automatic `$pageview`, restricted to `app.declutrmail.com`, with daily event
and distinct observed-person counts. It is a fixed rolling 30-day UTC query,
explicitly independent of dashboard date controls. It includes consented QA;
these counts must not be presented as customer/account totals. The authenticated
browser rendered its two series; Oct 2 had 70 pageviews and one observed person
at inspection. Latest production pageview was 07:38 UTC, not the chart refresh time.

Corrected eight existing chart titles/descriptions without rewriting history:

| Insight    | Correct meaning                                                   |
| ---------- | ----------------------------------------------------------------- |
| `sUtnLtan` | Observed sessions and all tracked events, not visits/bounce       |
| `WLVafjal` | Distinct activity days across selected period, default 30 days    |
| `wdjlX4bf` | Weekly independent-population triage acceptance / visitor ratio   |
| `ggcaZcql` | Return to accepted triage actions, not completed Gmail cleanup    |
| `6bBQntjg` | Retention on partial custom-page coverage, no universal threshold |
| `DnW5H0kn` | Explicitly instrumented surfaces; Home coverage is absent         |
| `nHSD7F6r` | Event volume including telemetry, not feature adoption            |
| `xjXN5bV0` | First observation, not signup                                     |

Browser consent remains required. Rucha's Essential-only account must not be
made to emit PostHog events for testing. The connector cannot read the governed
metric catalog (`data_catalog:read` missing), so these are saved insights,
not claimed canonical catalog metrics. Billing/onboarding journeys remain separate.

## Google Cloud — live changes and evidence

[Infrastructure, cost and recovery dashboard](https://console.cloud.google.com/monitoring/dashboards/builder/6b21d7d4-d294-4df9-badd-ef62f5d7f279?project=declutrmail-ai-prod)
was opened as `admin@declutrmail.ai`; charts rendered after authentication.
Every existing metric chart query was replayed successfully against the API.
The new snapshot-age panel rendered eleven vendor series and approximately one
hour since the actual 18:08:50 UTC source observation at 19:09 UTC.

Only the explanatory text and one added panel were patched, preserving private
invoice history and other dashboard configuration. The source script matches
those changes. Freshness uses the stored observation value, not aligned chart
bucket timestamps; readings older than three days disappear as unavailable.

- All eight runtime source/queue combinations had four successful observations
  in the preceding 20 minutes; latest approximately 19:02 UTC.
- Twenty existing alert policies were enabled; three uptime checks existed.
  Configuration and fresh readings do not prove notification delivery.
- Empty failure/outcome counters mean no matching events observed; periodic
  gauges and heartbeats require fresh observations. Copy now distinguishes them.
- Sentry collector: 133 accepted errors in its prior 24-hour snapshot, zero
  discarded. PostHog collector: 903 MTD events. These are vendor-wide usage
  readings and do not establish customer activity or per-release error rates.
- Four vendor cost sources were measured (GCP project charges, GitHub Actions,
  Upstash and Vercel); seven were unavailable. Anthropic's administrative cost
  read remains an error. Storage cost had no recent observations. Unknown is
  not zero; these panels are not a complete invoice.

## Sentry live evidence and remaining verification

Existing secure [triage workflow run](https://github.com/CT2689-Tech/DeclutrMail/actions/runs/37050866604)
succeeded using existing GitHub credentials and an encrypted, one-day artifact.
It returned six unresolved issues in the seven-day search, with latest events
from older releases. Issue counts are lifetime counts, not seven-day volume.
No issue was marked resolved. Raw payloads, private report and encryption keys
are not committed.

The private-report filename filter hid canonical paths, so missing filenames in
that report are not evidence that Sentry ingestion or uploaded source maps are
broken. After deployment, rerun the diagnostic on the new release and verify
symbolicated frames and runtime error capture. Full distributed tracing, alert
receipt, and durable action/Undo completion funnels are not established by this
audit. Add completion metrics against authoritative worker outcomes when resuming
those journeys; accepted UI actions must remain separately named. No production
mail mutations, notification tests, billing actions or reconnects were performed.

## Validation and ownership

Main agent owns integration and all edits in this branch; the independent reviewer
performed privacy, architecture, design applicability and failure-recovery review.
Its late-SDK recovery blocker was fixed and re-reviewed with no remaining blockers.
There is no code dependency on PRs 851/852; `worker.ts` is shared with readiness
work, but this change is confined to Sentry initialization and observer wiring.

Validation passed: workspace typecheck; lint (six pre-existing warnings); 26
focused web tests; nine API tests; 723 shared tests; all 258 script
tests (including diagnostic/infra coverage); production web build; all 51 route bundle budgets and 45 prerender checks.
A built Next server started with an unreachable loopback Sentry DSN and served
`/sign-in` successfully. This proves local bootstrap resilience, not live Sentry
event delivery. The existing production monitoring dashboard and the new PostHog
insight were also checked in authenticated Chrome.

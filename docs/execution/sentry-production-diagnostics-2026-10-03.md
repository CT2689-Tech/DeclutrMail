# Production Sentry diagnostic sampling

The encrypted operational collector previously requested each issue's latest
unfiltered event. A development event could hide the production failure that
motivated an audit. Source-backed preview and polling reasons were also discarded.

The collector now filters both issue discovery and full event sampling to production
and seven days. It retains at most one returned event for each of ten issues;
this is a bounded sample, not a claim of exhaustive coverage or latest ordering.
Missing, malformed, conflicting-environment and failed event reads remain explicitly
unavailable. No cross-environment fallback occurs. Issue lifetime counts and lastSeen
are labeled as potentially spanning environments, not current production volumes.

Known preview and polling reasons survive only with their source-verified surface.
Arbitrary reasons, mailbox content and conflicting tags remain withheld. Production
telemetry emission, issue resolution, credentials, scopes and runtime behavior do not
change. The report still uses the existing authenticated encryption envelope and
short-lived encrypted artifact; plaintext stays out of workflow logs and artifacts.

## Contract and integration

Owner and integration owner: this audit session. Owned files: the private Sentry
collector, its regression tests, and this execution record. No unmerged dependency;
base includes the existing encrypted workflow. No shared runtime or workflow edits.
The private JSON projection uses productionEvent, productionEventUnavailable and
productionEventHttpStatus instead of the formerly unfiltered latestEvent fields.
No tracked consumer depends on the previous field names.

Two regression tests failed against the prior collector: production selection and
operation-label preservation. All fifteen collector tests pass with the repair,
including bounded calls, encryption authentication, sensitive-field omission,
HTTP failures, malformed results and ambiguous tags. Browser smoke is inapplicable
because this change is an encrypted read-only operational script. Actual production
collection must be verified after merge before claiming operational success.

A production React hydration error observed during the audit remains unresolved;
this diagnostic repair does not establish its cause or fix the runtime failure.

API contract references:

- https://docs.sentry.io/api/events/list-an-issues-events/
- https://docs.sentry.io/api/events/list-an-organizations-issues/

# Trustworthy telemetry context

## Scope and ownership

Root owns PostHog's wire context, its authenticated identity binding, deployment
environment metadata, the existing intercepted consent browser test, and the
encrypted Sentry read projection. No dependencies on other open PRs. Onboarding
uses the same identity hook and receives the same tier argument; its behavior is
unchanged and its journey remains a separate audit. No billing/provider/schema
behavior changes.

## PostHog comparability

Production Web Vitals previously lacked release, plan and QA context. The older
30-day Senders p75 combined releases and internal testing. A fresh seven-day read
found only seven LCP samples, all before the currently deployed release; that is
not a controlled performance benchmark or proof of a current eight-second bug.

Every existing consented event, including SDK automatic pageview/pageleave,
receives closed wire metadata after privacy scrubbing:

- `telemetry_context_version=1` distinguishes this prospective contract from
  historical records with unavailable context.
- `app_release` is the validated 40-character deployed commit or `unknown`.
- `app_environment` is a recognized Vercel/development/test environment or
  `unknown`. A production Node build without deployment metadata is not inferred
  to be a development deployment.
- `plan_tier` is the current authenticated workspace tier or `unknown`. It updates
  on identity/tier changes and clears on logout and identity-hook unmount. Early
  public events can correctly remain unknown.
- `traffic_class` is `internal_qa` only when that browser explicitly sets
  `localStorage.setItem('dm-analytics-qa', '1')`; otherwise it is `unclassified`.
  Remove the key to leave QA mode. This is self-declared test traffic, not a
  server-verified customer classification. Unclassified must never be called
  customer-only coverage. The marker never grants or changes analytics consent.

Use `$pageview` as the canonical navigation event. `page_viewed` remains the
existing typed surface event, not a second count to add to pageviews. New metrics
must show sample count, last observation, environment/release/traffic class and
plan; keep unknown/historical strata separate. Performance comparisons also need
device and navigation type. Do not backfill unverifiable classifications.

## Sentry diagnostics

The encrypted read report used to omit useful existing diagnostic structure.
It now retains measured stack/in-app frame counts, known SDK names, known exception
mechanisms and nullable handled state, finite surface/method/status tags and React
invariant numbers. Missing stack arrays remain unknown (`null`), distinct from an
explicit empty array. Webpack source paths normalize before the existing strict
source-path validation. Exception messages, arbitrary tags/SDK names, source
context, request data and identities remain omitted.

This improves diagnosis; it does not resolve current generic errors or establish
that browser/edge source maps work. A fresh report and a controlled mapped event
remain necessary. No issue is resolved merely because its newest event belongs to
an old release.

## Verification and rollout

Focused consent/context/identity/Web Vitals tests and encrypted Sentry projection
tests passed. Tests cover invalid metadata, current tier changes, account changes,
unmount/logout, and missing versus empty stack data. The existing intercepted
browser journey now asserts actual automatic and explicit SDK transport metadata;
the Essential-only journey also runs with the QA marker and must remain silent.
All SDK requests are answered locally and reach no live PostHog project.
The first CI trace confirmed both automatic and explicit events carried context;
the assertion failed because the current SDK uses a `{batch: [...]}` transport
envelope. The decoder now reads that envelope in addition to arrays/single events.
Capture context loads lazily with the consented SDK; only bounded plan state stays
synchronous for logout. This avoids putting optional wire enrichment on the
Cookies page’s initial JavaScript path without changing its bundle budget. Public
transport verifies unknown plan; authenticated plan binding has focused unit
coverage rather than a claimed browser-tier proof.

Local browser execution is blocked by Docker and disk constraints. CI browser
gates are required before queueing. After deployment, read back prospective live
event properties before modifying dashboard claims. No source-map usability or
customer-only cohort claim is made by this change. Rollback is reverting this PR;
no migration or provider state is involved. Related decision: D159.

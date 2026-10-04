# Billing mutation failure observability — 2026-10-04

Relates to D159, D7, D228. Scope/integration owner: core-flow audit chat.

## Flow contract and ownership

Unexpected failures from checkout, plan change, cancellation, renewal restoration,
pause, resume, payment-method sessions, payment reconciliation and invoice-document
requests must reach optional Sentry without changing the user-facing failure,
recovery, provider authority or cache behavior. Designed 4xx states and explicit
request cancellation remain quiet. No payment, production account reset, new
collection field or infrastructure access change belongs to this repair.

Isolated `codex/billing-mutation-observability` starts from freshly fetched
`8cbd64bc4f21642fb05074bf058fe2d5d914245e`; no competing open PR at preparation.
Owned files: the nine billing mutation hooks, a bounded billing failure reporter
and its integration tests, the lightweight Sentry context type, and this record.
Existing API adapters, shared privacy scrubber and global query recovery remain
dependencies with no behavior changes. The other launch-holds chat owns durable
infrastructure access, public hydration and exports.

## Confirmed gap and intended repair

The global mutation error handler handles entitlement/mailbox recovery but does
not capture failures. The nine billing hooks have no error capture; screens catch
their rejected promises to show designed recovery. Consequently a browser network
failure can reach the user without an error event. API 5xx reporting does not cover
a request that never arrives. This is source-confirmed; no production billing
failure is generated to demonstrate it.

Report with fixed `surface=billing` and a closed operation label. Never derive
labels from request bodies, invoice IDs, subscription/customer references or URLs.
Throttle each operation to one event per minute across hook instances. Preserve
the original mutation rejection and existing callbacks. Product behavior must not
depend on Sentry being enabled or its transport succeeding.

## Verification

Old-source negative control: 13 new assertions failed before the nine hooks were
wired; the final 23 integration tests pass. Real hooks preserve their original
rejections, designed 4xx/AbortError states stay quiet, operation throttling resumes
at 60 seconds and never shares suppression across different operations. Tests
also exercise the actual disabled Sentry facade and refuse non-vocabulary labels.
The affected billing, SDK/facade and query suites pass: 15 files / 302 tests.
Full workspace typecheck passes. Full lint passes with six existing warnings;
two initial test-only import-type lint errors were corrected and rerun.
Changed-source formatting and `git diff --check` pass.

Synthetic D206 browser smoke used a fresh source copy with verified helper/hook
digests, an isolated billing database and owned loopback ports. Visible identity
and Free baseline were checked. After preview, only the owned API was stopped
before checkout confirmation: no checkout request reached any payment provider.
The user saw the existing conservative unknown-payment recovery, remained Free
and could review before resuming. The real browser SDK sent local collector events
for `surface=billing/reason=checkout` and `surface=billing/reason=reconcile`, plus
the existing query/billing failure. All omitted exception messages and private
fields; frames contained no unsafe asset paths. An initial invalid dummy DSN
produced zero events and was recorded as a failed setup; corrected setup produced
the positive samples. No Sentry production destination or PostHog transport was
configured. Restoring the owned API and clicking Try again recovered the original
Free screen, no pending checkout banner and the same two historical invoices.
The local tab and every owned API/Web/collector/Redis process were closed.

Independent reviewer found no blocking correctness/privacy/design issues and
confirmed all nine hook callbacks preserve existing caller/global recovery.
Storybook/layout changes are N/A: this diff changes no markup or styles. Browser
recovery was exercised, rather than claiming a new visual design.

Production build and PR CI status are recorded in the PR. The generated
IMPLEMENTATION-LOG is updated automatically from merged D-decision trailers;
this additive repair does not hand-edit its existing verified D159 row.

## Coverage limits and follow-ups

This repair covers the nine mutation hooks, not every billing request. The
best-effort pending-lock release DELETE discards errors outside these hooks;
provider SDK launch failures have a separate existing recovery path and PostHog
event. Both are bounded observability follow-ups, not claimed fixed here. Expected
4xx responses intentionally remain quiet; this does not measure every checkout
refusal or conversion loss. The one-minute throttle has no suppressed-count metric.

Before: a caught billing network failure could show recovery without Sentry.
After: the same recovery is preserved and unexpected hook failures reach the
privacy scrubber with a fixed operation label, enabling billing alert routing.
No new customer-facing data surface, payment-state authority or visual redesign
is introduced. Live alert receipt/source-map resolution still need their own
positive evidence; local collector receipt is not production delivery proof.

Production billing rehearsal, notification receipt and live source-map resolution
remain separate unverified boundaries. No launch-ready claim.

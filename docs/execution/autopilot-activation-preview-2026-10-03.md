# Autopilot activation preview review

## Scope and ownership

The user approved improving the rule activation dialog, separating historical
email evidence from current Inbox counts, exposing every actionable sender, and
repairing overlapping content while scrolling. The user subsequently authorized
merge. This isolated `codex/autopilot-dialog-design` worktree owns the dialog,
preview contracts/API/cache and regression coverage; its implementing agent is
the integration owner. No external PR dependency remains. Main's pending-queue
pagination and recorded-match explanation changes were integrated after a real
merge conflict was identified. Billing and onboarding are excluded.

The reviewed story is: select a rule → inspect its current preview and sender
pages → choose Watch first or Act now → confirm through the existing rule
mutation, or cancel. Loading, failed pages and expired previews block confirmation.
Retry retains the last successful page; Refresh obtains a new preview and resets
to page one without discarding the user's mode choice. Unsubscribe requests affect
future delivery; existing email stays put. Protected and already-unsubscribed
senders are excluded from the actionable list.

## Repairs and accepted product decisions

- The narrow, overflowing sheet becomes an opt-in review layout with a scrolling
  body and persistent actions. Compact PreviewSheet consumers retain their default
  layout. The sticky sender heading is opaque and flush with the scroll body's top,
  preventing rows from showing through or above it.
- Each sender shows email history and current inbound Inbox count separately.
  Unknown Inbox counts remain unknown, distinct from zero. Structured read-rate
  evidence includes the adjusted matching-diagnostic caveat; unrecognized evidence
  retains the existing inspectable recorded explanation.
- Activation exposes all actionable senders, 25 per page. The rule card keeps its
  existing ten-sender sample. Loading a later page does not evaluate every sender
  again or accumulate all rows in the browser.
- Page failures keep current evidence readable and offer Retry. Expiry offers
  Refresh in the persistent footer. Confirmation and its keyboard shortcut stay
  blocked until recovery succeeds.
- The authenticated smoke exposed a missing error-code registry entry: the
  exception filter converted the new expiry code to a generic error. Registering
  `AUTOPILOT_PREVIEW_EXPIRED` preserves the wire code and enables Refresh. The new
  filter regression and existing registry guard both failed before this repair
  and pass afterward.

No additional feature decision is outstanding. Search, sorting and virtualization
are deferred: bounded paging supplies access to the complete list without needing
those capabilities. Production latency measurement remains follow-up verification.

## Cached-data readers and stale consequences

`AutopilotReadService.previewRule` creates the snapshot and displays its first
page; `previewSenders` reads later pages. The activation dialog is the only new
consumer. Cached sender hashes, reasons and Inbox counts can become outdated while
the user reviews; an absolute five-minute expiry bounds that review evidence.
Names and addresses are read from the existing sender index per requested page.

No rule mutation, apply worker or Gmail action worker consumes these cached rows.
Activation retains the existing mutation and action cap; execution independently
checks current matches, protection and actionability. The snapshot is scoped by
mailbox, rule and random preview UUID. Out-of-scope or expired reads return 410;
cache outages return 503 without process-local fallback. The derived cache's
retention and fields are recorded in the Gmail data inventory. No additional Gmail
fields, bodies, identities in Redis, analytics properties or provider permissions
are introduced.

## Verification and independent review

- Monorepo typecheck and lint pass; lint retains six pre-existing unused-disable
  warnings. The final hook/table delta also passes targeted lint.
- Shared: 723 tests. API Autopilot: 110 tests, including controller validation,
  tenant isolation, cached ordering, expiry and cross-instance store reads.
- Frontend Autopilot: 132 tests pass. Added regressions cover
  complete 23-sender access, bounded pages, failure recovery, local/API expiry,
  retaining page two after page-three failure and ignoring replaced-preview responses.
- Production web and Storybook builds pass. All 51 routes meet bundle budgets;
  all 45 expected public routes are prerendered.
- Ten Chrome checks pass against the rebuilt Storybook and actual SSR components:
  1280px, 375px and 320px layouts, fixed actions, no horizontal overflow, axe,
  large-list paging, error retry, expiry refresh and the sticky-heading pixel
  regression. The overlap regression failed against the earlier layout before
  the fix and passes afterward.
- Error filter/registry: 16 tests pass, including expiry-code propagation.
- Authenticated synthetic browser/API smoke passes: 53 eligible senders across
  three pages, Protected exclusion, separate history/Inbox counts, real cache-read
  failure (503) and Retry, Redis expiry (410) and Refresh, then cancellation with
  unchanged rule state and Inbox counts. Disposable PostgreSQL/Redis services and
  credential-isolated API/web copies are used; no worker or provider credentials
  are present. Owned fixture rows are removed and disposable services stopped.
- Independent reviewer `/root/activation_review` found a D200/D198 server-state
  boundary issue. Fetched pages were moved into a feature-local TanStack Query
  hook; the reviewer rechecked and passed architecture, design, privacy and recovery
  with no unresolved blockers. The reviewer independently ran 11 changed UI tests
  and QueryObserver assertions for retained data, explicit retry, disabled
  background fetching and cache eviction after unmount.
  The reviewer subsequently rechecked and passed the error-code registry repair.

A local 5,000-sender measurement with real disposable Redis and synthetic PGlite
recorded cached service-page reads at 1.65ms median / 2.73ms maximum, including
page identity lookup. Initial evaluation was 179ms median / 196ms maximum.
These are local measurements, excluding HTTP and production network latency.
They do not establish production performance or deployment usability.

Screenshots, local browser smoke scripts and detailed measurements are stored as
task artifacts, outside Git. No real mailbox screenshot or identity is committed.
Merge, deployment and production verification remain distinct states and are
reported from their actual results.

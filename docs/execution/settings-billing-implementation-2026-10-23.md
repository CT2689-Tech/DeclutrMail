# Settings and Billing production implementation

## Flow contract and ownership

People need to find account preferences, manage Gmail connections, understand
current access and usage, and reach billing controls without losing their place
in the mail tools. The selected design keeps Settings on one scrollable page
with section anchors and puts Settings and Plan & billing in a bottom Account
group. Five primary workspace groups and the mobile drawer/tabs remain.

Integration owner: this session, `codex/settings-billing-polish`, based on freshly
fetched main `643f78a1`. Settings and Billing builders use isolated worktrees and
hand their commits back for one integrated PR. The root owns shared Sidebar,
AppShell, shell tokens/tests and integration. Settings owns its screen, row
presentation and feature tests. Billing owns its screen/presentation and feature
tests. No external PR currently overlaps these feature/shared-shell files.
No dependency, lockfile, API, worker, schema or pricing changes are planned.

Entry points include the sidebar, account menu, mobile drawer, deep links and
OAuth/deletion return links. Preserve existing section IDs and feature flags.
Settings order is Gmail accounts, cleanup previews, email notifications,
optional AI preferences, privacy/data/help and account deletion last. Billing
shows current access/usage first, payment/invoices next and plan comparison last.

Existing APIs, read models, save/error/retry states, consent, deletion scheduling
and cancellation, preview guarantees, checkout reconciliation, provider gates,
complimentary access, plan-change locks and invoice authorization are unchanged.
Use real components; do not transplant synthetic prototype state or duplicate
the shell. Production Gmail mutations, payments, plan changes and deletion are
excluded from verification. Failure/destructive states use synthetic fixtures.

## Verification plan

Verify desktop/tablet/mobile shell navigation, focus and scroll reset; section
anchors/deep links; settings loading/error/retry and save persistence/failure;
empty/reconnect/multi-mailbox states; privacy/account recovery; free/paid/pass/
complimentary billing, unknown/error/pending states and payment locks. Run
affected tests, full typecheck/lint/format, shared/config/events suites,
production web build, bundle/prerender budgets and built-in-browser smoke.
An independent reviewer evaluates the final integrated diff. Required protected
PR and merge-queue checks remain mandatory. Report merged, deployed and fresh
production-flow verification separately.

## Evidence and findings

- Implemented the real responsive Sidebar, keeping one shell and five workspace
  groups. Account links have real URLs and preserve modified clicks. Account
  navigation stays outside the primary navigation's scroll area.
- Implemented the selected anchored Settings presentation, real plan summary,
  original section IDs and deletion last. Kept the streamed fallback identical
  to the screen's first render; removed duplicate loading-page titles.
- Reordered Billing around current access, payment/invoices and comparison;
  retained all existing provider and pending-payment guards. Added stable
  headings and targets for all invoice loading/error/empty branches.
- Independent review identified Pass-only access labelled as Plus in the new
  Settings summary. Reused Billing's existing projection/title and verified
  Pass-only plus concurrent paid Plus/Pro cases.
- Source review of Next's hash handling identified that delayed Billing sections
  could miss a cold fragment. Added a one-time, frame-deferred restoration for
  the four known targets, with regression tests that fail against the old code.
  Later billing refreshes preserve the person's scroll and focus.
- Fixed the shared phone help popover's viewport positioning. At 320px its
  bounds are x=12..308; Escape closes it and returns focus to its trigger.

### Local evidence

Builder validation: 408 Billing tests; 139 initial Settings tests plus three
plan-title cases; scoped typecheck/lint/format; negative controls for Settings
late section links, Pass naming and three delayed Billing fragment targets.
Integrated Settings/shell tests: 130 passed. Shared: 937 passed. Config: 38
passed. Events: 76 passed, including the shared pricing literal guard.

Built-in browser: disposable synthetic account only, API 4118/web 3118, dedicated
Postgres 5418 and Redis database 12 on 6418; no worker, Google tokens, provider
keys or live payment traffic. At 1280/900/320px, observed sidebar widths 220/72/
hidden, one main and no document horizontal overflow. Settings preference Off
persisted after reload, then was restored On. The Privacy and data anchor focused
its target. Account Billing navigation reset the nested content scroll to zero.
Phone help bounds and Escape/focus recovery passed.

Final production-build browser pass used the same disposable API and a local
loopback proxy for the build's relative client API paths. Cold `#invoices` and
`#payment` focused the correct sections (observed top positions 96px and 80px),
with no horizontal overflow. The synthetic paid Plus title agreed across both
pages. Unavailable invoice-provider data rendered its retry state independently.
Paid-account deletion was blocked with its existing Cancel your plan first
explanation. Restored the original synthetic Pro tier and removed the sole fake
subscription before opening the deletion review; nothing was confirmed or
scheduled. At 320px the review fitted the viewport and Escape restored focus to
Delete account. Phone drawer to Billing returned to scroll zero, with five tabs,
one main and no document overflow. Final browser error log was empty.

Production web build passed, including its type/lint validation. All 51 bundle
budgets and 32 prerenders passed without rebaselining. All workspace typechecks
passed serially, full lint and formatting passed, and implementation-log/policy
audits passed. The broad web run had 4,884 passing tests, three existing skips
and one obsolete Settings loading-geometry assertion. Updated that assertion to
the chosen 1120px/28px layout and added Billing loading coverage; all 236 affected
tests then passed. A fresh complete web run and Storybook build are in progress;
protected CI and release evidence are pending.

The repository's isolated launcher initially failed because the current macOS
SWC native carrier needs the existing user's cache environment. A local-only
launcher preserves the existing HOME for this native dependency and otherwise
uses the repository's fixed, credential-free synthetic environment. App source
is copied into an owned temporary workspace; changed source was synchronized
and Billing source hashes compared before the next browser pass. No launcher
or environment policy change is included in the PR.

The first unconstrained broad test run was stopped after host contention caused
timing failures. Final runs use two Vitest workers; thresholds/retries are
unchanged. A first typecheck found an unsupported Testing Library `exact` test
option; removed it and the affected web typecheck passed. Final protected CI
results will be recorded before release readiness.

Independent design-system/React/UI/copy/flow source review: clear after both
follow-up fixes. No new promoted component, state ownership, API contract,
telemetry, pricing, consent, deletion or provider mutation behavior.

No larger feature expansion is needed for this presentation change. Billing
provider purchase/refund rehearsal and real Gmail connection/deletion remain
separate verification scopes; they are not implied by these UI tests.

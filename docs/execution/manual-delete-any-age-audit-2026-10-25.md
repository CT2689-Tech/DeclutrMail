# Manual Delete age default — 2026-10-25

## Contract and ownership

Requested by the founder: all manual Delete previews, including Unsubscribe +
Delete, open at Any age. A sender with two recent inbox messages must preview those
two immediately. Inbox only remains the default reach, archived email remains
opt-in, and chosen age/reach must match confirmation. Cancel/reopen resets both.
Saved automation rules keep their chosen filters. Preview, protected exclusions,
server execution and Undo retain their existing contracts. No production mailbox
mutation is part of verification. Onboarding/billing changes are excluded.

Integration owner: this session, branch `codex/manual-delete-any-age`, isolated
worktree from current main after #1145. Shared ownership: manual age default,
public simulator, relevant tests/stories and this policy amendment. No dependency
on other open PRs; no API, worker, migration, lockfile or automation changes.

## Cause and repair

`DEFAULT_DELETE_WINDOW_DAYS` was 180. All production manual previews read it,
including Senders single/bulk/detail, Triage modal/inline and Needs first review.
Recent inbox messages therefore appeared as zero matches until the user changed
the age control. The public Senders simulator separately hardcoded 180.

The shared manual default is now null (Any age), and the simulator reads it too.
Every consumer was checked: null selects the unwindowed count, while explicit
ages select their matching count. Screener omits the age field for Any age;
Senders/Triage submit null. Existing server semantics already support both.
Automation rules do not import this constant. Historical development prototypes
are excluded from the production manual contract.

## Verification

- Reproduced the reported behavior with a failing two-recent-inbox regression
  (expected Any age, received 180), before changing the default.
- Relevant component/store/request tests cover Any age, explicit 30/180/365,
  archived opt-in, loading/missing/zero counts, keyboard confirmation, Gmail
  verification links, bulk/composite payloads, refetch gating and cancel/reopen.
- Added an actual-server synthetic browser journey with two recent inbox emails;
  it checks opening count, narrowed zero, reset and absence of decision writes.
- Updated narrow-layout browser fixture expectations for manual Delete defaults,
  retaining explicit age/archived confirmation checks.

- Local relevant sweep: 104 files passed, then the two files with old default
  assumptions were corrected and rerun green (196 tests). Combined: 106 files /
  1,765 tests passed; three existing skips remain. Shared UI glossary: four passed.
- Full typecheck and ESLint passed (six existing unused-disable warnings).
  Production web build, bundle budgets and prerender checks passed.
- Built-in browser on the isolated production web build + synthetic API/DB:
  row shows two inbox emails; opening Delete shows Any age, archived unchecked,
  count two. Selecting 180 shows zero/disabled; choosing archived then cancelling
  and reopening restores Any age, inbox-only, count two. Cancel only; no decision
  POST or worker/provider execution. Local native compiler preload was required
  for the existing installed SWC module under the sanitized environment; it stayed
  outside the repository and did not add provider credentials or alter isolation.
- Built-in browser, 320px component fixture: Unsubscribe + Delete opens Any age,
  archived unchecked, count 12; content width equals viewport width (320px).
  Temporary viewport reset after the check. Browser screenshots stay local.
- Independent source/test/design/usability reviewer: no blockers. Its two minor
  findings were fixed and re-reviewed: stale default comments and restoring the
  synthetic sender's starred protection in test cleanup.
- Updated Playwright journeys are executed by CI; browser fixture compilation
  lists all 14 cases. Local manual browser checks are distinct from CI execution.

Production verification is read-only preview/cancel after deployment. This record
makes no provider execution claim.

## Remaining scope

No additional feature or copy change is needed for this report. Older-only filters
remain available for deliberate cleanup. No future-email policy is inferred from
this manual default, and no saved rule is rewritten.

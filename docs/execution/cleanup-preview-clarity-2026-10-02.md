# Cleanup selection clarity

## Flow and ownership

Senders bulk cleanup: select → open the mandatory preview → inspect live scope and
exclusions → confirm or cancel. Root owns the confirm component, its focused tests
and synthetic stories. No dependency on the queued action-observability PR; no API,
worker, schema, policy, billing or onboarding changes. Relates to D226 and D245;
uses the existing ADR-0042 preview grammar.

## Finding and repair

Selection and exclusions were hidden behind Details and the old eligible number
came from client arithmetic. A sender becoming Protected before the fresh preview
could make that number disagree with the title. The quiet summary above the controls
now shows original selection, senders included in the current preview and exclusions.
The title and summary use the same existing inclusion source. Protected exclusions
are not double counted when an already Protected row remains in the selection.

Required preview loading says Checking inclusion; failure says Inclusion unavailable.
Neither reuses stale cached inclusion counts. A narrowed single pure Unsubscribe,
which does not need a live message preview, shows its selection without an endless
check. Existing preview, quota, protection override and confirm guards are unchanged.

## Verification and limits

126 confirm-component tests pass, including changed protection, exclusion deduplication,
stale/loading/error and the exempt Unsubscribe case. A negative control against the old
component failed the authoritative inclusion expectation. Full typecheck and lint pass
(six existing lint warnings). Independent reviewer found no remaining source blocker.

The changed component was served from this isolated worktree through Storybook on
port 6017 using synthetic fixtures. Bulk Delete was checked at desktop and 390×844:
5 selected, 4 included, 1 Protected excluded appears above closed Details. Shift-Tab
and Return opened Details; the narrow layout kept scope and both controls visible.
The failed preview displayed unavailable inclusion and disabled Delete. New loading
and failure stories cover this disclosure alongside existing empty/protection stories.

This is component/browser evidence, not a new provider mutation or deployed production
claim. Local full-stack testing is blocked by the unavailable Docker test database;
required CI/browser checks must pass before queueing. No real mailbox was changed.
Rollback is reverting this PR.

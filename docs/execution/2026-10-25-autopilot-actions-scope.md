# Autopilot actions, mailbox reach and shared dropdowns

Owner/integration owner: this chat. Fresh-main isolated worktree
`codex/autopilot-action-scope-20261025`, base f265efbc. Dependencies: merged
#1126/#1133/#1136 and the #1090 CleanupSelect. Open Home/billing/mobile/infra
PRs have separate ownership; no changes to their product logic are intended.

## Flow contract

A signed-in, Autopilot-entitled person can customize an existing built-in rule
or create a sender rule. Delete is an explicit, approval-first action. Inbox only
is the default; Inbox + archived is available only for Delete. Archive and Later
remain Inbox-only, and Unsubscribe remains sender-level. Saving never changes mail.
A fresh preview freezes the exact message IDs and chosen reach. Approval queues
that batch, Schedule defers admission, terminal status comes from the shared action
pipeline, and Undo restores original Inbox/Archive placement. No unattended Delete.
Selections, cancellation/focus, zero/error/stale previews, protected exclusions,
version conflicts, account isolation, pause/revocation, quota, retries and partial
outcomes retain the existing action contracts. No production mail changes for tests.

Sibling dropdowns in the authenticated application share #1090's native picker
and decorative chevron. Keyboard, labels, disabled state, phone picker and dark/light
styling are retained. Public marketing and throwaway prototypes are excluded.

## Evidence and repair plan

- Confirmed live/editor and schema: built-ins offer only Archive/Later/Unsubscribe;
  custom sender rules already offer Delete and both reach choices. Add the missing
  built-in capability, using the existing reviewed frozen-message pipeline.
- Confirmed source: Autopilot plain selects bypass CleanupSelect. Ranked arrow
  causes: missing shared wrapper (predicted fixed by migration), local spacing
  override (would persist under wrapper), browser-native styling (would differ by
  platform). Reuse and visually verify the shared wrapper rather than change themes.
- Preset matching is unbounded; frozen batches must cap 100 senders AND 5,000
  messages, disclose remainder, and never silently widen after approval.
- Keep the legacy action sweep rejecting Delete. Reject legacy approve endpoints
  for Delete and block unattended activation. Surface fresh Delete batches in review.
- Queued preset Delete batches must prevent material edits until terminal/cancelled;
  pause and stopped rules retain their admission revocation behavior.

## Verification record

The editor regression failed before implementation (missing Include). Focused
checks then passed: API 299 tests, shared 955 tests, web 444 tests plus the new
Delete activation regression, and affected workers 245 tests (four optional live
Redis tests skipped). The workspace typecheck passed; lint has no errors and six
pre-existing warnings. The final Storybook and production builds passed, as did
the 32-route public prerender check. Preset editing is loaded on demand. The
measured bundle table was regenerated with the repository script after the new
flow exceeded the old Autopilot cap by 0.2 kB and Settings by 0.1 kB; the generated
formula remains unchanged. The first CI build caught a conditional pricing route
omitted by the flag-off local rebaseline. Rebuilt and regenerated with CI's
PRICING_V2/METER_V2/BILLING_PASS_ENABLED flags: all 50 route budgets and the
32-route prerender check pass. Current main was merged once to resolve this
integration failure; its Home and refund changes did not conflict with this flow.
CI browser lanes remain required before merge.

The actual app and API ran against a cloned synthetic Postgres database, isolated
Redis DB 12 and a mock Gmail provider. The built-in rule saved Delete with
Inbox + archived and retained it after reload. A five-message frozen approval
waited for Schedule; advancing the mock worker clock admitted only those five
IDs. The browser showed completion, accepted Undo, then showed Undo complete and
refreshed the eligible count. The original synthetic Archive rule and Schedule
were restored. The separate API integration regression verifies a two-message
mixed Inbox/Archive batch, later-arriving mail exclusion and original placement
restoration. This is synthetic provider evidence, not a live Gmail rehearsal.

Additional regressions cover the 100-sender/5,000-message bound, frozen selection
refresh, stale keys, Protected exclusion, incompatible overrides, queued-edit
conflicts, legacy approval rejection, pause/resume and disable/enable revocation,
no unattended Delete, and stale/error match counts. Both phone themes were
visually checked at 375px: one inset chevron, reserved text space, no horizontal
overflow. Independent architecture/privacy/design/flow review passed after fixes.

Production baseline was read-only. No real rule saves, approvals, Schedule changes
or Gmail mutations were performed. Release and authenticated read-only production
verification remain separate delivery steps.
